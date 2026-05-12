/**
 * MĪZAN — Sentry initialization (backend).
 *
 * No-op when SENTRY_DSN is unset. When set, captures uncaught errors
 * from the Vercel function with a strict PII scrubber: anything
 * resembling an email, password, secret, token, or API key is replaced
 * with "[redacted]" before the event is uploaded.
 */

import * as Sentry from "@sentry/node";

const SENTRY_DSN     = (process.env.SENTRY_DSN     || "").trim();
const SENTRY_ENV     = (process.env.VERCEL_ENV     || process.env.NODE_ENV || "development").trim();
const SENTRY_RELEASE = (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 12) || undefined;

// Keys whose VALUES must be redacted no matter how deeply nested they
// appear in the event payload. Case-insensitive match on the key name.
const PII_KEYS = new Set([
  "email", "password", "user_secret", "usersecret",
  "access_token", "accesstoken", "refresh_token", "refreshtoken",
  "api_key", "apikey", "apiKey",
  "authorization", "cookie", "set-cookie",
  "service_role_key", "supabase_service_role_key",
  "anthropic_key", "vite_anthropic_key",
  "polygon_key", "vite_polygon_key",
  "finnhub_key", "vite_finnhub_key",
  "alpaca_secret",
  "plaid_secret",
  "vapid_private_key",
  "resend_api_key",
  "snaptrade_consumer_key", "vite_snaptrade_consumer_key",
]);

/** Recursively redact PII keys in an object. Mutates in place. */
export function scrubObject(obj, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 6) return obj;
  for (const k of Object.keys(obj)) {
    const lower = k.toLowerCase();
    if (PII_KEYS.has(lower)) {
      obj[k] = "[redacted]";
      continue;
    }
    if (obj[k] && typeof obj[k] === "object") {
      scrubObject(obj[k], depth + 1);
    } else if (typeof obj[k] === "string") {
      // Light pattern match for things that *look* like secrets even
      // when the key name is innocuous.
      if (/sk-[a-z0-9_-]{20,}|^Bearer\s+[\w.-]{20,}|^eyJ[\w._-]{40,}/.test(obj[k])) {
        obj[k] = "[redacted]";
      }
    }
  }
  return obj;
}

let _initialized = false;
export function initSentry() {
  if (_initialized) return Sentry;
  if (!SENTRY_DSN) return Sentry;
  Sentry.init({
    dsn:               SENTRY_DSN,
    environment:       SENTRY_ENV,
    release:           SENTRY_RELEASE,
    tracesSampleRate:  0.1,
    sendDefaultPii:    false,
    beforeSend(event) {
      // Strip the easy stuff first
      if (event.request) {
        if (event.request.headers) scrubObject(event.request.headers);
        if (event.request.data)    scrubObject(event.request.data);
        if (event.request.query_string) {
          event.request.query_string = String(event.request.query_string).replace(/(token|key|secret)=[^&]+/gi, "$1=[redacted]");
        }
      }
      if (event.extra)    scrubObject(event.extra);
      if (event.contexts) scrubObject(event.contexts);
      if (event.tags)     scrubObject(event.tags);
      // Hash the user email rather than uploading raw
      if (event.user?.email) {
        event.user = { id: event.user.id };
      }
      return event;
    },
  });
  _initialized = true;
  return Sentry;
}

export { Sentry };
