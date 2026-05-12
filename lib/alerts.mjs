/**
 * MĪZAN — alert delivery.
 *
 * sendAlert(type, details, sbAdmin?) composes a plain-text email,
 * POSTs it to Resend, and writes an audit_log row with action="alert".
 *
 * Best-effort by design — alert delivery failures should never crash a
 * user request. We log a structured warn() and return so the caller can
 * carry on. The dedupe layer below collapses repeat alerts of the same
 * type to one email per 30 minutes so a spike doesn't fill the mailbox.
 *
 * Required env:
 *   RESEND_API_KEY   — get from resend.com (free tier: 3000 emails/mo)
 *   OWNER_EMAIL      — recipient of every alert
 *
 * Without RESEND_API_KEY, sendAlert() still writes the audit_log row
 * but skips the email step (no-op, returns ok:false).
 */

import https from "node:https";
import { info, warn } from "./logger.mjs";

const RESEND_API_KEY = (process.env.RESEND_API_KEY || "").trim();
const OWNER_EMAIL    = (process.env.OWNER_EMAIL    || "").trim();
const ALERT_FROM     = (process.env.ALERT_FROM     || "alerts@mizan.app").trim();

// In-memory dedupe per warm Vercel instance. Maps alert type → last-sent
// timestamp; the same type fires at most once per ALERT_DEDUPE_MS window.
// Cold-starts reset the map, which is acceptable: a cold start means
// the previous instance has been idle for minutes, so a fresh alert is
// fine. For stricter dedupe, use a row in rate_limits with hourly key.
const ALERT_DEDUPE_MS = 30 * 60 * 1000;
const _lastAlertAt = new Map();

function _shouldSend(type) {
  const now = Date.now();
  const last = _lastAlertAt.get(type) || 0;
  if (now - last < ALERT_DEDUPE_MS) return false;
  _lastAlertAt.set(type, now);
  return true;
}

function formatBody(type, details) {
  const lines = [
    `Alert:     ${type}`,
    `When:      ${new Date().toISOString()}`,
    `Severity:  ${details.severity || "warn"}`,
    "",
    "Details:",
  ];
  for (const [k, v] of Object.entries(details || {})) {
    if (k === "severity") continue;
    const formatted = typeof v === "object" ? JSON.stringify(v) : String(v);
    lines.push(`  ${k}: ${formatted}`);
  }
  lines.push("", "— MIZAN automated alert");
  return lines.join("\n");
}

/**
 * Compose + send. Returns { ok, skipped, err? }.
 * @param type     short event name e.g. "auth.brute_force"
 * @param details  free-form metadata object (severity is special)
 * @param sbAdmin  optional service-role Supabase client for audit_log write
 */
export async function sendAlert(type, details = {}, sbAdmin = null) {
  // Always write the audit row, even if email is disabled — the admin
  // panel's audit-log view is the durable record.
  if (sbAdmin) {
    sbAdmin.from("audit_log").insert({
      user_id: details.userId || null,
      action:  "alert",
      target:  type,
      metadata: { ...details, alert_type: type },
      ip:      details.ip || null,
    }).then(({ error }) => {
      if (error) warn("alert.audit_failed", { type, err: error.message });
    });
  }

  if (!RESEND_API_KEY) {
    info("alert.email_skipped", { type, reason: "no_resend_key" });
    return { ok: false, skipped: "no_resend_key" };
  }
  if (!OWNER_EMAIL) {
    info("alert.email_skipped", { type, reason: "no_owner_email" });
    return { ok: false, skipped: "no_owner_email" };
  }
  if (!_shouldSend(type)) {
    info("alert.email_skipped", { type, reason: "deduped_within_30m" });
    return { ok: false, skipped: "deduped" };
  }

  const subject = `MIZAN Alert: ${type}`;
  const text    = formatBody(type, details);
  const payload = JSON.stringify({
    from:    ALERT_FROM,
    to:      [OWNER_EMAIL],
    subject,
    text,
  });

  try {
    const res = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: "api.resend.com",
        port: 443,
        path: "/emails",
        method: "POST",
        headers: {
          "Content-Type":   "application/json",
          "Authorization":  `Bearer ${RESEND_API_KEY}`,
          "Content-Length": Buffer.byteLength(payload),
        },
      }, resp => {
        let buf = "";
        resp.on("data", c => buf += c);
        resp.on("end", () => resolve({ status: resp.statusCode, body: buf }));
      });
      req.on("error", reject);
      req.write(payload);
      req.end();
    });
    if (res.status >= 200 && res.status < 300) {
      info("alert.sent", { type, status: res.status });
      return { ok: true };
    }
    warn("alert.resend_failed", { type, status: res.status, body: res.body.slice(0, 200) });
    return { ok: false, err: `Resend ${res.status}` };
  } catch (e) {
    warn("alert.send_threw", { type, err: e.message });
    return { ok: false, err: e.message };
  }
}

/**
 * Send a one-off email to an arbitrary user. Distinct from sendAlert()
 * in three ways:
 *   1. Recipient is the user's own address, not OWNER_EMAIL
 *   2. No dedupe — every call sends (caller controls cadence)
 *   3. Audit row uses action="user_email_sent" so it's filterable
 *
 * Used by the weekly digest cron. Returns { ok, skipped, err? }.
 */
export async function sendUserEmail(toEmail, subject, text, sbAdmin = null) {
  if (sbAdmin) {
    sbAdmin.from("audit_log").insert({
      user_id: null,
      action: "user_email_sent",
      target: toEmail || null,
      metadata: { subject: subject || "" },
    }).then(({ error }) => {
      if (error) warn("user_email.audit_failed", { err: error.message });
    });
  }

  if (!RESEND_API_KEY) {
    info("user_email.skipped", { reason: "no_resend_key" });
    return { ok: false, skipped: "no_resend_key" };
  }
  if (!toEmail) {
    info("user_email.skipped", { reason: "no_recipient" });
    return { ok: false, skipped: "no_recipient" };
  }

  const payload = JSON.stringify({
    from: ALERT_FROM,
    to: [toEmail],
    subject: subject || "MIZAN",
    text: text || "",
  });

  try {
    const res = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: "api.resend.com",
        port: 443,
        path: "/emails",
        method: "POST",
        headers: {
          "Content-Type":   "application/json",
          "Authorization":  `Bearer ${RESEND_API_KEY}`,
          "Content-Length": Buffer.byteLength(payload),
        },
      }, resp => {
        let buf = "";
        resp.on("data", c => buf += c);
        resp.on("end", () => resolve({ status: resp.statusCode, body: buf }));
      });
      req.on("error", reject);
      req.write(payload);
      req.end();
    });
    if (res.status >= 200 && res.status < 300) {
      info("user_email.sent", { to: toEmail, status: res.status });
      return { ok: true };
    }
    warn("user_email.resend_failed", { to: toEmail, status: res.status, body: res.body.slice(0, 200) });
    return { ok: false, err: `Resend ${res.status}` };
  } catch (e) {
    warn("user_email.send_threw", { to: toEmail, err: e.message });
    return { ok: false, err: e.message };
  }
}
