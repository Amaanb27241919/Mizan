/**
 * MĪZAN — Supabase-backed rate limiter.
 *
 * Hourly window per (user_id, action). The increment_rate_limit RPC in
 * 004_rate_limits.sql does an atomic UPSERT and returns { allowed, count }
 * in one statement, so two concurrent serverless instances can never
 * both decide "allowed" at the threshold.
 *
 * For anonymous callers (no userId), we hash the IP into a synthetic UUID
 * so they still get a stable bucket. The synthetic UUID is in the all-zero
 * namespace, so it can never collide with a real auth.users id.
 *
 * Falls back to an in-memory bucket when Supabase isn't configured — this
 * keeps local dev (no Supabase project) and the cron sync workable. The
 * in-memory path is per-instance so it's looser than the DB path, but it
 * still slows runaway clients.
 */

import { warn } from "./logger.mjs";

// ── Per-action hourly limits ──────────────────────────────────────────────
// Keep these centralized so we can audit & tune in one place. The
// "per-route family" matcher is in matchAction() below.
//
// Sizing rule: a typical Mizan page load fires ~25 GET requests
// (accounts, all, activities, documents, audit, finnhub quotes per
// position, etc.). A user who reloads or navigates 50× / hour is fine
// — that's 1,250 requests. The default cap is sized to allow that
// behavior comfortably and only kick in on runaway clients.
export const RATE_LIMITS = {
  "snaptrade.login":   30,   // /api/snaptrade/login   — 30/hr (was 10; users hit retry-able 429s)
  "anthropic":         60,   // /api/advisor           — 60/hr (~$0.60/hr cost ceiling at $0.01/msg)
  "plaid":            120,   // /api/plaid/*           — 120/hr
  "plaid.sync":        10,   // /api/plaid/transactions?sync=1 — 10/hr, tighter to
                              // bound Plaid /transactions/sync fan-out cost (each
                              // call walks every linked Item up to MAX_PAGES=200).
  "auth":              20,   // /api/auth/*            — 20/hr per IP (was 5; bumped for password-reset retries)
  // /api/export/*           — 20/hr. CSV export pulls up to 5000 rows AND for
  // holdings/activity also fans out to SnapTrade. Each call costs more than a
  // typical read, and GDPR-style downloads are user-initiated (not auto-fired
  // on page loads) so a tight ceiling is appropriate.
  "export":            20,
  "default":         6000,   // any other authenticated route       — 6000/hr (~100/min sustained)
  "anon":             300,   // any unauthenticated request         — 300/hr by IP
};

/** Pick the bucket key for a request path + query. Order matters — more specific first. */
export function matchAction(pathname, search = "") {
  if (pathname === "/api/snaptrade/login")    return "snaptrade.login";
  if (pathname === "/api/advisor")            return "anthropic";
  // /api/plaid/transactions?sync=1 is the expensive variant; route it to a
  // dedicated tighter bucket so it can't be loop-triggered to consume the
  // shared plaid quota.
  if (pathname === "/api/plaid/transactions" && /(^|[?&])sync=(1|true)(&|$)/.test(search)) {
    return "plaid.sync";
  }
  if (pathname.startsWith("/api/plaid/"))     return "plaid";
  if (pathname.startsWith("/api/auth/"))      return "auth";
  // CSV export routes — throttled separately from plaid so a user
  // downloading their data can't burn through the plaid bucket.
  if (pathname.startsWith("/api/export/"))    return "export";
  return "default";
}

/** Bucket window — same hour collapses to one row. */
function hourKey(action, now = new Date()) {
  return `${action}:${now.toISOString().slice(0, 13)}`; // YYYY-MM-DDTHH
}

// ── In-memory fallback (no Supabase) ─────────────────────────────────────
const _mem = new Map();
function inMemoryCheck(key, max) {
  const now    = Date.now();
  const HOUR   = 60 * 60 * 1000;
  const bucket = _mem.get(key);
  if (!bucket || bucket.resetAt <= now) {
    _mem.set(key, { count: 1, resetAt: now + HOUR });
    return { allowed: true, count: 1, max };
  }
  bucket.count += 1;
  return { allowed: bucket.count <= max, count: bucket.count, max };
}

/**
 * @param supabase  Service-role Supabase client (sbAdmin in handlers.mjs)
 * @param userId    Authenticated user UUID or null (anonymous → synthesized from IP)
 * @param action    Bucket name from RATE_LIMITS (e.g. "snaptrade.login")
 * @param max       Override the default; null to use RATE_LIMITS[action]
 */
export async function checkRateLimit(supabase, userId, action, max = null) {
  const limit = max ?? RATE_LIMITS[action] ?? RATE_LIMITS.default;
  const key   = hourKey(action);

  if (!supabase || !userId) {
    return inMemoryCheck(`${userId || "anon"}:${key}`, limit);
  }

  try {
    const { data, error } = await supabase.rpc("increment_rate_limit", {
      p_user_id:    userId,
      p_window_key: key,
      p_max:        limit,
    });
    if (error) {
      // Don't fail the request because the rate limiter is down — log
      // and fall back to in-memory so we degrade gracefully.
      warn("rate.rpc_failed", { err: error.message, action, key });
      return inMemoryCheck(`${userId}:${key}`, limit);
    }
    // RPC returns a one-row table → first element.
    const row = Array.isArray(data) ? data[0] : data;
    return {
      allowed: row?.allowed ?? true,
      count:   row?.count   ?? 0,
      max:     row?.max     ?? limit,
    };
  } catch (e) {
    warn("rate.rpc_threw", { err: e.message, action });
    return inMemoryCheck(`${userId}:${key}`, limit);
  }
}

// Anonymous requests use the in-memory fallback exclusively — the
// rate_limits table has a NOT NULL FK to auth.users so we can't write
// synthetic anon rows there. Per-IP buckets in memory still slow runaway
// clients, which is the whole point at the pre-auth perimeter.
