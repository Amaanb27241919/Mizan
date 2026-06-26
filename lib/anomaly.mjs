/**
 * MĪZAN — anomaly detection (Supabase-backed).
 *
 * Four detectors:
 *   1. Brute force      — 5+ auth.signin_failed from same IP in 60s
 *   2. SnapTrade spike  — 10+ 5xx upstream in 5 minutes (global counter)
 *   3. Cron staleness   — any scheduled cron past its staleness budget
 *                         (audit_log for sync/cleanup, cron_jobs ledger for the rest)
 *   4. New device       — user signs in from an unseen (ip, ua-hash) combo
 *
 * Counters and blocks are stored in the `security_events` table so they
 * survive Vercel cold starts and are consistent across all instances.
 * The increment_security_event RPC handles the atomic upsert.
 */

import crypto from "node:crypto";
import { sendAlert } from "./alerts.mjs";
import { warn } from "./logger.mjs";

// ── Helpers ─────────────────────────────────────────────────────────────────
const sha16 = (s) => crypto.createHash("sha256").update(String(s || "").toLowerCase()).digest("hex").slice(0, 16);

// ── 1. IP blocking ───────────────────────────────────────────────────────────
const BRUTE_WINDOW_SECS = 60;
const BRUTE_THRESHOLD   = 5;
const BLOCK_HOURS       = 24;

/**
 * Returns true if ip currently has an active ip_block row in security_events.
 * Fast path: single indexed query. Called on every request in the hot path.
 */
export async function isIpBlocked(sbAdmin, ip) {
  if (!sbAdmin || !ip) return false;
  try {
    const { count } = await sbAdmin
      .from("security_events")
      .select("id", { count: "exact", head: true })
      .eq("event_type", "ip_block")
      .eq("identifier", ip)
      .gt("expires_at", new Date().toISOString());
    return (count || 0) > 0;
  } catch (e) {
    warn("anomaly.isIpBlocked.failed", { err: e.message, ip });
    return false; // fail open to avoid blocking legitimate requests on DB error
  }
}

async function blockIp(sbAdmin, ip) {
  if (!sbAdmin || !ip) return;
  const expiresAt = new Date(Date.now() + BLOCK_HOURS * 3600 * 1000).toISOString();
  try {
    await sbAdmin.from("security_events").insert({
      event_type:   "ip_block",
      identifier:   ip,
      count:        1,
      window_start: new Date().toISOString(),
      expires_at:   expiresAt,
    });
  } catch (e) {
    warn("anomaly.blockIp.failed", { err: e.message, ip });
  }
}

/**
 * Record an auth failure and check whether it crosses the brute-force
 * threshold. Writes audit_log unconditionally; blocks + alerts when
 * count >= BRUTE_THRESHOLD inside the rolling 60s window.
 */
export async function trackAuthFailure(sbAdmin, ip, emailAttempt) {
  if (!sbAdmin || !ip) return;
  const emailHash = emailAttempt ? sha16(emailAttempt) : null;

  // Durable audit record — always written regardless of threshold.
  sbAdmin.from("audit_log").insert({
    user_id: null,
    action:  "auth.signin_failed",
    target:  emailHash,
    ip,
    metadata: {},
  }).then(({ error }) => {
    if (error) warn("anomaly.auth_failure_log_failed", { err: error.message });
  });

  try {
    const { data, error } = await sbAdmin.rpc("increment_security_event", {
      p_type:        "auth_fail",
      p_identifier:  ip,
      p_window_secs: BRUTE_WINDOW_SECS,
      p_threshold:   BRUTE_THRESHOLD,
    });
    if (error) { warn("anomaly.auth_fail_rpc_failed", { err: error.message }); return; }
    const row = Array.isArray(data) ? data[0] : data;
    if (row?.blocked) {
      await blockIp(sbAdmin, ip);
      sendAlert("auth.brute_force", {
        ip,
        attempts:       row.current_count,
        window_seconds: BRUTE_WINDOW_SECS,
        action_taken:   `ip_blocked_${BLOCK_HOURS}h`,
        severity:       "high",
      }, sbAdmin);
    }
  } catch (e) { warn("anomaly.brute_check_failed", { err: e.message }); }
}

// ── 2. SnapTrade error spike detector ────────────────────────────────────────
const SNAP_WINDOW_SECS = 5 * 60;
const SNAP_THRESHOLD   = 10;

export async function trackSnapTradeError(status, sbAdmin, extra = {}) {
  if (typeof status !== "number" || status < 500) return;
  if (!sbAdmin) return;
  try {
    const { data, error } = await sbAdmin.rpc("increment_security_event", {
      p_type:        "snaptrade_5xx",
      p_identifier:  "global",
      p_window_secs: SNAP_WINDOW_SECS,
      p_threshold:   SNAP_THRESHOLD,
    });
    if (error) { warn("anomaly.snaptrade_rpc_failed", { err: error.message }); return; }
    const row = Array.isArray(data) ? data[0] : data;
    if (row?.blocked) {
      sendAlert("snaptrade.error_spike", {
        errors_5min:   row.current_count,
        latest_status: status,
        severity:      "high",
        ...extra,
      }, sbAdmin);
      // Reset the counter by expiring it so the next batch of errors
      // triggers a fresh alert rather than being silently swallowed.
      await sbAdmin
        .from("security_events")
        .update({ expires_at: new Date().toISOString() })
        .eq("event_type", "snaptrade_5xx")
        .eq("identifier", "global")
        .gt("expires_at", new Date().toISOString());
    }
  } catch (e) { warn("anomaly.snaptrade_check_failed", { err: e.message }); }
}

// ── 3. Cron staleness detector ───────────────────────────────────────────────
// Covers the full scheduled-cron fleet. sync/cleanup record runs in audit_log;
// the rest upsert the cron_jobs ledger — so we read both. Keys are the canonical
// "cron.<job>" names the admin panel reads. `alert:true` jobs page the owner when
// stale; the rest are surfaced in the panel but don't alert (avoids noise from
// the lower-criticality digests on the Hobby plan).
const CRON_DEFS = [
  { key: "cron.sync",             src: "audit",  action: "cron.sync",     hours: 25,  alert: true  },
  { key: "cron.cleanup",          src: "audit",  action: "cron.cleanup",  hours: 25,  alert: true  },
  { key: "cron.nightly-snapshot", src: "ledger", job: "nightly_snapshot", hours: 25,  alert: true  },
  { key: "cron.dividend-check",   src: "ledger", job: "dividend_check",   hours: 25,  alert: false },
  { key: "cron.bill-reminders",   src: "ledger", job: "bill_reminders",   hours: 25,  alert: false },
  { key: "cron.weekly-digest",    src: "ledger", job: "weekly_digest",    hours: 192, alert: false },
];

export async function checkCronStaleness(sbAdmin) {
  if (!sbAdmin) return {};
  const out = {};

  // Pull the cron_jobs ledger once (covers the ledger-tracked jobs).
  const ledger = {};
  try {
    const { data } = await sbAdmin.from("cron_jobs")
      .select("job_name, last_run_at, last_status, last_error");
    for (const r of data || []) ledger[r.job_name] = r;
  } catch (e) { warn("anomaly.cron_ledger_failed", { err: e.message }); }

  for (const def of CRON_DEFS) {
    try {
      let ts = null, status = null, error = null;
      if (def.src === "audit") {
        const { data } = await sbAdmin.from("audit_log")
          .select("created_at")
          .eq("action", def.action)
          .order("created_at", { ascending: false })
          .limit(1);
        ts = data?.[0]?.created_at || null;
        status = ts ? "ok" : null;
      } else {
        const r = ledger[def.job];
        ts = r?.last_run_at || null;
        status = r?.last_status || null;
        error = r?.last_error || null;
      }
      const hours = ts ? (Date.now() - new Date(ts).getTime()) / 3600000 : Infinity;
      out[def.key] = ts
        ? { created_at: ts, last_run_at: ts, hours_ago: +hours.toFixed(2), status, error }
        : null;
      if (def.alert && hours > def.hours) {
        sendAlert("cron.stale", {
          action:           def.key,
          hours_since_last: +hours.toFixed(2),
          threshold_hours:  def.hours,
          severity:         "high",
        }, sbAdmin);
      }
    } catch (e) { warn("anomaly.cron_check_failed", { err: e.message, action: def.key }); }
  }
  return out;
}

// ── 4. New device detection ──────────────────────────────────────────────────
export async function checkNewDevice(sbAdmin, userId, ip, userAgent) {
  if (!sbAdmin || !userId) return false;
  const uaHash = userAgent ? sha16(userAgent) : null;
  try {
    const { data } = await sbAdmin.from("audit_log")
      .select("ip, user_agent")
      .eq("user_id", userId)
      .eq("action", "auth.sign_in")
      .order("created_at", { ascending: false })
      .limit(20);
    const prev = data || [];
    if (prev.length === 0) return false;
    const known = new Set(prev.map((p) => {
      const uh = p.user_agent ? sha16(p.user_agent) : null;
      return `${p.ip || ""}|${uh || ""}`;
    }));
    const current = `${ip || ""}|${uaHash || ""}`;
    if (known.has(current)) return false;
    sendAlert("auth.new_device", { userId, ip, ua_hash: uaHash, severity: "warn" }, sbAdmin);
    return true;
  } catch (e) {
    warn("anomaly.new_device_check_failed", { err: e.message });
    return false;
  }
}
