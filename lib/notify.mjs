/**
 * MĪZAN — Web Push notifications.
 *
 * Wraps the `web-push` library:
 *   - initWebPush() reads VAPID_* env vars and configures the library.
 *     No-op if the package isn't installed or any var is missing — every
 *     downstream call then short-circuits cleanly without throwing.
 *   - sendPushToUser() fans out a payload to every push_subscriptions row
 *     for the given user. 410 Gone responses delete the dead row so the
 *     table doesn't accumulate stale subs.
 *
 * Required env:
 *   VAPID_PUBLIC_KEY   — base64-url p256 public key
 *   VAPID_PRIVATE_KEY  — base64-url p256 private key
 *   VAPID_SUBJECT      — mailto:owner@yourdomain (per web-push spec)
 *
 * Generate a keypair with:
 *   npx web-push generate-vapid-keys
 */

import { info, warn, error as logError } from "./logger.mjs";

const VAPID_PUBLIC_KEY  = (process.env.VAPID_PUBLIC_KEY  || "").trim();
const VAPID_PRIVATE_KEY = (process.env.VAPID_PRIVATE_KEY || "").trim();
const VAPID_SUBJECT     = (process.env.VAPID_SUBJECT     || "").trim();

let webpush = null;
let initialized = false;

/**
 * Lazy-load the web-push package and configure VAPID. Returns true if
 * the library is ready, false otherwise (missing env or missing dep).
 * Safe to call repeatedly — the actual setVapidDetails() only fires once.
 */
export async function initWebPush() {
  if (initialized) return !!webpush;
  initialized = true;

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    info("notify.init.skipped", { reason: "vapid_not_configured" });
    return false;
  }

  try {
    const mod = await import("web-push");
    webpush = mod.default || mod;
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    info("notify.init.ok");
    return true;
  } catch (err) {
    warn("notify.init.failed", { err: err.message });
    webpush = null;
    return false;
  }
}

/**
 * Send a push notification to every registered subscription for a user.
 * Best-effort: dead subscriptions (410 Gone) are removed; other errors
 * are logged but never thrown. Audits each attempt for compliance.
 *
 * @param sbAdmin   service-role Supabase client
 * @param userId    auth.users.id
 * @param payload   { title, body, url }
 */
export async function sendPushToUser(sbAdmin, userId, { title, body, url } = {}) {
  if (!sbAdmin) return { ok: false, skipped: "no_supabase" };
  const ready = await initWebPush();
  if (!ready || !webpush) return { ok: false, skipped: "no_vapid" };

  const { data: subs, error: selErr } = await sbAdmin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);
  if (selErr) {
    warn("notify.subs_select_failed", { userId, err: selErr.message });
    return { ok: false, err: selErr.message };
  }
  if (!subs || subs.length === 0) {
    return { ok: true, sent: 0, removed: 0 };
  }

  const json = JSON.stringify({ title: title || "Mizan", body: body || "", url: url || "/" });
  let sent = 0, removed = 0, failed = 0;

  for (const sub of subs) {
    const subscription = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.p256dh, auth: sub.auth },
    };
    try {
      await webpush.sendNotification(subscription, json);
      sent += 1;
      sbAdmin.from("audit_log").insert({
        user_id: userId,
        action: "push_sent",
        target: sub.id,
        metadata: { title, url },
      }).then(({ error }) => { if (error) warn("notify.audit_failed", { err: error.message }); });
    } catch (err) {
      const status = err?.statusCode || err?.status || 0;
      if (status === 410 || status === 404) {
        // Subscription expired/unregistered — remove it.
        try {
          await sbAdmin.from("push_subscriptions").delete().eq("id", sub.id);
          removed += 1;
        } catch (delErr) {
          warn("notify.cleanup_failed", { id: sub.id, err: delErr.message });
        }
      } else {
        failed += 1;
        logError("push_failed", { userId, subId: sub.id, status, err: err?.message });
        sbAdmin.from("audit_log").insert({
          user_id: userId,
          action: "push_failed",
          target: sub.id,
          metadata: { status, err: String(err?.message || "").slice(0, 200) },
        }).then(({ error }) => { if (error) warn("notify.audit_failed", { err: error.message }); });
      }
    }
  }

  info("notify.fanout.ok", { userId, sent, removed, failed, total: subs.length });
  return { ok: true, sent, removed, failed, total: subs.length };
}
