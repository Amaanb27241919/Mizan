/**
 * Web push subscription — the half of the feature that was never built.
 *
 * The server side has been complete for months: a VAPID key endpoint,
 * subscribe/unsubscribe handlers writing to `push_subscriptions`, a `push`
 * listener in sw.js, and three crons calling sendPushToUser. Nothing on the
 * client ever called `pushManager.subscribe()`, so `push_subscriptions` stayed
 * empty and every one of those sends had no recipient. `requestAlertPermission`
 * asked the browser for permission and stopped there — which grants LOCAL
 * notifications and creates no push subscription at all.
 *
 * Because initWebPush() fails at INFO level and every caller ends in
 * .catch(() => {}), the whole path reported success while delivering nothing.
 * See the push.vapid check added to lib/anomaly.mjs for the configuration half.
 */
import { apiFetch } from "./apiFetch";

/**
 * VAPID keys are URL-safe base64; `atob` needs standard base64 and correct
 * padding. Getting this wrong is the classic push bug — subscribe() rejects
 * with an opaque InvalidCharacterError or InvalidAccessError and the cause is
 * nowhere near the symptom, so it is pure and tested rather than inlined.
 */
export function urlBase64ToUint8Array(base64String) {
  const raw = String(base64String || "").trim();
  if (!raw) throw new Error("empty VAPID key");
  const padding = "=".repeat((4 - (raw.length % 4)) % 4);
  const base64 = (raw + padding).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** The browser can do push at all. */
export function pushSupported() {
  return typeof window !== "undefined"
    && "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window;
}

/** The server's VAPID public key, or null when push is not configured. */
export async function fetchVapidKey() {
  try {
    const r = await apiFetch("/api/notifications/vapid-public-key");
    if (!r.ok) return null;
    const d = await r.json().catch(() => ({}));
    return d?.key || null;
  } catch { return null; }
}

/**
 * Subscribe this device and register it server-side.
 * @returns {Promise<{ok:boolean, reason?:string}>} — never throws.
 */
export async function subscribeToPush({ registration = null } = {}) {
  if (!pushSupported()) return { ok: false, reason: "unsupported" };
  if (Notification.permission !== "granted") return { ok: false, reason: "permission_not_granted" };

  // A null key is the server saying VAPID is unset. Stop here rather than
  // calling subscribe() with an empty applicationServerKey, which throws.
  const key = await fetchVapidKey();
  if (!key) return { ok: false, reason: "not_configured" };

  try {
    const reg = registration || await navigator.serviceWorker.ready;
    // Reuse an existing subscription — re-subscribing with the same key is a
    // no-op in some browsers and an error in others.
    const sub = (await reg.pushManager.getSubscription())
      || await reg.pushManager.subscribe({
        userVisibleOnly: true,                       // required by Chrome
        applicationServerKey: urlBase64ToUint8Array(key),
      });

    const json = sub.toJSON ? sub.toJSON() : sub;
    const r = await apiFetch("/api/notifications/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subscription: {
          endpoint: json.endpoint,
          keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
        },
      }),
    });
    if (!r.ok) return { ok: false, reason: `server_${r.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e?.name || "subscribe_failed" };
  }
}

/** Drop this device's subscription, locally and server-side. */
export async function unsubscribeFromPush({ registration = null } = {}) {
  if (!pushSupported()) return { ok: false, reason: "unsupported" };
  try {
    const reg = registration || await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return { ok: true, reason: "none" };
    const endpoint = sub.endpoint;
    await sub.unsubscribe().catch(() => {});
    // Tell the server even if the local unsubscribe failed — a row we can no
    // longer reach is a row that will 410 on the next send.
    await apiFetch("/api/notifications/subscribe", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint }),
    }).catch(() => {});
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e?.name || "unsubscribe_failed" };
  }
}
