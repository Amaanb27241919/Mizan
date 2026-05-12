/**
 * MĪZAN — anomaly detection.
 *
 * Four detectors, all fire-and-forget so a slow upstream never blocks
 * a request:
 *   1. Brute force      — 5+ auth.signin_failed from same IP in 60s
 *   2. SnapTrade spike  — 10+ 5xx upstream in 5 minutes
 *   3. Cron staleness   — last cron.sync or cron.cleanup > 25 hours old
 *   4. New device       — user signs in from a (ip, ua-hash) combo not
 *                          seen in their last 20 successful sign-ins
 *
 * Each detector composes an alert via lib/alerts.mjs (Resend email +
 * audit_log row). Blocking is best-effort in-memory — survives within a
 * warm Vercel instance, resets on cold start (acceptable: brute force
 * resumes if a fresh instance picks up).
 */

import crypto from "node:crypto";
import { sendAlert } from "./alerts.mjs";
import { warn } from "./logger.mjs";

// ── Helpers ─────────────────────────────────────────────────────────────
const sha16 = (s) => crypto.createHash("sha256").update(String(s || "").toLowerCase()).digest("hex").slice(0, 16);

// ── 1. Brute-force detector ─────────────────────────────────────────────
const BRUTE_WINDOW_MS   = 60 * 1000;
const BRUTE_THRESHOLD   = 5;
const BLOCK_DURATION_MS = 24 * 3600 * 1000;
const _ipBlocks = new Map(); // ip → expiresAt

export function isIpBlocked(ip) {
  if (!ip) return false;
  const exp = _ipBlocks.get(ip);
  if (!exp) return false;
  if (Date.now() > exp) { _ipBlocks.delete(ip); return false; }
  return true;
}

/**
 * Record an auth failure and check whether it crosses the brute-force
 * threshold. Writes audit_log unconditionally; blocks + alerts when
 * count >= BRUTE_THRESHOLD inside the rolling 60s window.
 */
export async function trackAuthFailure(sbAdmin, ip, emailAttempt) {
  if (!sbAdmin || !ip) return;
  const emailHash = emailAttempt ? sha16(emailAttempt) : null;
  // Fire-and-forget log of the failure (audit_log is the durable record).
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
    const since = new Date(Date.now() - BRUTE_WINDOW_MS).toISOString();
    const { count } = await sbAdmin.from("audit_log")
      .select("*", { count: "exact", head: true })
      .eq("action", "auth.signin_failed")
      .eq("ip", ip)
      .gte("created_at", since);
    const attempts = count || 1;
    if (attempts >= BRUTE_THRESHOLD) {
      _ipBlocks.set(ip, Date.now() + BLOCK_DURATION_MS);
      sendAlert("auth.brute_force", {
        ip,
        attempts,
        window_seconds: BRUTE_WINDOW_MS / 1000,
        action_taken:   "ip_blocked_24h",
        severity:       "high",
      }, sbAdmin);
    }
  } catch (e) { warn("anomaly.brute_check_failed", { err: e.message }); }
}

// ── 2. SnapTrade error spike detector ───────────────────────────────────
const SNAP_WINDOW_MS = 5 * 60 * 1000;
const SNAP_THRESHOLD = 10;
const _snapErrors    = []; // [timestamps]

export function trackSnapTradeError(status, sbAdmin, extra = {}) {
  if (typeof status !== "number" || status < 500) return;
  const now = Date.now();
  _snapErrors.push(now);
  const cutoff = now - SNAP_WINDOW_MS;
  while (_snapErrors.length && _snapErrors[0] < cutoff) _snapErrors.shift();
  if (_snapErrors.length >= SNAP_THRESHOLD) {
    sendAlert("snaptrade.error_spike", {
      errors_5min:    _snapErrors.length,
      latest_status:  status,
      severity:       "high",
      ...extra,
    }, sbAdmin);
    _snapErrors.length = 0; // reset so we don't fire again on the next 5xx
  }
}

// ── 3. Cron staleness detector ──────────────────────────────────────────
const CRON_STALE_HOURS = 25;

/**
 * Reads the last audit_log entry for cron.sync and cron.cleanup and
 * alerts if either is older than CRON_STALE_HOURS. Safe to call as a
 * side-effect of the db-status request — alert dedupe keeps it from
 * spamming if the admin refreshes the page.
 *
 * Returns the same shape as the existing db-status cron field so the
 * caller can reuse it without a second query.
 */
export async function checkCronStaleness(sbAdmin) {
  if (!sbAdmin) return {};
  const out = {};
  for (const action of ["cron.sync", "cron.cleanup"]) {
    try {
      const { data } = await sbAdmin.from("audit_log")
        .select("action, created_at, metadata")
        .eq("action", action)
        .order("created_at", { ascending: false })
        .limit(1);
      const row = data?.[0] || null;
      const hours = row?.created_at
        ? (Date.now() - new Date(row.created_at).getTime()) / 3600000
        : Infinity;
      out[action] = row ? { ...row, hours_ago: +hours.toFixed(2) } : null;
      if (hours > CRON_STALE_HOURS) {
        sendAlert("cron.stale", {
          action,
          hours_since_last: +hours.toFixed(2),
          threshold_hours:  CRON_STALE_HOURS,
          severity:         "high",
        }, sbAdmin);
      }
    } catch (e) { warn("anomaly.cron_check_failed", { err: e.message, action }); }
  }
  return out;
}

// ── 4. New device detection ─────────────────────────────────────────────
/**
 * Compares the current (ip, ua_hash) against the user's last N successful
 * sign-ins. Returns true if this is a new device combo and at least one
 * prior sign-in exists to compare against. Triggers an alert when true.
 */
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
    if (prev.length === 0) return false; // first-ever sign-in → not new device
    const known = new Set(prev.map((p) => {
      const uh = p.user_agent ? sha16(p.user_agent) : null;
      return `${p.ip || ""}|${uh || ""}`;
    }));
    const current = `${ip || ""}|${uaHash || ""}`;
    if (known.has(current)) return false;
    sendAlert("auth.new_device", {
      userId,
      ip,
      ua_hash:  uaHash,
      severity: "warn",
    }, sbAdmin);
    return true;
  } catch (e) {
    warn("anomaly.new_device_check_failed", { err: e.message });
    return false;
  }
}
