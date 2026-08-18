/**
 * MĪZAN — anomaly detection (Supabase-backed).
 *
 * Six detectors:
 *   1. Brute force      — 5+ auth.signin_failed from same IP in 60s
 *   2. SnapTrade spike  — 10+ 5xx upstream in 5 minutes (global counter)
 *   3. Cron staleness   — any scheduled cron past its staleness budget
 *                         (audit_log for sync/cleanup, cron_jobs ledger for the rest)
 *   4. New device       — user signs in from an unseen (ip, ua-hash) combo
 *   5. Data feeds       — an upstream data source dying quietly (see DATA_FEEDS)
 *   6. Config           — a credential/env single-point-of-failure (see CONFIG_CHECKS)
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
const BRUTE_THRESHOLD   = 10;   // was 5 — a legit user can fat-finger ~5 logins in a minute; 10 still catches real credential-guessing
const BLOCK_HOURS       = 0.5;  // was 24 — a real attacker hits Supabase Auth directly (not this counter), so the only real-world effect of a long block was locking honest users out; 30 min self-heals a false positive fast

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
  { key: "cron.sync",             src: "audit",  action: "cron.sync",       hours: 25,  alert: true  },
  { key: "cron.cleanup",          src: "audit",  action: "cron.cleanup",    hours: 25,  alert: true  },
  { key: "cron.activation",       src: "audit",  action: "cron.activation", hours: 26,  alert: true  },
  { key: "cron.nightly-snapshot", src: "ledger", job: "nightly_snapshot",   hours: 25,  alert: true  },
  // Alerting since 2026-08-10. It was silent, so nothing said a word while the
  // job sat 23 days without a heartbeat — and separately did nothing at all for
  // its entire life. Now that heartbeats are awaited rather than raced
  // (recordCronRun), silence here is real and worth paging on.
  { key: "cron.dividend-check",   src: "ledger", job: "dividend_check",     hours: 25,  alert: true  },
  { key: "cron.bill-reminders",   src: "ledger", job: "bill_reminders",     hours: 25,  alert: false },
  { key: "cron.weekly-digest",    src: "ledger", job: "weekly_digest",      hours: 192, alert: false },
  // Fires every 15 min on weekdays (GitHub Actions) and records a heartbeat even
  // when it exits on the market-hours gate, so the only thing 60h of silence can
  // mean is that the scheduler stopped. Longest legitimate gap is the weekend
  // (~48h: last weekday fire Friday → first Monday fire).
  { key: "cron.bot-signals",      src: "ledger", job: "bot_signals",        hours: 60,  alert: true  },
];

export async function checkCronStaleness(sbAdmin) {
  if (!sbAdmin) return {};
  const out = {};

  // Pull the cron_jobs ledger once (covers the ledger-tracked jobs).
  const ledger = {};
  try {
    const { data, error } = await sbAdmin.from("cron_jobs")
      .select("job_name, last_run_at, last_status, last_error");
    if (error) warn("anomaly.cron_ledger_failed", { err: error.message });
    for (const r of data || []) ledger[r.job_name] = r;
  } catch (e) { warn("anomaly.cron_ledger_failed", { err: e.message }); }

  for (const def of CRON_DEFS) {
    try {
      let ts = null, status = null, error = null;
      if (def.src === "audit") {
        const { data, error } = await sbAdmin.from("audit_log")
          .select("created_at")
          .eq("action", def.action)
          .order("created_at", { ascending: false })
          .limit(1);
        if (error) warn("anomaly.cron_check_query_failed", { err: error.message, action: def.key });
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
    const { data, error } = await sbAdmin.from("audit_log")
      .select("ip, user_agent")
      .eq("user_id", userId)
      .eq("action", "auth.sign_in")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) { warn("anomaly.new_device_query_failed", { err: error.message }); return false; }
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

// ── 5. Upstream data-feed health ─────────────────────────────────────────────
// The cron detectors above answer "did OUR job run?". These answer the question
// that actually bit us: "is the third-party data those jobs depend on still
// arriving?"
//
// Added 2026-07-29. Stooq hard-404'd its gold/silver CSVs and NOTHING surfaced
// it — Zakat nisab silently fell back to constants sitting 27-41% below live
// spot for an unknown period, so users below the real threshold were told Zakat
// was owed. The outage was found by accident. A feed dying quietly is the
// failure mode that costs the most and announces itself the least.
//
// Probed daily from /api/cron/cleanup and surfaced in /api/admin/db-status.
export const DATA_FEEDS = [
  {
    key: "metals.spot",
    label: "Gold & silver spot (Zakat nisab)",
    path: "/api/metals/spot",
    severity: "high",
    impact: "Zakat nisab can't be computed. The app withholds the nisab verdict rather than showing a stale threshold, so Zakat figures are unavailable until this recovers.",
    // ok:false already means every provider in the chain failed.
    healthy: (body) => body?.ok === true
      && Number(body.nisab_gold_usd) > 0
      && Number(body.nisab_silver_usd) > 0,
  },
];

// Pure: probe result → verdict. Separated from the I/O so it's unit-testable.
export function feedVerdict(feed, probe) {
  const { status, body, error } = probe || {};
  if (error) return { healthy: false, reason: `probe failed: ${error}` };
  if (status !== 200) return { healthy: false, reason: `HTTP ${status}` };
  let ok = false;
  try {
    ok = !!feed.healthy(body);
  } catch (e) {
    return { healthy: false, reason: `unexpected payload: ${e.message}` };
  }
  if (!ok) {
    // Prefer the endpoint's own explanation over a generic message — the metals
    // route reports the per-provider failures in `error`.
    const detail = body && typeof body === "object" ? (body.error || body.reason) : null;
    return { healthy: false, reason: detail ? String(detail).slice(0, 300) : "payload failed health check" };
  }
  return { healthy: true, reason: null, source: (body && body.source) || null };
}

export async function checkDataFeeds(sbAdmin, baseUrl, { alert = true } = {}) {
  const out = {};
  for (const feed of DATA_FEEDS) {
    let probe;
    try {
      const r = await fetch(`${baseUrl}${feed.path}`, { headers: { "User-Agent": "Mizan/1.0 (feed-health)" } });
      let body = null;
      try { body = await r.json(); } catch { /* non-JSON body stays null */ }
      probe = { status: r.status, body };
    } catch (e) {
      probe = { status: 0, body: null, error: e.message };
    }
    const verdict = feedVerdict(feed, probe);
    out[feed.key] = {
      label: feed.label,
      healthy: verdict.healthy,
      reason: verdict.reason,
      source: verdict.source || null,
      checked_at: new Date().toISOString(),
    };
    if (!verdict.healthy) {
      warn("anomaly.data_feed_stale", { feed: feed.key, reason: verdict.reason });
      if (alert) {
        sendAlert("data_feed.stale", {
          feed:     feed.key,
          label:    feed.label,
          reason:   verdict.reason,
          impact:   feed.impact,
          severity: feed.severity,
        }, sbAdmin);
      }
    }
  }
  return out;
}

// ── 6. Config / credential preflight ─────────────────────────────────────────
//
// Added 2026-07-30. Three separate outages traced back to ONE misconfigured
// value, each invisible until a human went looking:
//   · ALERT_FROM drifted to an unverified domain → Resend 403'd EVERY email
//     (invites, digests, re-auth prompts) for days.
//   · The Anthropic account ran out of credits → the Assistant white-screened.
//   · CRON_SECRET was unset → cronUnauthorized() is fail-closed, so the entire
//     cron fleet 401'd and nothing ran at all.
// None of these are code bugs, so no test or build catches them. They're checked
// here, daily from /api/cron/cleanup, and surfaced in the admin panel.
//
// `probe` is the async part; `verdict` is pure so the mapping is unit-testable.
export const CONFIG_CHECKS = [
  {
    key: "cron.secret",
    label: "CRON_SECRET",
    severity: "critical",
    impact: "cronUnauthorized() is fail-closed — with this unset EVERY scheduled job 401s and nothing runs: no sync, no snapshots, no emails.",
    probe: async () => ({ present: !!process.env.CRON_SECRET }),
    verdict: (p) => p.present
      ? { healthy: true, detail: "set" }
      : { healthy: false, reason: "not set — every cron is 401ing" },
  },
  {
    key: "encryption.key",
    label: "ENCRYPTION_KEY",
    severity: "high",
    impact: "Brokerage secrets are written to the database in plaintext instead of AES-256-GCM.",
    probe: async () => ({ present: !!process.env.ENCRYPTION_KEY }),
    verdict: (p) => p.present
      ? { healthy: true, detail: "encryption at rest active" }
      : { healthy: false, reason: "not set — new brokerage secrets store as plaintext" },
  },
  {
    key: "email.sender",
    label: "Email sender domain (ALERT_FROM)",
    severity: "critical",
    impact: "Resend rejects every send with a 403 — invites, weekly digests, re-auth prompts and activation nudges all silently fail.",
    probe: probeResendSender,
    verdict: (p) => {
      if (!p.from)     return { healthy: false, reason: "ALERT_FROM is not set" };
      if (!p.domain)   return { healthy: false, reason: `ALERT_FROM has no parseable domain: ${p.from}` };
      if (p.skipped)   return { healthy: true,  detail: `${p.domain} · ${p.skipped}` };
      if (p.error)     return { healthy: false, reason: `could not verify ${p.domain}: ${p.error}` };
      if (!p.listed)   return { healthy: false, reason: `${p.domain} is not a domain on this Resend account — every send will 403` };
      if (p.status !== "verified") return { healthy: false, reason: `${p.domain} is "${p.status}", not verified — sends will 403` };
      return { healthy: true, detail: `${p.domain} verified` };
    },
  },
  {
    key: "anthropic.credits",
    label: "Anthropic API (Assistant)",
    severity: "high",
    impact: "The Assistant fails on every message — the failure surfaces to users as an error, not as a quiet degradation.",
    probe: probeAnthropic,
    verdict: (p) => {
      if (!p.present)   return { healthy: false, reason: "ANTHROPIC_KEY is not set" };
      if (p.skipped)    return { healthy: true,  detail: p.skipped };
      if (p.status === 200) return { healthy: true, detail: "key valid, credits available" };
      if (p.status === 401 || p.status === 403) return { healthy: false, reason: "key rejected (401/403) — rotated or revoked" };
      if (p.creditIssue) return { healthy: false, reason: "out of credits — the Assistant is down for every user" };
      if (p.status === 429) return { healthy: true, detail: "rate-limited on probe (key is valid)" };
      return { healthy: false, reason: p.error ? `probe failed: ${p.error}` : `unexpected HTTP ${p.status}` };
    },
  },
];

// Parse "MIZAN <alerts@mizan.exchange>" | "alerts@mizan.exchange" → domain.
export function senderDomain(from) {
  const m = String(from || "").match(/[^\s<>@]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/);
  return m ? m[1].toLowerCase() : null;
}

async function probeResendSender() {
  const from = process.env.ALERT_FROM || null;
  const domain = senderDomain(from);
  if (!from || !domain) return { from, domain };
  if (!process.env.RESEND_API_KEY) return { from, domain, skipped: "RESEND_API_KEY not set, cannot verify" };
  try {
    const r = await fetchJson("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    });
    if (r.status !== 200) return { from, domain, error: `Resend HTTP ${r.status}` };
    const list = Array.isArray(r.body?.data) ? r.body.data : [];
    const hit = list.find((d) => String(d.name || "").toLowerCase() === domain);
    return { from, domain, listed: !!hit, status: hit?.status || null };
  } catch (e) {
    return { from, domain, error: e.message };
  }
}

// Cheapest possible real call: 1 output token. A key that is valid but out of
// credits returns 400 with an invalid_request_error naming the credit balance —
// presence of the key alone proves nothing, which is exactly how the Assistant
// went down while every env var looked correct.
async function probeAnthropic() {
  const key = process.env.ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY;
  if (!key) return { present: false };
  try {
    const r = await fetchJson("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1,
        messages: [{ role: "user", content: "." }],
      }),
    });
    const msg = String(r.body?.error?.message || "").toLowerCase();
    return {
      present: true,
      status: r.status,
      creditIssue: msg.includes("credit") || msg.includes("billing") || msg.includes("quota"),
      error: r.body?.error?.message || null,
    };
  } catch (e) {
    return { present: true, status: 0, error: e.message };
  }
}

// Small fetch wrapper with a hard timeout — a hung upstream must never hold the
// admin panel (or the cleanup cron) open.
async function fetchJson(url, opts = {}, ms = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal });
    let body = null;
    try { body = await r.json(); } catch { /* non-JSON body stays null */ }
    return { status: r.status, body };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Legal-document review cadence (owner decision 2026-08-18: quarterly).
 *
 * Runs in the DAILY sweep rather than on its own schedule for two reasons: the
 * Vercel plan only allows daily crons, and a reminder that lives on a separate
 * calendar eventually drifts from the document it is meant to be about. This
 * one derives entirely from LEGAL_LAST_UPDATED in src/lib/legal.js — the same
 * constant the published pages render — so it cannot disagree with what users
 * are actually reading.
 *
 * Why bother: the 2026-08-18 review found the Privacy Policy stating that bank
 * transactions were "not stored" while 2,039 rows sat in the database across 4
 * users, and omitting Anthropic from the processor list while the AI Assistant
 * sent holdings to it. Neither was malice — the policy was written in May and
 * the features arrived after. Documents about how software behaves go stale
 * precisely because software changes, so the reminder has to be automatic.
 */
export async function checkLegalReview({ alert = true, now = new Date() } = {}, sbAdmin) {
  const { LEGAL_LAST_UPDATED, REVIEW_INTERVAL_DAYS, daysSinceLegalReview, isLegalReviewDue, LEGAL_DOCUMENTS } =
    await import("../src/lib/legal.js");

  const days = daysSinceLegalReview(now);
  const due  = isLegalReviewDue(now);
  const out = {
    label:        "Legal document review",
    healthy:      !due,
    last_updated: LEGAL_LAST_UPDATED,
    days_since:   days,
    interval:     REVIEW_INTERVAL_DAYS,
    documents:    LEGAL_DOCUMENTS.map((d) => d.title),
    checked_at:   now.toISOString(),
  };

  if (due) {
    warn("anomaly.legal_review_due", { days_since: days, last_updated: LEGAL_LAST_UPDATED });
    if (alert) {
      sendAlert("legal.review_due", {
        last_updated: LEGAL_LAST_UPDATED,
        days_since:   days,
        interval:     REVIEW_INTERVAL_DAYS,
        documents:    LEGAL_DOCUMENTS.map((d) => `${d.title} (${d.href})`).join(", "),
        impact:       "Published policies may no longer describe what the software actually does — "
                    + "check processors, what is stored vs fetched live, and retention against the real system.",
        severity:     "medium",
      }, sbAdmin);
    }
  }
  return out;
}

export async function checkConfig(sbAdmin, { alert = true } = {}) {
  const out = {};
  const results = await Promise.all(CONFIG_CHECKS.map(async (check) => {
    let verdict;
    try {
      verdict = check.verdict(await check.probe());
    } catch (e) {
      verdict = { healthy: false, reason: `check failed: ${e.message}` };
    }
    return [check, verdict];
  }));

  for (const [check, verdict] of results) {
    out[check.key] = {
      label:      check.label,
      healthy:    !!verdict.healthy,
      detail:     verdict.detail || null,
      reason:     verdict.reason || null,
      severity:   check.severity,
      checked_at: new Date().toISOString(),
    };
    if (!verdict.healthy) {
      warn("anomaly.config_broken", { check: check.key, reason: verdict.reason });
      if (alert) {
        sendAlert("config.broken", {
          check:    check.key,
          label:    check.label,
          reason:   verdict.reason,
          impact:   check.impact,
          severity: check.severity,
        }, sbAdmin);
      }
    }
  }
  return out;
}
