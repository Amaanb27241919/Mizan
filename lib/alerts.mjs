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
const ALERT_FROM     = (process.env.ALERT_FROM     || "MIZAN <no-reply@mizan.exchange>").trim();
const APP_URL        = (process.env.APP_BASE_URL   || "https://app.mizan.exchange").trim().replace(/\/$/, "");

// Minimal HTML escape for any dynamic text dropped into the branded shell.
const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Branded HTML email shell — the Mizan identity in an email-client-safe form:
 * table layout, fully inline styles, no web fonts (the MĪZAN wordmark is live
 * text in a serif stack so it renders even with images disabled), no external
 * images. `variant` ("user" | "admin") tunes the eyebrow accent + footer copy.
 * Always paired with a plain-text fallback in the Resend payload.
 */
export function renderBrandedEmail({ eyebrow, title, bodyText = "", ctaUrl, ctaLabel, ctaUrl2, ctaLabel2, footNote, variant = "user" }) {
  const NAVY = "#1e4e8c", INK = "#1c1b19", PAPER = "#faf8f4",
        CARD = "#ffffff", MUTED = "#87827a", BORDER = "#e7e2d8", BODY = "#3a3733";
  const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
  const SERIF = "Georgia,'Times New Roman',serif";
  const bodyHtml = esc(bodyText).replace(/\n/g, "<br>");
  const cta = ctaUrl ? `
            <tr><td style="padding:6px 0 2px">
              <a href="${esc(ctaUrl)}" style="display:inline-block;background:${NAVY};color:#ffffff;text-decoration:none;font:600 14px/1 ${SANS};letter-spacing:.03em;padding:13px 22px;border-radius:8px">${esc(ctaLabel || "Open Mizan")}</a>
            </td></tr>` : "";
  // Optional secondary (outlined) button — e.g. "Learn more" to the marketing site.
  const cta2 = ctaUrl2 ? `
            <tr><td style="padding:10px 0 2px">
              <a href="${esc(ctaUrl2)}" style="display:inline-block;background:${CARD};color:${NAVY};text-decoration:none;font:600 13px/1 ${SANS};letter-spacing:.03em;padding:11px 20px;border-radius:8px;border:1px solid ${NAVY}">${esc(ctaLabel2 || "Learn more")}</a>
            </td></tr>` : "";
  // Footer sentence: caller can override (e.g. invites — recipient has no account yet).
  const foot = footNote != null ? esc(footNote) : (variant === "admin"
    ? "Automated security &amp; system alert — sent to the account owner only. Do not reply."
    : "You're receiving this because you have a Mizan account.");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:${PAPER};-webkit-text-size-adjust:100%">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:${CARD};border:1px solid ${BORDER};border-radius:14px;overflow:hidden">
        <tr><td style="height:4px;background:${NAVY};font-size:0;line-height:0">&nbsp;</td></tr>
        <tr><td style="padding:28px 36px 0">
          <img src="${APP_URL}/logo.png" alt="M&#298;ZAN" width="160" height="36" style="display:block;width:160px;height:36px;border:0;outline:none;text-decoration:none">
          <div style="font:italic 400 12px/1.4 ${SERIF};color:${MUTED};margin-top:9px">Balance your wealth. Honor your deen.</div>
        </td></tr>
        <tr><td style="padding:22px 36px 0">
          ${eyebrow ? `<div style="font:600 11px/1 ${SANS};letter-spacing:.14em;text-transform:uppercase;color:${NAVY}">${esc(eyebrow)}</div>` : ""}
          ${title ? `<div style="font:600 19px/1.35 ${SERIF};color:${INK};margin-top:8px">${esc(title)}</div>` : ""}
        </td></tr>
        <tr><td style="padding:14px 36px 0;font:400 15px/1.6 ${SANS};color:${BODY}">${bodyHtml}</td></tr>
        <tr><td style="padding:18px 36px 30px">
          <table role="presentation" cellpadding="0" cellspacing="0">${cta}${cta2}</table>
        </td></tr>
        <tr><td style="padding:18px 36px 26px;border-top:1px solid ${BORDER}">
          <div style="font:400 12px/1.7 ${SANS};color:${MUTED}">
            ${foot}<br>
            <a href="${esc(APP_URL)}" style="color:${NAVY};text-decoration:none">${esc(APP_URL.replace(/^https?:\/\//, ""))}</a>&nbsp; · &nbsp;Sharia-compliant investing
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

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
  const html    = renderBrandedEmail({
    eyebrow:  `${details.severity || "warn"} · system alert`,
    title:    type,
    bodyText: text,
    ctaUrl:   `${APP_URL}/`,
    ctaLabel: "Open Mizan",
    variant:  "admin",
  });
  const payload = JSON.stringify({
    from:    ALERT_FROM,
    to:      [OWNER_EMAIL],
    subject,
    text,
    html,
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
export async function sendUserEmail(toEmail, subject, text, sbAdmin = null, opts = {}) {
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

  const html = renderBrandedEmail({
    eyebrow:  opts.eyebrow || "Notification",
    title:    opts.title   || subject || "Mizan",
    bodyText: text || "",
    ctaUrl:   opts.ctaUrl  || `${APP_URL}/`,
    ctaLabel: opts.ctaLabel || "Open Mizan",
    ctaUrl2:  opts.ctaUrl2,
    ctaLabel2: opts.ctaLabel2,
    footNote: opts.footNote,
    variant:  opts.variant || "user",
  });
  const payload = JSON.stringify({
    from: ALERT_FROM,
    to: [toEmail],
    subject: subject || "MIZAN",
    text: text || "",
    html,
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
