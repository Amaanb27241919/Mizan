/**
 * MĪZAN — Shared API route logic
 *
 * Pure handler module: takes a normalized request shape and returns
 * `{ status, body }`. Used by both the local Node dev server (server.js)
 * and the Vercel catch-all serverless function (api/[...path].mjs) so
 * dev and prod cannot drift.
 */

import https  from "node:https";
import crypto from "node:crypto";
import fs     from "node:fs";
import path   from "node:path";
import { info, warn, error as logError, setLogContext, withRequestContext, newRequestId } from "./logger.mjs";
import { checkRateLimit, matchAction, RATE_LIMITS } from "./rateLimit.mjs";
import { isIpBlocked, trackAuthFailure, trackSnapTradeError, checkCronStaleness, checkNewDevice } from "./anomaly.mjs";
import { fetchWithRetry } from "./fetchWithRetry.mjs";
import { sendUserEmail } from "./alerts.mjs";
import { sendPushToUser } from "./notify.mjs";
import { Sentry } from "./sentry.mjs";

// ── Alpaca (paper trading) ──────────────────────────────
const ALPACA_KEY_ID = (process.env.ALPACA_KEY_ID || "").trim();
const ALPACA_SECRET = (process.env.ALPACA_SECRET || "").trim();
const ALPACA_BASE   = "https://paper-api.alpaca.markets/v2";

// Sharia precheck — tickers known to be non-compliant (banks, alcohol,
// gambling, conventional bond funds, etc). NOT a comprehensive screen;
// the real compliance gate lives in the AI advisor + brokerage account.
// This is a fast-path bailout that prevents the obvious mistakes from
// even reaching Alpaca.
const HARAM_TICKERS = new Set(["JPM", "WYNN", "MO", "LCID", "BND"]);

// ── Env vars ─────────────────────────────────────────────
const CLIENT_ID = (
  process.env.VITE_SNAPTRADE_CLIENT_ID ||
  process.env.SNAPTRADE_CLIENT_ID || ""
).trim();

const CONSUMER_KEY = (
  process.env.VITE_SNAPTRADE_CONSUMER_KEY ||
  process.env.SNAPTRADE_CONSUMER_KEY || ""
).trim();

const FINNHUB_KEY   = (process.env.VITE_FINNHUB_KEY || "").trim();
const ANTHROPIC_KEY = (process.env.ANTHROPIC_KEY || process.env.VITE_ANTHROPIC_KEY || "").trim();
const POLYGON_KEY   = (process.env.POLYGON_KEY   || process.env.VITE_POLYGON_KEY   || "").trim();
// Owner email — when this user signs in, they inherit the legacy mizan_primary
// SnapTrade record (your existing connected brokerages). Everyone else gets a
// fresh empty user. Leave blank in production deployments where no owner-claim
// migration is needed.
const OWNER_EMAIL = (process.env.OWNER_EMAIL || "").trim().toLowerCase();

const SUPABASE_URL              = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
// Vercel sends `Authorization: Bearer ${CRON_SECRET}` on cron requests.
// Set this env var in Vercel dashboard to protect the sync endpoint.
const CRON_SECRET = (process.env.CRON_SECRET || "").trim();

// ── Plaid (banking aggregation) ─────────────────────────
const PLAID_CLIENT_ID = (process.env.PLAID_CLIENT_ID || "").trim();
const PLAID_SECRET    = (process.env.PLAID_SECRET    || "").trim();
const PLAID_ENV       = (process.env.PLAID_ENV       || "sandbox").trim();

let plaidClient = null;
if (PLAID_CLIENT_ID && PLAID_SECRET) {
  try {
    const { Configuration, PlaidApi, PlaidEnvironments } = await import("plaid");
    const config = new Configuration({
      basePath: PlaidEnvironments[PLAID_ENV] || PlaidEnvironments.sandbox,
      baseOptions: {
        headers: {
          "PLAID-CLIENT-ID": PLAID_CLIENT_ID,
          "PLAID-SECRET":    PLAID_SECRET,
          "Plaid-Version":   "2020-09-14",
        },
      },
    });
    plaidClient = new PlaidApi(config);
    info("plaid.init.ok", { env: PLAID_ENV });
  } catch (err) {
    logError("plaid.init.failed", { err: err.message });
  }
} else {
  info("plaid.init.skipped", { reason: "not_configured" });
}

// ── Supabase admin client (server-only, bypasses RLS) ────
let sbAdmin = null;
if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  try {
    const { createClient } = await import("@supabase/supabase-js");
    sbAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    info("supabase.admin.ready", { mode: "per_user" });
  } catch (err) {
    logError("supabase.admin.failed", { err: err.message });
  }
} else {
  info("supabase.admin.skipped", { reason: "not_configured", fallback: "mizan_primary" });
}

// ── SnapTrade HMAC Auth ──────────────────────────────────
// Docs: https://docs.snaptrade.com/reference/Authentication
//   - clientId AND timestamp go in the QUERY STRING (sorted alphabetically)
//   - Signature header = base64(HMAC-SHA256(consumerKey, JSON.stringify({
//       content: <body object or null>,
//       path:    "/api/v1/<endpoint>",
//       query:   "<sorted query string>"
//     })))
function buildSignature(reqPath, queryString, bodyObj) {
  const sigObject = { content: bodyObj || null, path: reqPath, query: queryString };
  return crypto
    .createHmac("sha256", CONSUMER_KEY)
    .update(JSON.stringify(sigObject))
    .digest("base64");
}

function snapReq(method, endpoint, bodyObj, extraQuery = {}) {
  return new Promise((resolve, reject) => {
    const timestamp = Math.floor(Date.now() / 1000).toString();

    const queryParams = { clientId: CLIENT_ID, timestamp, ...extraQuery };
    const queryString = Object.keys(queryParams)
      .sort()
      .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k])}`)
      .join("&");

    const reqPath  = `/api/v1${endpoint}`;
    const fullPath = `${reqPath}?${queryString}`;
    const signature = buildSignature(reqPath, queryString, bodyObj);

    const bodyStr = bodyObj ? JSON.stringify(bodyObj) : "";
    const headers = { "Content-Type": "application/json", Signature: signature };
    if (bodyStr) headers["Content-Length"] = Buffer.byteLength(bodyStr);

    const req = https.request({
      hostname: "api.snaptrade.com",
      port: 443,
      path: fullPath,
      method,
      headers,
    }, res => {
      let data = "";
      res.on("data", chunk => (data += chunk));
      res.on("end", () => {
        // Anomaly: track 5xx for the SnapTrade-spike detector. Fire-and-
        // forget; never blocks the response chain.
        if (res.statusCode >= 500) {
          try { trackSnapTradeError(res.statusCode, sbAdmin, { endpoint }); } catch {}
        }
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── Generic HTTPS GET → JSON helper (for Finnhub etc.) ───
function httpsGetJson(urlStr) {
  return new Promise((resolve, reject) => {
    https.get(urlStr, res => {
      let data = "";
      res.on("data", chunk => (data += chunk));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    }).on("error", reject);
  });
}

// ── User store: per-Supabase-user SnapTrade isolation ────
// File-backed legacy store (mizan_primary) preserved for single-user mode and
// existing connections. New users get rows in Postgres user_snaptrade table.
// Use cwd-relative path: working directory differs between Node dev (project
// root) and Vercel functions (function root) — process.cwd() is the project
// root in both cases.
const STORE = path.join(process.cwd(), ".snaptrade-users.json");
const loadUsers = () => { try { return JSON.parse(fs.readFileSync(STORE, "utf8")); } catch { return {}; } };
const saveUsers = u  => { try { fs.writeFileSync(STORE, JSON.stringify(u, null, 2)); } catch (err) { logError("snaptrade.users_file_write_failed", { err: err.message }); } };

async function getOrCreateUser(userId) {
  const users = loadUsers();
  if (users[userId]) return { userId, userSecret: users[userId] };
  info("snaptrade.register_legacy", { userId });
  const res = await snapReq("POST", "/snapTrade/registerUser", { userId });
  if (res.status === 200 || res.status === 201) {
    const { userSecret } = res.body;
    users[userId] = userSecret;
    saveUsers(users);
    info("snaptrade.register_legacy.ok", { userId });
    return { userId, userSecret };
  }
  throw new Error(`registerUser ${res.status}: ${JSON.stringify(res.body)}`);
}

// Verify Supabase JWT in Authorization header.
// Returns auth.users row on success, null otherwise.
async function verifyUser(headers) {
  if (!sbAdmin) return null;
  const auth = headers.authorization || headers.Authorization || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  try {
    const { data, error } = await sbAdmin.auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user;
  } catch { return null; }
}

// Require an AAL2 session (MFA-verified) for the current request.
// Returns null when OK; otherwise returns a structured Error with
// status + code that the caller should surface to the client.
//   - MFA_VERIFICATION_REQUIRED: user has factors enrolled but the
//     current session is AAL1 (password-only). Client should prompt for
//     the user's authenticator code.
//   - MFA_ENROLLMENT_REQUIRED: user has no verified factors. Client
//     should route them through MFA enrollment before retrying.
async function requireAAL2(headers, user) {
  const payload = jwtPayload(headers);
  if (payload?.aal === "aal2") return null;

  let hasFactors = false;
  try {
    if (sbAdmin?.auth?.admin?.mfa?.listFactors) {
      const { data } = await sbAdmin.auth.admin.mfa.listFactors({ userId: user.id });
      hasFactors = (data?.factors || []).some(f => f.status === "verified");
    }
  } catch (err) {
    warn("mfa.list_factors_failed", { userId: user.id, err: err.message });
  }

  const err = hasFactors
    ? new Error("Multi-factor verification required. Please enter your authenticator code to continue.")
    : new Error("Multi-factor authentication is required to connect a bank account. Please enroll an authenticator in Settings before linking your bank.");
  err.status = 403;
  err.code = hasFactors ? "MFA_VERIFICATION_REQUIRED" : "MFA_ENROLLMENT_REQUIRED";
  return err;
}

// Decode the JWT payload without verifying. Used to extract the
// session_id claim so the server knows which session is "current" when
// the user calls "revoke all others". Verification still happens via
// sbAdmin.auth.getUser() in verifyUser() — this is a read-only inspect.
function jwtPayload(headers) {
  const auth = headers.authorization || headers.Authorization || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4 ? "=".repeat(4 - padded.length % 4) : "";
    return JSON.parse(Buffer.from(padded + pad, "base64").toString("utf8"));
  } catch { return null; }
}

// Resolve {userId, userSecret} for the current request.
// - Authenticated (Supabase JWT in header): per-user record from Postgres
//   user_snaptrade table. Auto-registers with SnapTrade on first call.
// - Otherwise: falls back to mizan_primary in the JSON file (single-user mode
//   and backward-compat for accounts already connected before multi-user shipped).
async function getSnapForRequest(headers) {
  const user = await verifyUser(headers);
  if (user && sbAdmin) {
    const stUserId = `mizan_${user.id}`;
    const { data: row, error: selErr } = await sbAdmin
      .from("user_snaptrade")
      .select("snaptrade_user_id, snaptrade_user_secret")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!selErr && row?.snaptrade_user_secret) {
      return { userId: row.snaptrade_user_id || stUserId, userSecret: row.snaptrade_user_secret, supabaseUser: user };
    }
    // Owner-claim: if this is the configured owner email, inherit the legacy
    // mizan_primary record so existing brokerage connections come along.
    if (OWNER_EMAIL && (user.email || "").toLowerCase() === OWNER_EMAIL) {
      const legacy = loadUsers()["mizan_primary"];
      if (legacy) {
        const { error: claimErr } = await sbAdmin.from("user_snaptrade").upsert({
          user_id: user.id,
          snaptrade_user_id: "mizan_primary",
          snaptrade_user_secret: legacy,
        });
        if (claimErr) logError("snaptrade.owner_claim_failed", { err: claimErr.message, email: user.email });
        else info("snaptrade.owner_claim.ok", { email: user.email });
        return { userId: "mizan_primary", userSecret: legacy, supabaseUser: user };
      }
    }
    // Register a fresh SnapTrade user for this Supabase user
    info("snaptrade.register_user", { email: user.email, stUserId });
    let res = await snapReq("POST", "/snapTrade/registerUser", { userId: stUserId });

    // Handle the "already registered" race: this happens when a prior
    // registration succeeded at SnapTrade but our Supabase upsert silently
    // failed (transient DB error, network glitch). The user is registered
    // with SnapTrade but we have no userSecret on file, so every future
    // call fails. SnapTrade returns the secret only at registration, so
    // the only recovery is delete + re-register. Safe to do here because
    // any orphaned userId could not have completed a brokerage connection
    // (we would have stored the secret on the way through).
    const bodyTxt = () => JSON.stringify(res.body || "").toLowerCase();
    if (res.status === 400 && /already.*registered|duplicate/.test(bodyTxt())) {
      warn("snaptrade.register_user.already_registered", { stUserId });
      try {
        await snapReq("DELETE", "/snapTrade/deleteUser", null, { userId: stUserId });
        info("snaptrade.delete_user.ok", { stUserId });
      } catch (delErr) {
        warn("snaptrade.delete_user.failed", { stUserId, err: delErr.message });
      }
      res = await snapReq("POST", "/snapTrade/registerUser", { userId: stUserId });
    }

    if (res.status >= 200 && res.status < 300) {
      const { userSecret } = res.body;
      const { error: insErr } = await sbAdmin.from("user_snaptrade").upsert({
        user_id: user.id,
        snaptrade_user_id: stUserId,
        snaptrade_user_secret: userSecret,
      });
      if (insErr) logError("snaptrade.user_upsert_failed", { err: insErr.message, stUserId });
      info("snaptrade.register_user.ok", { stUserId });
      return { userId: stUserId, userSecret, supabaseUser: user };
    }

    // Structured error so the frontend can show friendly copy instead of
    // a raw SnapTrade response JSON to end users.
    const detail = res.body && typeof res.body === "object"
      ? (res.body.detail || res.body.message || JSON.stringify(res.body))
      : String(res.body || res.status);
    let code = "SNAPTRADE_REGISTER_FAILED";
    let message = "We couldn't set up your brokerage account right now. Please try again in a minute.";
    if (/limit|quota|plan/.test(bodyTxt())) {
      code = "SNAPTRADE_LIMIT_REACHED";
      message = "Brokerage connection limit reached for this account. Please contact support.";
    }
    logError("snaptrade.register_user.failed", { stUserId, status: res.status, detail });
    const stErr = new Error(message);
    stErr.status = 502;
    stErr.code = code;
    stErr.detail = detail;
    throw stErr;
  }
  // Single-user fallback ONLY when Supabase isn't configured at all.
  // In multi-user mode, refuse unauthenticated requests — otherwise a
  // missing/invalid JWT would leak the owner's mizan_primary data to any
  // anonymous caller (CRITICAL privacy bug).
  if (sbAdmin) {
    const err = new Error("UNAUTHENTICATED");
    err.status = 401;
    throw err;
  }
  return getOrCreateUser("mizan_primary");
}

function clientIp(headers) {
  // Vercel and most proxies forward the real client IP here. Trust the
  // leftmost entry, fall back to a fixed string so anonymous callers without
  // an IP still get a shared bucket (still rate-limited).
  const xf = (headers["x-forwarded-for"] || headers["X-Forwarded-For"] || "").toString();
  return xf.split(",")[0].trim() || "anon";
}

// ── Audit log ───────────────────────────────────────────
// Best-effort append-only record. Inserts use the service-role key so they
// bypass RLS; users can only SELECT their own rows. Fire-and-forget — never
// blocks the request path. Silently no-ops when Supabase isn't configured.
function audit({ userId = null, action, target = null, metadata = {}, headers = {} }) {
  if (!sbAdmin) return;
  const ip = (headers["x-forwarded-for"] || headers["X-Forwarded-For"] || "").toString().split(",")[0].trim() || null;
  const ua = (headers["user-agent"] || headers["User-Agent"] || "").toString().slice(0, 500) || null;
  sbAdmin
    .from("audit_log")
    .insert({ user_id: userId, action, target, metadata, ip, user_agent: ua })
    .then(({ error }) => { if (error) warn("audit.insert_failed", { action, err: error.message }); });
}

// ── Rate limiter (Supabase-backed, hourly windows) ────────
// Authenticated users → DB rows in public.rate_limits (survives cold starts,
// shared across Vercel instances). Anonymous callers → in-memory fallback
// keyed by IP (the rate_limits table FK requires a real auth.users id).
//
// Per-action limits live in lib/rateLimit.mjs RATE_LIMITS.
async function applyRateLimit(pathname, headers) {
  // Cron is gated by CRON_SECRET separately; skip rate limiting so the
  // scheduled job isn't starved by other traffic in the same minute.
  if (pathname === "/api/cron/sync"
      || pathname === "/api/cron/cleanup"
      || pathname === "/api/cron/nightly-snapshot"
      || pathname === "/api/cron/weekly-digest"
      || pathname === "/api/cron/dividend-check") return null;
  if (pathname === "/api/snaptrade/status") return null;

  const action = matchAction(pathname);
  let userId = null;
  let user = null;
  try {
    user = await verifyUser(headers);
    if (user?.id) userId = user.id;
  } catch { /* fall through to anon path */ }

  // Root users (admins) bypass rate limiting entirely. Locking out a
  // debugging admin defeats the purpose of an admin panel — they need
  // to be able to hit /api/admin/* repeatedly without burning a quota.
  if (user && await isRootUser(user)) return null;

  // Anonymous → in-memory by IP (pass null for supabase to force fallback).
  // Authenticated → DB-backed atomic RPC.
  if (!userId) {
    const ip = clientIp(headers);
    return checkRateLimit(null, `ip:${ip}`, action, RATE_LIMITS.anon);
  }
  return checkRateLimit(sbAdmin, userId, action, RATE_LIMITS[action]);
}

// ── isRoot check (profiles.is_root OR OWNER_EMAIL fallback) ─────────
// Cached per cold-start since profiles.is_root rarely changes; safe to
// refresh on next instance.
const _rootCache = new Map(); // userId → boolean
async function isRootUser(user) {
  if (!user) return false;
  if (_rootCache.has(user.id)) return _rootCache.get(user.id);

  // Owner-email fallback so the bootstrap admin works before any SQL
  // INSERT marks the first user is_root=true.
  if (OWNER_EMAIL && (user.email || "").toLowerCase() === OWNER_EMAIL) {
    _rootCache.set(user.id, true);
    return true;
  }
  if (!sbAdmin) {
    _rootCache.set(user.id, false);
    return false;
  }
  try {
    const { data, error } = await sbAdmin
      .from("profiles")
      .select("is_root")
      .eq("id", user.id)
      .maybeSingle();
    if (error) {
      warn("profiles.read_failed", { err: error.message, userId: user.id });
      return false;
    }
    const ok = !!data?.is_root;
    _rootCache.set(user.id, ok);
    return ok;
  } catch (e) {
    warn("profiles.read_threw", { err: e.message });
    return false;
  }
}

// ── Main entry point ─────────────────────────────────────
// Normalized request → { status, body }. The caller serializes.
// Wraps the work in withRequestContext so every log line inside the
// handler chain auto-carries the request id + method + path; logs
// request.start at entry and request.end at exit with durationMs.
export async function handleApiRequest({ method, pathname, query, body, headers }) {
  const rid = headers["x-request-id"] || newRequestId();
  return withRequestContext({ rid, method, path: pathname }, async () => {
    const t0 = Date.now();
    info("request.start", { ip: clientIp(headers) });
    try {
      const result = await _handle({ method, pathname, query, body, headers });
      info("request.end", { status: result.status, durationMs: Date.now() - t0 });
      return { ...result, headers: { ...(result.headers || {}), "X-Request-Id": rid } };
    } catch (err) {
      logError("request.failed", { err: err?.message, stack: err?.stack, durationMs: Date.now() - t0 });
      try { Sentry.captureException(err, { tags: { rid, path: pathname, method } }); } catch { /* swallow */ }
      throw err;
    }
  });
}

async function _handle({ method, pathname, query, body, headers }) {
  const parsed = body || {};
  const q = query || {};
  const h = headers || {};

  // IP-block check — brute-force detector populates this list when an
  // IP crosses the failed-auth threshold. Reject every request from a
  // blocked IP for 24 hours regardless of route.
  const ip = clientIp(h);
  if (isIpBlocked(ip)) {
    warn("ip_block.rejected", { ip });
    return { status: 429, body: { error: "Temporarily blocked due to suspicious activity" }, headers: { "Retry-After": "3600" } };
  }

  // Rate limit early — before we hit Supabase or any upstream API.
  const rl = await applyRateLimit(pathname, h);
  if (rl && !rl.allowed) {
    const retryAfter = 3600 - (Math.floor(Date.now() / 1000) % 3600);
    warn("rate.limit_hit", { action: matchAction(pathname), count: rl.count, max: rl.max });
    return {
      status: 429,
      body: { error: "Too many requests", retryAfter },
      headers: { "Retry-After": String(retryAfter) },
    };
  }

  if (pathname === "/api/snaptrade/status") {
    return { status: 200, body: { ok: true, clientId: CLIENT_ID.slice(0, 8) + "..." } };
  }

  if (pathname === "/api/snaptrade/brokerages") {
    // Public endpoint — returns SnapTrade's full supported-brokerage list.
    // No userSecret required; clientId + signature only.
    const r = await snapReq("GET", "/brokerages", null, {});
    const arr = Array.isArray(r.body) ? r.body : [];
    info("snaptrade.brokerages.ok", { count: arr.length });
    return { status: 200, body: { brokerages: arr } };
  }

  if (pathname === "/api/snaptrade/login" && method === "POST") {
    const { broker, connectionType = "read" } = parsed;
    if (!broker) return { status: 400, body: { error: "broker is required" } };

    const snap = await getSnapForRequest(h);
    const { userId, userSecret, supabaseUser } = snap;
    const loginRes = await snapReq(
      "POST", "/snapTrade/login",
      { broker, connectionType },
      { userId, userSecret }
    );
    if (loginRes.status !== 200) {
      const bodyTxt = JSON.stringify(loginRes.body || "").toLowerCase();
      let code = "SNAPTRADE_LOGIN_FAILED";
      let message = "We couldn't open the brokerage login flow. Please try again.";
      if (/limit|quota|plan/.test(bodyTxt)) {
        code = "SNAPTRADE_LIMIT_REACHED";
        message = "Brokerage connection limit reached for this account. Please contact support.";
      }
      logError("snaptrade.login.failed", { broker, status: loginRes.status, body: loginRes.body });
      const err = new Error(message);
      err.status = 502;
      err.code = code;
      throw err;
    }
    audit({ userId: supabaseUser?.id, action: "broker.connect_initiated", target: broker, metadata: { connectionType }, headers: h });
    info("snaptrade.login.ok", { broker });
    return { status: 200, body: { loginLink: loginRes.body.redirectURI } };
  }

  if (pathname === "/api/snaptrade/accounts") {
    let snap; try { snap = await getSnapForRequest(h); } catch { return { status: 200, body: { accounts: [] } }; }
    const { userId, userSecret } = snap;
    const r = await snapReq("GET", "/accounts", null, { userId, userSecret });
    return { status: 200, body: { accounts: Array.isArray(r.body) ? r.body : [] } };
  }

  if (pathname === "/api/snaptrade/all") {
    let snap; try { snap = await getSnapForRequest(h); } catch { return { status: 200, body: { accounts: [] } }; }
    const { userId, userSecret } = snap;

    const acctRes = await snapReq("GET", "/accounts", null, { userId, userSecret });
    const accounts = Array.isArray(acctRes.body) ? acctRes.body : [];

    const settled = await Promise.allSettled(accounts.map(async acct => {
      const posRes = await snapReq(
        "GET", `/accounts/${acct.id}/positions`, null,
        { userId, userSecret }
      );
      const instName = acct.brokerage?.name || acct.institution_name || "Unknown";
      return {
        accountId:     acct.id,
        accountName:   acct.name || acct.number || acct.id,
        brokerage:     instName,
        brokerageSlug: (acct.brokerage?.slug || instName.split(" ")[0]).toUpperCase(),
        balance:       acct.balance?.total?.amount || acct.total_value?.amount || 0,
        cash:          acct.balance?.cash?.amount  || 0,
        authorizationId: acct.brokerage_authorization || acct.brokerage_authorization_id || null,
        positions:     Array.isArray(posRes.body) ? posRes.body : [],
      };
    }));

    const result = settled.filter(r => r.status === "fulfilled").map(r => r.value);
    info("snaptrade.all.ok", { accounts: result.length, positions: result.reduce((s,a)=>s+a.positions.length,0) });
    return { status: 200, body: { accounts: result } };
  }

  if (pathname === "/api/snaptrade/disconnect" && method === "POST") {
    let snap; try { snap = await getSnapForRequest(h); } catch { return { status: 404, body: { error: "No registered user" } }; }
    const { userId, userSecret } = snap;

    let authId = parsed.authorizationId;
    const accountId = parsed.accountId;

    // If only an accountId is supplied, look up the parent authorization.
    if (!authId && accountId) {
      const acctRes = await snapReq("GET", "/accounts", null, { userId, userSecret });
      const accts = Array.isArray(acctRes.body) ? acctRes.body : [];
      const acct = accts.find(a => a.id === accountId);
      authId = acct?.brokerage_authorization || acct?.brokerage_authorization_id;
    }
    if (!authId) return { status: 400, body: { error: "brokerage_authorization not resolvable" } };

    const r = await snapReq("DELETE", `/authorizations/${authId}`, null,
      { userId, userSecret });
    if (r.status >= 200 && r.status < 300) {
      audit({ userId: snap.supabaseUser?.id, action: "broker.disconnect", target: authId, metadata: { accountId }, headers: h });
      info("snaptrade.disconnect.ok", { authId });
      return { status: 200, body: { ok: true, authorizationId: authId } };
    }
    return { status: r.status || 500, body: { error: `disconnect ${r.status}: ${JSON.stringify(r.body)}` } };
  }

  if (pathname === "/api/snaptrade/activities") {
    let snap; try { snap = await getSnapForRequest(h); } catch { return { status: 200, body: { activities: [] } }; }
    const { userId, userSecret } = snap;

    const today = new Date();
    const fiveYearsAgo = new Date(today); fiveYearsAgo.setFullYear(today.getFullYear() - 5);
    const startDate = q.startDate || fiveYearsAgo.toISOString().slice(0, 10);
    const endDate   = q.endDate   || today.toISOString().slice(0, 10);
    const accounts  = q.accounts;
    const type      = q.type;

    const extra = { userId, userSecret, startDate, endDate };
    if (accounts) extra.accounts = accounts;
    if (type)     extra.type     = type;

    const r = await snapReq("GET", "/activities", null, extra);
    const arr = Array.isArray(r.body) ? r.body : (r.body?.activities || []);
    info("snaptrade.activities.ok", { count: arr.length, startDate, endDate });
    return { status: 200, body: { activities: arr, startDate, endDate } };
  }

  if (pathname === "/api/snaptrade/holdings") {
    const accountId = q.accountId;
    if (!accountId) return { status: 400, body: { error: "accountId required" } };
    let snap; try { snap = await getSnapForRequest(h); } catch { return { status: 404, body: { error: "No registered user" } }; }
    const { userId, userSecret } = snap;
    const r = await snapReq(
      "GET", `/accounts/${accountId}/positions`, null,
      { userId, userSecret }
    );
    return { status: 200, body: { holdings: r.body } };
  }

  if (pathname === "/api/finnhub/earnings") {
    if (!FINNHUB_KEY) {
      info("finnhub.earnings.skipped", { reason: "no_key" });
      return { status: 200, body: { earningsCalendar: [] } };
    }
    const today = new Date();
    const plus30 = new Date(today); plus30.setDate(today.getDate() + 30);
    const from = q.from || today.toISOString().slice(0, 10);
    const to   = q.to   || plus30.toISOString().slice(0, 10);
    const finUrl = `https://finnhub.io/api/v1/calendar/earnings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&token=${encodeURIComponent(FINNHUB_KEY)}`;
    const r = await httpsGetJson(finUrl);
    const arr = Array.isArray(r.body?.earningsCalendar) ? r.body.earningsCalendar : [];
    info("finnhub.earnings.ok", { count: arr.length, from, to });
    return { status: 200, body: r.body && typeof r.body === "object" ? r.body : { earningsCalendar: [] } };
  }

  if (pathname === "/api/finnhub/dividends") {
    const symbol = q.symbol;
    if (!symbol) return { status: 400, body: { error: "symbol is required" } };
    if (!FINNHUB_KEY) {
      info("finnhub.dividends.skipped", { reason: "no_key", symbol });
      return { status: 200, body: { dividends: [] } };
    }
    const today = new Date();
    const oneYearAgo = new Date(today); oneYearAgo.setFullYear(today.getFullYear() - 1);
    const from = q.from || oneYearAgo.toISOString().slice(0, 10);
    const to   = q.to   || today.toISOString().slice(0, 10);
    const finUrl = `https://finnhub.io/api/v1/stock/dividend?symbol=${encodeURIComponent(symbol)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&token=${encodeURIComponent(FINNHUB_KEY)}`;
    const r = await httpsGetJson(finUrl);
    const arr = Array.isArray(r.body) ? r.body : [];
    info("finnhub.dividends.ok", { count: arr.length, symbol, from, to });
    return { status: 200, body: { dividends: arr } };
  }

  if (pathname === "/api/finnhub/profile2") {
    const symbol = q.symbol;
    if (!symbol) return { status: 400, body: { error: "symbol is required" } };
    if (!FINNHUB_KEY) return { status: 200, body: {} };
    const finUrl = `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(FINNHUB_KEY)}`;
    const r = await httpsGetJson(finUrl);
    return { status: 200, body: r.body && typeof r.body === "object" ? r.body : {} };
  }

  if (pathname === "/api/finnhub/metric") {
    const symbol = q.symbol;
    if (!symbol) return { status: 400, body: { error: "symbol is required" } };
    if (!FINNHUB_KEY) return { status: 200, body: { metric: {} } };
    const finUrl = `https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all&token=${encodeURIComponent(FINNHUB_KEY)}`;
    const r = await httpsGetJson(finUrl);
    return { status: 200, body: r.body && typeof r.body === "object" ? r.body : { metric: {} } };
  }

  // Batched live-quote proxy. Replaces direct browser → finnhub.io calls
  // so users never need to hold a vendor key in the browser bundle.
  // Accepts ?symbols=AAPL,MSFT,NVDA (max 25). Returns the same shape the
  // client's `fetchFinnhub` used to produce.
  if (pathname === "/api/finnhub/quote") {
    const symbolsRaw = (q.symbols || "").trim();
    if (!symbolsRaw) return { status: 200, body: { quotes: [] } };
    if (!FINNHUB_KEY) return { status: 200, body: { quotes: [] } };
    const symbols = symbolsRaw.split(",").map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 25);
    const settled = await Promise.allSettled(symbols.map(async sym => {
      const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${encodeURIComponent(FINNHUB_KEY)}`;
      const r = await httpsGetJson(url);
      const d = r.body || {};
      if (!d.c || d.c === 0) return null;
      return { tk: sym, price: d.c, chg: d.d, pct: d.dp, hi: d.h, lo: d.l, src: "Finnhub" };
    }));
    const quotes = settled.filter(r => r.status === "fulfilled" && r.value).map(r => r.value);
    return { status: 200, body: { quotes } };
  }

  if (pathname === "/api/finnhub/news") {
    if (!FINNHUB_KEY) return { status: 200, body: { news: [] } };
    const url = `https://finnhub.io/api/v1/news?category=general&token=${encodeURIComponent(FINNHUB_KEY)}`;
    const r = await httpsGetJson(url);
    const arr = Array.isArray(r.body) ? r.body : [];
    const news = arr.slice(0, 10).map(n => ({
      h: n.headline, src: n.source, url: n.url, s: "neutral",
      datetime: n.datetime || (Date.now() / 1000),
    }));
    return { status: 200, body: { news } };
  }

  if (pathname === "/api/snaptrade/documents") {
    let snap; try { snap = await getSnapForRequest(h); } catch {
      info("snaptrade.documents.skipped", { reason: "no_user" });
      return { status: 200, body: { documents: [] } };
    }
    const { userId, userSecret } = snap;
    const r = await snapReq("GET", "/documents", null, { userId, userSecret });
    const count = Array.isArray(r.body) ? r.body.length : (r.body?.documents?.length ?? 0);
    info("snaptrade.documents.ok", { count });
    return { status: 200, body: { documents: r.body } };
  }

  if (pathname === "/api/advisor" && method === "POST") {
    if (!ANTHROPIC_KEY) {
      info("advisor.skipped", { reason: "no_key" });
      return { status: 503, body: { error: "ANTHROPIC_KEY not configured server-side" } };
    }
    const messages   = Array.isArray(parsed.messages) ? parsed.messages : [];
    const system     = typeof parsed.system === "string" ? parsed.system : undefined;
    const max_tokens = Number.isFinite(parsed.max_tokens) ? parsed.max_tokens : 1024;
    const model      = typeof parsed.model === "string" && parsed.model
      ? parsed.model
      : "claude-sonnet-4-20250514";
    // Allow callers to request Anthropic's web_search tool (used by the
    // browser's price/news fallback). Only forward the documented tool
    // names so the proxy can't be abused to invoke arbitrary tools.
    const SAFE_TOOLS = new Set(["web_search_20250305"]);
    const tools = Array.isArray(parsed.tools)
      ? parsed.tools.filter(t => t && typeof t.type === "string" && SAFE_TOOLS.has(t.type))
      : null;

    const payload = { model, max_tokens, messages };
    if (system) payload.system = system;
    if (tools && tools.length) payload.tools = tools;
    const bodyStr = JSON.stringify(payload);

    const anthropicRes = await new Promise((resolve, reject) => {
      const r = https.request({
        hostname: "api.anthropic.com",
        port: 443,
        path: "/v1/messages",
        method: "POST",
        headers: {
          "Content-Type":      "application/json",
          "x-api-key":         ANTHROPIC_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Length":    Buffer.byteLength(bodyStr),
        },
      }, resp => {
        let data = "";
        resp.on("data", c => (data += c));
        resp.on("end", () => {
          try { resolve({ status: resp.statusCode, body: JSON.parse(data) }); }
          catch { resolve({ status: resp.statusCode, body: data }); }
        });
      });
      r.on("error", reject);
      r.write(bodyStr);
      r.end();
    });

    const usage = (typeof anthropicRes.body === "object" && anthropicRes.body?.usage) || {};
    const summary = usage.input_tokens
      ? `in=${usage.input_tokens || 0} out=${usage.output_tokens || 0}`
      : `status=${anthropicRes.status}`;
    info("advisor.ok", { summary });
    // Record so /api/admin/stats can count ai_queries_today.
    try {
      const advisorUser = await verifyUser(h);
      audit({
        userId: advisorUser?.id || null,
        action: "ai.advisor",
        metadata: {
          input_tokens:  usage.input_tokens  || 0,
          output_tokens: usage.output_tokens || 0,
          model,
          status: anthropicRes.status,
        },
        headers: h,
      });
    } catch { /* audit is best-effort */ }
    return { status: anthropicRes.status || 200, body: anthropicRes.body };
  }

  if (pathname === "/api/snaptrade/trade/impact" && method === "POST") {
    let snap; try { snap = await getSnapForRequest(h); } catch { return { status: 404, body: { error: "No registered user" } }; }
    const { userId, userSecret } = snap;

    const {
      accountId,
      action,
      units,
      symbol,
      orderType,
      price,
      stopPrice,
      timeInForce,
    } = parsed;
    if (!accountId || !action || !units || !symbol || !orderType) {
      return { status: 400, body: { error: "accountId, action, units, symbol, orderType required" } };
    }

    const tradeBody = {
      account_id:          accountId,
      action,
      universal_symbol_id: symbol,
      order_type:          orderType,
      time_in_force:       timeInForce || "Day",
      units,
      price:               price ?? null,
      stop:                stopPrice ?? null,
    };
    const r = await snapReq("POST", "/trade/impact", tradeBody, { userId, userSecret });
    if (r.status >= 200 && r.status < 300) {
      const tradeId = r.body?.trade?.id || r.body?.id || "(no id)";
      info("snaptrade.trade.impact.ok", { action, units, symbol, tradeId });
      return { status: 200, body: { impact: r.body } };
    }
    warn("snaptrade.trade.impact.failed", { status: r.status });
    return { status: r.status || 500, body: { error: `impact ${r.status}: ${JSON.stringify(r.body)}` } };
  }

  // Force a broker-side refresh of holdings + activities. SnapTrade's
  // /accounts endpoint normally returns their cache (refreshed every few
  // hours by their poller). To bypass the cache we fetch the user's
  // authorizations and POST /authorizations/{id}/refresh for each.
  //
  // SnapTrade rate-limits this per-connection (a few per hour). Per-
  // authorization throttling means a 429 on one connection shouldn't
  // block the others, so we aggregate per-auth results and only report a
  // top-level 429 if *every* connection was throttled.
  if (pathname === "/api/snaptrade/refresh" && method === "POST") {
    let snap; try { snap = await getSnapForRequest(h); } catch { return { status: 404, body: { error: "No registered user" } }; }
    const { userId, userSecret, supabaseUser } = snap;

    // 1) Look up the user's active authorizations.
    const authsRes = await snapReq("GET", "/authorizations", null, { userId, userSecret });
    if (authsRes.status < 200 || authsRes.status >= 300) {
      return { status: authsRes.status || 500, body: { error: `authorizations ${authsRes.status}: ${JSON.stringify(authsRes.body)}` } };
    }
    const auths = Array.isArray(authsRes.body) ? authsRes.body : [];
    if (auths.length === 0) {
      return { status: 200, body: { ok: true, queued: 0, total: 0, results: [], message: "No active connections to refresh." } };
    }

    // 2) Fire refresh per authorization. Track per-connection outcomes.
    const settled = await Promise.allSettled(auths.map(async a => {
      const r = await snapReq("POST", `/authorizations/${a.id}/refresh`, null, { userId, userSecret });
      return {
        authorizationId: a.id,
        brokerage: a.brokerage?.name || a.brokerage?.display_name || "Unknown",
        status: r.status,
        body: r.body,
      };
    }));
    const results = settled.map(s => s.status === "fulfilled" ? s.value : { status: 500, error: String(s.reason) });
    const queued = results.filter(r => r.status >= 200 && r.status < 300).length;
    const throttled = results.filter(r => r.status === 429).length;

    audit({ userId: supabaseUser?.id, action: "broker.force_refresh", metadata: { total: auths.length, queued, throttled }, headers: h });

    if (queued === 0 && throttled === auths.length) {
      return {
        status: 429,
        body: { error: "All connections are throttled by SnapTrade. Try again in ~1 hour.", results },
        headers: { "Retry-After": "3600" },
      };
    }
    if (queued === 0) {
      return { status: 502, body: { error: "SnapTrade rejected the refresh for all connections.", results } };
    }
    info("snaptrade.refresh.ok", { queued, total: auths.length, throttled });
    return { status: 200, body: { ok: true, queued, total: auths.length, throttled, results } };
  }

  if (pathname === "/api/snaptrade/trade/place" && method === "POST") {
    let snap; try { snap = await getSnapForRequest(h); } catch { return { status: 404, body: { error: "No registered user" } }; }
    const { userId, userSecret } = snap;

    const tradeId = parsed.tradeId;
    if (!tradeId) return { status: 400, body: { error: "tradeId required" } };

    const r = await snapReq("POST", `/trade/${tradeId}`, null, { userId, userSecret });
    if (r.status >= 200 && r.status < 300) {
      audit({ userId: snap.supabaseUser?.id, action: "trade.placed", target: tradeId, headers: h });
      info("snaptrade.trade.place.ok", { tradeId });
      return { status: 200, body: { placed: r.body } };
    }
    warn("snaptrade.trade.place.failed", { status: r.status });
    return { status: r.status || 500, body: { error: `place ${r.status}: ${JSON.stringify(r.body)}` } };
  }

  if (pathname === "/api/polygon/bars") {
    const symbol = q.symbol;
    if (!symbol) return { status: 400, body: { error: "symbol is required" } };
    if (!POLYGON_KEY) {
      info("polygon.bars.skipped", { reason: "no_key", symbol });
      return { status: 200, body: { bars: [] } };
    }
    const today = new Date();
    const fiveYearsAgo = new Date(today); fiveYearsAgo.setFullYear(today.getFullYear() - 5);
    const from     = q.from     || fiveYearsAgo.toISOString().slice(0, 10);
    const to       = q.to       || today.toISOString().slice(0, 10);
    const timespan = q.timespan || "day";
    const tickerUp = symbol.toUpperCase();

    // Cache check — 24h TTL. polygon_cache is service-role only; skip
    // when Supabase isn't configured (no perf gain, but route still works).
    const TTL_MS = 24 * 3600 * 1000;
    if (sbAdmin) {
      try {
        const { data: hit } = await sbAdmin.from("polygon_cache")
          .select("data, cached_at")
          .eq("ticker", tickerUp)
          .eq("from_date", from)
          .eq("to_date", to)
          .eq("timespan", timespan)
          .maybeSingle();
        if (hit?.cached_at && (Date.now() - new Date(hit.cached_at).getTime()) < TTL_MS) {
          const cached = Array.isArray(hit.data) ? hit.data : [];
          info("polygon.bars.cache_hit", { count: cached.length, symbol: tickerUp, from, to, timespan });
          return { status: 200, body: { bars: cached, cached: true } };
        }
      } catch (e) {
        warn("polygon.bars.cache_read_failed", { err: e.message });
      }
    }

    const polyUrl =
      `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(tickerUp)}` +
      `/range/1/${encodeURIComponent(timespan)}/${encodeURIComponent(from)}/${encodeURIComponent(to)}` +
      `?apiKey=${encodeURIComponent(POLYGON_KEY)}&adjusted=true&sort=asc&limit=5000`;
    const r = await httpsGetJson(polyUrl);
    const arr = Array.isArray(r.body?.results) ? r.body.results : [];
    info("polygon.bars.ok", { count: arr.length, symbol: tickerUp, from, to, timespan });

    // Write-back. UPSERT on the UNIQUE(ticker, from_date, to_date, timespan)
    // tuple so re-fetches refresh cached_at and keep the row fresh.
    if (sbAdmin && arr.length > 0) {
      sbAdmin.from("polygon_cache").upsert({
        ticker:    tickerUp,
        from_date: from,
        to_date:   to,
        timespan,
        data:      arr,
        cached_at: new Date().toISOString(),
      }, { onConflict: "ticker,from_date,to_date,timespan" })
        .then(({ error }) => { if (error) warn("polygon.bars.cache_write_failed", { err: error.message }); });
    }

    return { status: 200, body: { bars: arr } };
  }

  // Lightweight write-side audit endpoint. Client posts auth-state events
  // (sign-in, sign-out, password change, MFA enroll) so they land in the
  // same trail as server-side actions. user_id is taken from the JWT —
  // clients can't forge it.
  if (pathname === "/api/audit" && method === "POST") {
    const user = await verifyUser(h);
    if (!user) return { status: 401, body: { error: "Unauthenticated" } };
    const SAFE_ACTIONS = new Set([
      "auth.sign_in",
      "auth.sign_out",
      "auth.password_changed",
      "auth.mfa_enrolled",
      "auth.mfa_unenrolled",
      "settings.api_keys_saved",
    ]);
    const action = typeof parsed.action === "string" ? parsed.action : "";
    if (!SAFE_ACTIONS.has(action)) return { status: 400, body: { error: "Unknown action" } };
    const target = typeof parsed.target === "string" ? parsed.target.slice(0, 200) : null;
    const metadata = parsed.metadata && typeof parsed.metadata === "object" ? parsed.metadata : {};
    // New-device detection for sign-in events. Runs BEFORE the audit
    // insert so the comparison only sees prior sign-ins. Tag the metadata
    // with new_device:true so admin can filter on it later.
    if (action === "auth.sign_in") {
      const isNew = await checkNewDevice(sbAdmin, user.id, ip, h["user-agent"] || h["User-Agent"]);
      if (isNew) metadata.new_device = true;
    }
    audit({ userId: user.id, action, target, metadata, headers: h });
    return { status: 200, body: { ok: true } };
  }

  // Public auth-failure tracker — invoked by the client when
  // signInWithPassword returns an error. No JWT required (the user
  // didn't authenticate, by definition). Rate-limited via the "auth"
  // bucket; the brute-force detector handles 5-in-60s cases by adding
  // the IP to the in-memory block list which the entry-point above
  // checks on every subsequent request.
  if (pathname === "/api/auth/track-failure" && method === "POST") {
    const emailAttempt = typeof parsed.email === "string" ? parsed.email : null;
    await trackAuthFailure(sbAdmin, ip, emailAttempt);
    return { status: 200, body: { ok: true } };
  }

  // ── Plaid (banking aggregation) ──────────────────────
  // All Plaid endpoints require an authenticated Supabase user. The
  // access_token never leaves the server — clients only see sanitized
  // account info + balances + transactions.
  if (pathname.startsWith("/api/plaid/")) {
    if (!plaidClient) {
      return { status: 503, body: { error: "Plaid not configured server-side" } };
    }
    const user = await verifyUser(h);
    if (!user) return { status: 401, body: { error: "Unauthenticated" } };

    // Enforce AAL2 (MFA-verified session) on the action endpoints that
    // surface Plaid Link or change the connection set: link-token,
    // exchange, and item disconnect. Read endpoints (GET accounts /
    // transactions) operate on data the user already authorized at link
    // time, so we keep them at AAL1 to avoid prompting on every page
    // load. This matches Plaid's End User Data Protection guidance:
    // "MFA before Plaid Link is surfaced" — i.e., before the connection
    // is initiated or modified.
    const isGatedAction =
      (pathname === "/api/plaid/link-token" && method === "POST") ||
      (pathname === "/api/plaid/exchange"   && method === "POST") ||
      (pathname === "/api/plaid/item"       && method === "DELETE");
    if (isGatedAction) {
      const mfaErr = await requireAAL2(h, user);
      if (mfaErr) {
        return {
          status: mfaErr.status,
          body: { error: mfaErr.message, code: mfaErr.code },
        };
      }
    }

    // POST /api/plaid/link-token — create a Link token to launch Plaid Link.
    if (pathname === "/api/plaid/link-token" && method === "POST") {
      try {
        const r = await plaidClient.linkTokenCreate({
          user: { client_user_id: user.id },
          client_name: "MĪZAN",
          products: ["transactions"],
          country_codes: ["US"],
          language: "en",
        });
        return { status: 200, body: { link_token: r.data.link_token, expiration: r.data.expiration } };
      } catch (err) {
        const detail = err.response?.data || err.message;
        logError("plaid.link_token.failed", { detail });
        return { status: 500, body: { error: typeof detail === "string" ? detail : JSON.stringify(detail) } };
      }
    }

    // POST /api/plaid/exchange — exchange public_token for access_token,
    // persist to plaid_tokens, and seed plaid_accounts with the first
    // accounts/balance snapshot.
    if (pathname === "/api/plaid/exchange" && method === "POST") {
      const publicToken = parsed.public_token;
      const metadata    = parsed.metadata || {};
      if (!publicToken) return { status: 400, body: { error: "public_token required" } };
      try {
        const ex = await plaidClient.itemPublicTokenExchange({ public_token: publicToken });
        const access_token = ex.data.access_token;
        const item_id      = ex.data.item_id;
        const institution_name = metadata.institution?.name || "Unknown";
        const institution_id   = metadata.institution?.institution_id || null;

        // Persist token (server-only via service role).
        await sbAdmin.from("plaid_tokens").upsert({
          user_id: user.id, access_token, item_id, institution_name, institution_id,
        }, { onConflict: "item_id" });

        // Seed accounts.
        try {
          const acctRes = await plaidClient.accountsGet({ access_token });
          const rows = (acctRes.data.accounts || []).map(a => ({
            user_id: user.id, item_id, account_id: a.account_id,
            name: a.name, official_name: a.official_name,
            type: a.type, subtype: a.subtype, mask: a.mask,
            current_bal: a.balances?.current ?? null,
            available_bal: a.balances?.available ?? null,
            iso_currency: a.balances?.iso_currency_code || "USD",
            updated_at: new Date().toISOString(),
          }));
          if (rows.length) await sbAdmin.from("plaid_accounts").upsert(rows, { onConflict: "account_id" });
        } catch (acctErr) {
          logError("plaid.exchange.account_seed_failed", { err: acctErr.message });
        }

        audit({ userId: user.id, action: "bank.connect", target: institution_name, metadata: { item_id, institution_id }, headers: h });
        info("plaid.exchange.ok", { institution_name, item_id });
        return { status: 200, body: { ok: true, item_id, institution_name } };
      } catch (err) {
        const detail = err.response?.data || err.message;
        logError("plaid.exchange.failed", { detail });
        return { status: 500, body: { error: typeof detail === "string" ? detail : JSON.stringify(detail) } };
      }
    }

    // GET /api/plaid/accounts — refresh balances for every linked Item.
    if (pathname === "/api/plaid/accounts") {
      try {
        const { data: tokens } = await sbAdmin
          .from("plaid_tokens")
          .select("access_token, item_id, institution_name")
          .eq("user_id", user.id);
        if (!Array.isArray(tokens) || tokens.length === 0) {
          return { status: 200, body: { accounts: [] } };
        }
        const settled = await Promise.allSettled(tokens.map(async t => {
          const r = await plaidClient.accountsGet({ access_token: t.access_token });
          return (r.data.accounts || []).map(a => ({
            item_id: t.item_id,
            institution_name: t.institution_name,
            account_id: a.account_id,
            name: a.name,
            official_name: a.official_name,
            type: a.type,
            subtype: a.subtype,
            mask: a.mask,
            current_bal: a.balances?.current ?? null,
            available_bal: a.balances?.available ?? null,
            iso_currency: a.balances?.iso_currency_code || "USD",
          }));
        }));
        const accounts = settled.flatMap(r => r.status === "fulfilled" ? r.value : []);

        // Cache to plaid_accounts (best effort).
        if (accounts.length) {
          const rows = accounts.map(a => ({
            user_id: user.id, item_id: a.item_id, account_id: a.account_id,
            name: a.name, official_name: a.official_name,
            type: a.type, subtype: a.subtype, mask: a.mask,
            current_bal: a.current_bal, available_bal: a.available_bal,
            iso_currency: a.iso_currency,
            updated_at: new Date().toISOString(),
          }));
          await sbAdmin.from("plaid_accounts").upsert(rows, { onConflict: "account_id" });
        }
        return { status: 200, body: { accounts } };
      } catch (err) {
        const detail = err.response?.data || err.message;
        logError("plaid.accounts.failed", { detail });
        return { status: 500, body: { error: typeof detail === "string" ? detail : JSON.stringify(detail) } };
      }
    }

    // GET /api/plaid/transactions — pull recent transactions across all
    // linked Items via /transactions/sync. We don't paginate the cursor
    // across calls yet; on first call we return everything Plaid has.
    if (pathname === "/api/plaid/transactions") {
      try {
        const { data: tokens } = await sbAdmin
          .from("plaid_tokens")
          .select("access_token, item_id, institution_name")
          .eq("user_id", user.id);
        if (!Array.isArray(tokens) || tokens.length === 0) {
          return { status: 200, body: { transactions: [] } };
        }
        const settled = await Promise.allSettled(tokens.map(async t => {
          // sync until has_more=false; cap to 5 pages to avoid runaway.
          let cursor;
          const out = [];
          for (let p = 0; p < 5; p++) {
            const r = await plaidClient.transactionsSync({ access_token: t.access_token, cursor });
            out.push(...(r.data.added || []));
            if (!r.data.has_more) break;
            cursor = r.data.next_cursor;
          }
          return out.map(tx => ({
            transaction_id: tx.transaction_id,
            account_id: tx.account_id,
            item_id: t.item_id,
            institution_name: t.institution_name,
            date: tx.date,
            authorized_date: tx.authorized_date,
            name: tx.name,
            merchant_name: tx.merchant_name,
            amount: tx.amount,                                    // Plaid: positive = outflow, negative = inflow
            iso_currency: tx.iso_currency_code || "USD",
            category: tx.category || [],
            personal_finance_category: tx.personal_finance_category || null,
            pending: tx.pending,
            payment_channel: tx.payment_channel,
          }));
        }));
        const transactions = settled.flatMap(r => r.status === "fulfilled" ? r.value : []);
        transactions.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
        return { status: 200, body: { transactions } };
      } catch (err) {
        const detail = err.response?.data || err.message;
        logError("plaid.transactions.failed", { detail });
        return { status: 500, body: { error: typeof detail === "string" ? detail : JSON.stringify(detail) } };
      }
    }

    // DELETE /api/plaid/item — disconnect a linked Item.
    if (pathname === "/api/plaid/item" && method === "DELETE") {
      const itemId = q.itemId || q.item_id || parsed.itemId || parsed.item_id;
      if (!itemId) return { status: 400, body: { error: "itemId required" } };
      try {
        const { data: row } = await sbAdmin
          .from("plaid_tokens").select("access_token, institution_name")
          .eq("user_id", user.id).eq("item_id", itemId).maybeSingle();
        if (!row) return { status: 404, body: { error: "Item not found" } };
        try { await plaidClient.itemRemove({ access_token: row.access_token }); }
        catch (rmErr) { warn("plaid.item_remove.warning", { err: rmErr.message }); }
        await sbAdmin.from("plaid_accounts").delete().eq("user_id", user.id).eq("item_id", itemId);
        await sbAdmin.from("plaid_tokens"  ).delete().eq("user_id", user.id).eq("item_id", itemId);
        audit({ userId: user.id, action: "bank.disconnect", target: row.institution_name, metadata: { item_id: itemId }, headers: h });
        return { status: 200, body: { ok: true, item_id: itemId } };
      } catch (err) {
        const detail = err.response?.data || err.message;
        logError("plaid.item_delete.failed", { detail });
        return { status: 500, body: { error: typeof detail === "string" ? detail : JSON.stringify(detail) } };
      }
    }

    return { status: 404, body: { error: "Unknown plaid endpoint" } };
  }

  // ── Admin gate ──────────────────────────────────────────
  // Centralized check used by every /api/admin/* route. Returns either
  // an early response (401/403) or the verified user object.
  async function requireAdmin() {
    if (!sbAdmin) return { early: { status: 503, body: { error: "Supabase not configured" } } };
    const user = await verifyUser(h);
    if (!user) return { early: { status: 401, body: { error: "Unauthenticated" } } };
    const ok = await isRootUser(user);
    if (!ok) {
      warn("admin.denied", { email: user.email, userId: user.id });
      return { early: { status: 403, body: { error: "Admin only" } } };
    }
    setLogContext({ adminId: user.id, adminEmail: user.email });
    return { user };
  }

  // ── Sentry sanity-check (admin-only) ────────────────────
  // Intentionally throws so we can verify Sentry capture works end-to-end.
  // 404 (not 403) for non-admins so attackers can't discover the route.
  if (pathname === "/api/debug/sentry-test") {
    const user = await verifyUser(h);
    if (!user || !(await isRootUser(user))) {
      return { status: 404, body: { error: "Not found" } };
    }
    info("sentry.test_route.fired");
    throw new Error("Sentry test — intentional throw from /api/debug/sentry-test");
  }

  // ── DB schema status (admin-only) ───────────────────────
  // Returns which migration tables exist + last-run timestamps for the
  // scheduled cron jobs. Lets you verify the schema + cron health without
  // logging into the Supabase dashboard.
  if (pathname === "/api/admin/db-status") {
    const gate = await requireAdmin();
    if (gate.early) return gate.early;

    const MIGRATIONS = [
      { file: "001_audit_log.sql",  tables: ["audit_log"] },
      { file: "002_user_state.sql", tables: ["user_snaptrade", "user_state", "user_keys"] },
      { file: "003_plaid.sql",      tables: ["plaid_tokens", "plaid_accounts"] },
      { file: "004_rate_limits.sql", tables: ["rate_limits"] },
      { file: "005_profiles.sql",   tables: ["profiles"] },
    ];
    const expectedTables = MIGRATIONS.flatMap((m) => m.tables);

    // Probe each table with a HEAD count. information_schema.tables isn't
    // queryable via PostgREST by default, so the per-table probe is the
    // reliable path. Errors fall through (table missing).
    const present = new Set();
    await Promise.all(expectedTables.map(async (t) => {
      try {
        const probe = await sbAdmin.from(t).select("*", { count: "exact", head: true });
        if (!probe.error) present.add(t);
      } catch { /* table missing */ }
    }));

    const status = MIGRATIONS.map((m) => ({
      migration: m.file,
      tables:    m.tables.map((t) => ({ name: t, present: present.has(t) })),
      complete:  m.tables.every((t) => present.has(t)),
    }));

    // Last-run for each cron job. checkCronStaleness reads audit_log,
    // returns the same shape as before, AND sends an alert (deduped to
    // once per 30 min) if either cron is older than 25 hours.
    const cronStatus = present.has("audit_log")
      ? await checkCronStaleness(sbAdmin)
      : {};

    return {
      status: 200,
      body: {
        ok:         status.every((s) => s.complete),
        migrations: status,
        missing:    expectedTables.filter((t) => !present.has(t)),
        cron:       cronStatus,
      },
    };
  }

  // ── Admin: list users ───────────────────────────────────
  // Source of truth = public.profiles. The 005 trigger keeps it in 1:1
  // sync with auth.users (INSERT on signup) and the FK ON DELETE CASCADE
  // removes rows when a user is deleted, so every user appears exactly
  // once. We previously read from sbAdmin.auth.admin.listUsers() but its
  // pagination is flaky — `perPage: 200` sometimes returned only the
  // first 50 rows, causing users that existed pre-migration to disappear
  // from the admin panel.
  if (pathname === "/api/admin/users") {
    const gate = await requireAdmin();
    if (gate.early) return gate.early;
    const limit  = Math.min(500, Math.max(1, parseInt(q.limit || "200", 10)));
    const offset = Math.max(0, parseInt(q.offset || "0", 10));

    const { data: profiles, error: profErr, count } = await sbAdmin
      .from("profiles")
      .select("id, email, is_root, suspended, created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (profErr) return { status: 500, body: { error: profErr.message } };

    // Best-effort enrichment for last_sign_in_at. Skips silently if the
    // admin API page doesn't include a given user — the row still
    // renders, just with last_sign_in: null.
    let lastSignInById = new Map();
    try {
      const { data: au } = await sbAdmin.auth.admin.listUsers({
        page: 1, perPage: Math.max(200, limit),
      });
      lastSignInById = new Map((au?.users || []).map((u) => [u.id, u.last_sign_in_at]));
    } catch (e) { warn("admin.users.list_auth_failed", { err: e.message }); }

    const users = (profiles || []).map((p) => ({
      id:           p.id,
      email:        p.email,
      created_at:   p.created_at,
      last_sign_in: lastSignInById.get(p.id) || null,
      is_root:      !!p.is_root,
      suspended:    !!p.suspended,
    }));
    return { status: 200, body: { users, count: count || users.length, limit, offset } };
  }

  // ── Admin: suspend / unsuspend ──────────────────────────
  const suspendMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/(suspend|unsuspend)$/);
  if (suspendMatch && method === "POST") {
    const gate = await requireAdmin();
    if (gate.early) return gate.early;
    const [, targetId, op] = suspendMatch;
    const suspended = op === "suspend";
    const { error: upErr } = await sbAdmin.from("profiles").upsert({
      id: targetId, suspended,
      suspended_at:     suspended ? new Date().toISOString() : null,
      suspended_reason: suspended ? (parsed.reason || null) : null,
      updated_at:       new Date().toISOString(),
    });
    if (upErr) return { status: 500, body: { error: upErr.message } };
    audit({ userId: gate.user.id, action: `admin.user.${op}`, target: targetId, metadata: { reason: parsed.reason }, headers: h });
    info(`admin.user.${op}`, { targetId });
    return { status: 200, body: { ok: true, userId: targetId, suspended } };
  }

  // ── Admin: disconnect a broker for another user ─────────
  const brokerDeleteMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/broker$/);
  if (brokerDeleteMatch && method === "DELETE") {
    const gate = await requireAdmin();
    if (gate.early) return gate.early;
    const targetId = brokerDeleteMatch[1];
    const authId   = q.authId;
    if (!authId) return { status: 400, body: { error: "Missing authId" } };
    const { data: row, error: rowErr } = await sbAdmin
      .from("user_snaptrade")
      .select("snaptrade_user_id, snaptrade_user_secret")
      .eq("user_id", targetId).maybeSingle();
    if (rowErr || !row?.snaptrade_user_secret) {
      return { status: 404, body: { error: "Target has no SnapTrade record" } };
    }
    const r = await snapReq("DELETE", `/authorizations/${authId}`, null, {
      userId: row.snaptrade_user_id, userSecret: row.snaptrade_user_secret,
    });
    audit({ userId: gate.user.id, action: "admin.broker.disconnect", target: authId, metadata: { targetUserId: targetId, status: r.status }, headers: h });
    return { status: r.status, body: r.body };
  }

  // ── Admin: paginated audit log viewer ───────────────────
  if (pathname === "/api/admin/audit-log") {
    const gate = await requireAdmin();
    if (gate.early) return gate.early;
    const limit  = Math.min(500, Math.max(1, parseInt(q.limit || "100", 10)));
    const explicitOffset = q.offset !== undefined && q.offset !== "";
    const offset = explicitOffset
      ? Math.max(0, parseInt(q.offset, 10) || 0)
      : Math.max(0, (parseInt(q.page || "0", 10) || 0) * limit);
    const { data, error: alErr, count } = await sbAdmin
      .from("audit_log")
      .select("id, user_id, action, target, metadata, ip, user_agent, created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (alErr) return { status: 500, body: { error: alErr.message } };
    // Enrich each row with the actor's email so the UI can show
    // "khanstyle02@gmail.com" instead of a truncated UUID. One SELECT
    // against profiles (which 005 keeps in sync with auth.users).
    const rows = data || [];
    const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
    let emailById = new Map();
    if (userIds.length > 0) {
      const { data: profs } = await sbAdmin
        .from("profiles").select("id, email").in("id", userIds);
      emailById = new Map((profs || []).map((p) => [p.id, p.email]));
    }
    const enriched = rows.map((r) => ({ ...r, email: emailById.get(r.user_id) || null }));
    return { status: 200, body: { rows: enriched, total: count || 0, limit, offset } };
  }

  // ── Admin: top-line stats ───────────────────────────────
  if (pathname === "/api/admin/stats") {
    const gate = await requireAdmin();
    if (gate.early) return gate.early;
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

    // Parallel HEAD counts — cheap. users_total reads the profiles table
    // (auto-created on signup) rather than auth.admin.listUsers because
    // the latter returns the page slice, not the true total.
    const [usersTotal, dau, syncsToday, aiToday] = await Promise.all([
      sbAdmin.from("profiles").select("*", { count: "exact", head: true }),
      sbAdmin.from("audit_log").select("*", { count: "exact", head: true })
        .eq("action", "auth.sign_in").gte("created_at", weekAgo),
      sbAdmin.from("audit_log").select("*", { count: "exact", head: true })
        .eq("action", "cron.sync").gte("created_at", dayAgo),
      sbAdmin.from("audit_log").select("*", { count: "exact", head: true })
        .eq("action", "ai.advisor").gte("created_at", dayAgo),
    ]);
    return {
      status: 200,
      body: {
        users_total:        usersTotal?.count || 0,
        active_last_7_days: dau?.count || 0,
        syncs_today:        syncsToday?.count || 0,
        ai_queries_today:   aiToday?.count || 0,
      },
    };
  }

  // ── Cleanup cron (90-day audit log + 24-hour rate_limits) ─
  // Vercel cron POSTs Authorization: Bearer ${CRON_SECRET}. Without the
  // secret the endpoint is unreachable, so we don't accidentally let
  // anonymous traffic trigger a destructive sweep.
  if (pathname === "/api/cron/cleanup") {
    if (CRON_SECRET) {
      const authHeader = h.authorization || h.Authorization || "";
      if (authHeader !== `Bearer ${CRON_SECRET}`) {
        warn("cron.cleanup.unauth");
        return { status: 401, body: { error: "Unauthorized" } };
      }
    }
    if (!sbAdmin) return { status: 200, body: { ok: true, skipped: "no-supabase" } };

    const ninetyDaysAgo  = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
    const oneDayAgo      = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

    let deletedAudit = 0, deletedRate = 0;
    try {
      const { count: a } = await sbAdmin.from("audit_log")
        .delete({ count: "exact" })
        .lt("created_at", ninetyDaysAgo);
      deletedAudit = a || 0;
    } catch (e) { warn("cron.cleanup.audit_failed", { err: e.message }); }
    try {
      const { count: r } = await sbAdmin.from("rate_limits")
        .delete({ count: "exact" })
        .lt("created_at", oneDayAgo);
      deletedRate = r || 0;
    } catch (e) { warn("cron.cleanup.rate_failed", { err: e.message }); }

    info("cron.cleanup.ok", { deleted_audit: deletedAudit, deleted_rate_limits: deletedRate });
    // Self-record so /api/admin/db-status can surface "last cleanup ran X hours ago"
    audit({ action: "cron.cleanup", metadata: { deleted_audit: deletedAudit, deleted_rate_limits: deletedRate }, headers: h });
    return { status: 200, body: { ok: true, deleted_audit: deletedAudit, deleted_rate_limits: deletedRate } };
  }

  // ── Account sessions ────────────────────────────────────
  // Reads/revokes auth.sessions for the calling user via the 006 RPCs.
  // GET    /api/account/sessions          → list with .current flag
  // DELETE /api/account/sessions/:id      → revoke one
  // DELETE /api/account/sessions          → revoke all except current
  if (pathname === "/api/account/sessions" && method === "GET") {
    const user = await verifyUser(h);
    if (!user) return { status: 401, body: { error: "Unauthenticated" } };
    if (!sbAdmin) return { status: 503, body: { error: "Supabase not configured" } };
    const currentSessionId = jwtPayload(h)?.session_id || null;
    const { data, error: rpcErr } = await sbAdmin.rpc("get_user_sessions", { p_user_id: user.id });
    if (rpcErr) {
      logError("sessions.list_failed", { err: rpcErr.message });
      return { status: 500, body: { error: rpcErr.message } };
    }
    const sessions = (data || []).map((s) => ({
      id:           s.id,
      created_at:   s.created_at,
      last_seen_at: s.refreshed_at || s.updated_at || s.created_at,
      not_after:    s.not_after,
      user_agent:   s.user_agent || null,
      ip:           s.ip || null,
      current:      currentSessionId === s.id,
    }));
    return { status: 200, body: { sessions, count: sessions.length, current_session_id: currentSessionId } };
  }

  const sessionDelMatch = pathname.match(/^\/api\/account\/sessions\/([^/]+)$/);
  if (sessionDelMatch && method === "DELETE") {
    const user = await verifyUser(h);
    if (!user) return { status: 401, body: { error: "Unauthenticated" } };
    if (!sbAdmin) return { status: 503, body: { error: "Supabase not configured" } };
    const sessionId = sessionDelMatch[1];
    const { data: n, error: rpcErr } = await sbAdmin.rpc("revoke_session", {
      p_session_id: sessionId, p_user_id: user.id,
    });
    if (rpcErr) return { status: 500, body: { error: rpcErr.message } };
    if (!n || n === 0) return { status: 404, body: { error: "Session not found" } };
    audit({ userId: user.id, action: "session.revoked", target: sessionId, headers: h });
    info("sessions.revoke.ok", { sessionId });
    return { status: 200, body: { ok: true, revoked: 1 } };
  }

  if (pathname === "/api/account/sessions" && method === "DELETE") {
    const user = await verifyUser(h);
    if (!user) return { status: 401, body: { error: "Unauthenticated" } };
    if (!sbAdmin) return { status: 503, body: { error: "Supabase not configured" } };
    const currentSessionId = jwtPayload(h)?.session_id || null;
    const { data: n, error: rpcErr } = await sbAdmin.rpc("revoke_other_sessions", {
      p_user_id: user.id, p_current_session: currentSessionId,
    });
    if (rpcErr) return { status: 500, body: { error: rpcErr.message } };
    audit({ userId: user.id, action: "session.revoke_others", metadata: { revoked: n || 0 }, headers: h });
    info("sessions.revoke_others.ok", { revoked: n || 0 });
    return { status: 200, body: { ok: true, revoked: n || 0 } };
  }

  // ── Email change (Supabase sends confirmation to new address) ─
  if (pathname === "/api/account/email" && method === "POST") {
    const user = await verifyUser(h);
    if (!user) return { status: 401, body: { error: "Unauthenticated" } };
    if (!sbAdmin) return { status: 503, body: { error: "Supabase not configured" } };

    const newEmail = (parsed?.newEmail || "").trim().toLowerCase();
    const currentPassword = parsed?.currentPassword || "";

    // Basic format check — Supabase validates more strictly server-side.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      return { status: 400, body: { error: "Invalid email format" } };
    }
    if (newEmail === (user.email || "").toLowerCase()) {
      return { status: 400, body: { error: "New email matches the current address" } };
    }
    if (!currentPassword) {
      return { status: 400, body: { error: "Current password required" } };
    }

    // Daily rate limit: 3 email change attempts per 24 hours per user.
    // Use a custom window key keyed by the date string instead of hour.
    const dayKey = `email_change:${new Date().toISOString().slice(0, 10)}`;
    const { data: rlData } = await sbAdmin.rpc("increment_rate_limit", {
      p_user_id: user.id, p_window_key: dayKey, p_max: 3,
    });
    const allowed = (Array.isArray(rlData) ? rlData[0] : rlData)?.allowed;
    if (allowed === false) {
      return { status: 429, body: { error: "Too many email change attempts. Try again tomorrow." } };
    }

    // Re-authenticate with the current password. We can't reuse the
    // session — signInWithPassword via the admin client creates a new
    // session row we don't want. Use a dedicated client with anon key
    // (already initialized when supabase is configured), but anon-key
    // client isn't in scope server-side here. Workaround: call the
    // Supabase REST grant_type=password endpoint via fetch.
    let reauthOK = false;
    try {
      const tokenRes = await new Promise((resolve, reject) => {
        const body = JSON.stringify({ email: user.email, password: currentPassword });
        const url  = new URL(SUPABASE_URL);
        const req = https.request({
          hostname: url.hostname, port: 443,
          path: "/auth/v1/token?grant_type=password",
          method: "POST",
          headers: {
            "Content-Type":    "application/json",
            "apikey":          SUPABASE_SERVICE_ROLE_KEY,
            "Authorization":   `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "Content-Length":  Buffer.byteLength(body),
          },
        }, resp => {
          let buf = "";
          resp.on("data", c => buf += c);
          resp.on("end", () => resolve({ status: resp.statusCode, body: buf }));
        });
        req.on("error", reject); req.write(body); req.end();
      });
      reauthOK = tokenRes.status >= 200 && tokenRes.status < 300;
    } catch (e) {
      warn("email_change.reauth_failed", { err: e.message });
    }
    if (!reauthOK) {
      return { status: 401, body: { error: "Current password is incorrect" } };
    }

    // Trigger the email change. Supabase emails the NEW address with a
    // confirmation link; the actual swap only happens after click.
    const { error: upErr } = await sbAdmin.auth.admin.updateUserById(user.id, { email: newEmail });
    if (upErr) {
      // "User already registered" → conflict
      const status = /already|registered|exists/i.test(upErr.message) ? 409 : 500;
      const msg = status === 409 ? "That email is already registered" : upErr.message;
      return { status, body: { error: msg } };
    }

    // Audit with hashed emails — never log plaintext.
    const sha = (s) => crypto.createHash("sha256").update(String(s || "").toLowerCase()).digest("hex");
    audit({
      userId: user.id,
      action: "email_change_requested",
      metadata: { old_email_hash: sha(user.email), new_email_hash: sha(newEmail) },
      headers: h,
    });
    info("email_change.requested");
    return {
      status: 200,
      body: { message: "Confirmation sent to new email. The change takes effect after you click the link." },
    };
  }

  // ── Account export (GDPR data dump) ─────────────────────
  if (pathname === "/api/account/export" && method === "GET") {
    const user = await verifyUser(h);
    if (!user) return { status: 401, body: { error: "Unauthenticated" } };
    if (!sbAdmin) return { status: 503, body: { error: "Supabase not configured" } };

    // Gather everything user-scoped in parallel.
    const [profile, userState, userKeys, auditLog, plaidAccts] = await Promise.all([
      sbAdmin.from("profiles").select("*").eq("id", user.id).maybeSingle(),
      sbAdmin.from("user_state").select("key, value, updated_at").eq("user_id", user.id),
      sbAdmin.from("user_keys").select("finnhub_key, polygon_key, updated_at").eq("user_id", user.id).maybeSingle(),
      sbAdmin.from("audit_log").select("action, target, metadata, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1000),
      sbAdmin.from("plaid_accounts").select("*").eq("user_id", user.id),
    ]);

    // SnapTrade holdings + activities for the user, if any.
    let snapAccounts = [], snapActivities = [];
    try {
      const snap = await getSnapForRequest(h);
      if (snap) {
        const acctR = await snapReq("GET", "/accounts", null, snap);
        snapAccounts = Array.isArray(acctR.body) ? acctR.body : [];
        const today = new Date(); const twoYearsAgo = new Date(today); twoYearsAgo.setFullYear(today.getFullYear() - 2);
        const actR = await snapReq("GET", "/activities", null, {
          ...snap, startDate: twoYearsAgo.toISOString().slice(0, 10), endDate: today.toISOString().slice(0, 10),
        });
        snapActivities = Array.isArray(actR.body) ? actR.body : (actR.body?.activities || []);
      }
    } catch (e) { warn("export.snaptrade_failed", { err: e.message }); }

    const exported = {
      exported_at:    new Date().toISOString(),
      user: { id: user.id, email: user.email, created_at: user.created_at },
      profile:        profile.data || null,
      user_state:     userState.data || [],
      user_keys:      userKeys.data || null,
      audit_log:      auditLog.data || [],
      plaid_accounts: plaidAccts.data || [],
      snap_accounts:  snapAccounts,
      snap_activities: snapActivities,
    };
    audit({ userId: user.id, action: "account.export", metadata: { rows: (auditLog.data || []).length }, headers: h });
    const dateStr = new Date().toISOString().slice(0, 10);
    return {
      status: 200,
      body: exported,
      headers: {
        "Content-Type":        "application/json",
        "Content-Disposition": `attachment; filename="mizan-export-${dateStr}.json"`,
      },
    };
  }

  // ── Account delete (cascade) ────────────────────────────
  if (pathname === "/api/account" && method === "DELETE") {
    const user = await verifyUser(h);
    if (!user) return { status: 401, body: { error: "Unauthenticated" } };
    if (!sbAdmin) return { status: 503, body: { error: "Supabase not configured" } };

    // Require an explicit confirmation in the body. Anything else is a 400.
    // Belt-and-suspenders since the frontend modal also gates on "DELETE".
    if (parsed?.confirm !== "DELETE") {
      return { status: 400, body: { error: 'Must POST { "confirm": "DELETE" }' } };
    }

    // Step 1: remove SnapTrade user (deletes all their broker authorizations).
    try {
      const { data: row } = await sbAdmin.from("user_snaptrade")
        .select("snaptrade_user_id, snaptrade_user_secret").eq("user_id", user.id).maybeSingle();
      if (row?.snaptrade_user_secret) {
        await snapReq("DELETE", "/snapTrade/deleteUser", null, {
          userId: row.snaptrade_user_id, userSecret: row.snaptrade_user_secret,
        });
      }
    } catch (e) { warn("delete.snaptrade_failed", { err: e.message }); }

    // Step 2: remove Plaid Items (each unlinks the bank). Failures don't
    // block deletion — the Postgres cascade still removes our row.
    try {
      const { data: items } = await sbAdmin.from("plaid_tokens")
        .select("item_id, access_token").eq("user_id", user.id);
      if (plaidClient && Array.isArray(items)) {
        for (const item of items) {
          try { await plaidClient.itemRemove({ access_token: item.access_token }); }
          catch (e) { warn("delete.plaid_remove_failed", { item_id: item.item_id, err: e.message }); }
        }
      }
    } catch (e) { warn("delete.plaid_list_failed", { err: e.message }); }

    // Step 3: write the audit entry BEFORE deleting the row, so it survives
    // the ON DELETE SET NULL cascade (user_id becomes null but the action
    // is preserved for compliance).
    audit({ userId: user.id, action: "account.delete", metadata: { email: user.email }, headers: h });
    // Give the audit insert a moment to flush (we don't await it directly).
    await new Promise((r) => setTimeout(r, 100));

    // Step 4: delete the auth.users row. ON DELETE CASCADE on every user-
    // scoped table removes their rows automatically (user_snaptrade,
    // user_state, user_keys, plaid_tokens, plaid_accounts, profiles).
    const { error: delErr } = await sbAdmin.auth.admin.deleteUser(user.id);
    if (delErr) {
      logError("account.delete.failed", { userId: user.id, err: delErr.message });
      return { status: 500, body: { error: delErr.message } };
    }
    info("account.delete.ok", { userId: user.id, email: user.email });
    return { status: 200, body: { ok: true } };
  }

  // ── Daily sync cron ─────────────────────────────────────
  // Triggered by Vercel Cron at 06:00 UTC every day.
  // Iterates all registered SnapTrade users and fetches their latest
  // activities so SnapTrade's cache is warm when users open the app.
  if (pathname === "/api/cron/sync") {
    if (CRON_SECRET) {
      const authHeader = h.authorization || h.Authorization || "";
      if (authHeader !== `Bearer ${CRON_SECRET}`) {
        return { status: 401, body: { error: "Unauthorized" } };
      }
    }
    if (!sbAdmin) {
      return { status: 200, body: { ok: true, synced: 0, skipped: "no-supabase" } };
    }

    const { data: users, error: usersErr } = await sbAdmin
      .from("user_snaptrade")
      .select("user_id, snaptrade_user_id, snaptrade_user_secret");
    if (usersErr) throw new Error(`user_snaptrade select: ${usersErr.message}`);

    const today       = new Date();
    const twoYearsAgo = new Date(today); twoYearsAgo.setFullYear(today.getFullYear() - 2);
    const startDate   = twoYearsAgo.toISOString().slice(0, 10);
    const endDate     = today.toISOString().slice(0, 10);

    let synced = 0, failed = 0, refreshed = 0, refreshFailed = 0;
    const BATCH = 5;
    for (let i = 0; i < (users || []).length; i += BATCH) {
      const batch = users.slice(i, i + BATCH);
      const settled = await Promise.allSettled(batch.map(async u => {
        // Ask SnapTrade to pull fresh balances/positions from each broker
        // before we read activities. Without this, /activities reflects
        // whatever SnapTrade captured on its own background poll (T+1 or
        // longer for brokers like Fidelity), so recent deposits and
        // share-count changes never surface until the user manually
        // clicks Force Refresh in the UI. SnapTrade rate-limits this to a
        // few per hour per connection, so once-daily is well within
        // limits. Failures are non-fatal — we still pull activities.
        try {
          const authsRes = await snapReq("GET", "/authorizations", null, {
            userId: u.snaptrade_user_id,
            userSecret: u.snaptrade_user_secret,
          });
          const auths = Array.isArray(authsRes.body) ? authsRes.body : [];
          const results = await Promise.allSettled(auths.map(a =>
            snapReq("POST", `/authorizations/${a.id}/refresh`, null, {
              userId: u.snaptrade_user_id,
              userSecret: u.snaptrade_user_secret,
            })
          ));
          const okCount = results.filter(r =>
            r.status === "fulfilled" && r.value?.status >= 200 && r.value?.status < 300
          ).length;
          refreshed += okCount;
          refreshFailed += results.length - okCount;
        } catch (refreshErr) {
          warn("cron.sync.refresh_failed", { stUserId: u.snaptrade_user_id, err: refreshErr.message });
        }

        const r = await snapReq("GET", "/activities", null, {
          userId: u.snaptrade_user_id,
          userSecret: u.snaptrade_user_secret,
          startDate, endDate,
        });
        const count = Array.isArray(r.body) ? r.body.length : (r.body?.activities?.length ?? 0);
        await sbAdmin.from("user_state").upsert({
          user_id:    u.user_id,
          key:        "last_synced",
          value:      { synced_at: new Date().toISOString(), activities: count },
          updated_at: new Date().toISOString(),
        });
        return count;
      }));
      synced += settled.filter(r => r.status === "fulfilled").length;
      failed += settled.filter(r => r.status === "rejected").length;
    }

    info("cron.sync.ok", { synced, total: (users || []).length, failed, refreshed, refreshFailed });
    return { status: 200, body: { ok: true, synced, failed, refreshed, refreshFailed, total: (users || []).length } };
  }

  // ── Net-worth nightly snapshot cron ─────────────────────
  // Walks every SnapTrade-connected user, sums their account balances,
  // appends today's total to `user_state.networth_history` (capped at the
  // last 365 entries). Vercel schedule: 04:55 UTC daily.
  if (pathname === "/api/cron/nightly-snapshot") {
    if (CRON_SECRET) {
      const authHeader = h.authorization || h.Authorization || "";
      if (authHeader !== `Bearer ${CRON_SECRET}`) {
        return { status: 401, body: { error: "Unauthorized" } };
      }
    }
    if (!sbAdmin) return { status: 200, body: { ok: true, skipped: "no-supabase" } };

    let processed = 0, failed = 0;
    let lastErr = null;
    try {
      const { data: users, error: usersErr } = await sbAdmin
        .from("user_snaptrade")
        .select("user_id, snaptrade_user_id, snaptrade_user_secret");
      if (usersErr) throw new Error(`user_snaptrade select: ${usersErr.message}`);

      const today = new Date().toISOString().slice(0, 10);

      for (const u of (users || [])) {
        try {
          const acctRes = await snapReq("GET", "/accounts", null, {
            userId: u.snaptrade_user_id,
            userSecret: u.snaptrade_user_secret,
          });
          const accounts = Array.isArray(acctRes.body) ? acctRes.body : [];
          const total = accounts.reduce((s, a) => {
            const bal = a.balance?.total?.amount ?? a.total_value?.amount ?? 0;
            return s + (Number.isFinite(bal) ? bal : 0);
          }, 0);

          // Read existing history → append → cap → write back.
          const { data: prev } = await sbAdmin.from("user_state")
            .select("value")
            .eq("user_id", u.user_id)
            .eq("key", "networth_history")
            .maybeSingle();
          const prevArr = Array.isArray(prev?.value) ? prev.value : [];
          // Replace today's entry if it already exists, otherwise append.
          const filtered = prevArr.filter(e => e?.date !== today);
          const next = [...filtered, { date: today, value: total }].slice(-365);

          await sbAdmin.from("user_state").upsert({
            user_id:    u.user_id,
            key:        "networth_history",
            value:      next,
            updated_at: new Date().toISOString(),
          });
          processed += 1;
        } catch (e) {
          failed += 1;
          lastErr = e.message;
          warn("cron.nightly_snapshot.user_failed", { userId: u.user_id, err: e.message });
        }
      }

      info("cron.nightly_snapshot.ok", { processed, failed, total: (users || []).length });
    } catch (e) {
      lastErr = e.message;
      logError("cron.nightly_snapshot.failed", { err: e.message });
    } finally {
      sbAdmin.from("cron_jobs").upsert({
        job_name:    "nightly_snapshot",
        last_run_at: new Date().toISOString(),
        last_status: lastErr ? "error" : "ok",
        last_error:  lastErr,
        run_count:   1,
      }, { onConflict: "job_name" })
        .then(({ error }) => { if (error) warn("cron.upsert_failed", { err: error.message }); });
    }
    return { status: 200, body: { ok: !lastErr, processed, failed } };
  }

  // ── Weekly digest cron ──────────────────────────────────
  // For each profile with email_digest=true, computes 7-day net-worth
  // change from networth_history and emails a summary. Vercel schedule:
  // 13:00 UTC every Monday.
  if (pathname === "/api/cron/weekly-digest") {
    if (CRON_SECRET) {
      const authHeader = h.authorization || h.Authorization || "";
      if (authHeader !== `Bearer ${CRON_SECRET}`) {
        return { status: 401, body: { error: "Unauthorized" } };
      }
    }
    if (!sbAdmin) return { status: 200, body: { ok: true, skipped: "no-supabase" } };

    let sent = 0, skipped = 0, failed = 0;
    let lastErr = null;
    try {
      // Try to filter on email_digest. If the column doesn't exist yet
      // (migration not applied), fall back to ALL profiles and skip those
      // without the column set.
      let profiles = [];
      try {
        const { data, error: e1 } = await sbAdmin
          .from("profiles")
          .select("id, email, email_digest")
          .eq("email_digest", true);
        if (e1) throw e1;
        profiles = data || [];
      } catch (e) {
        warn("cron.weekly_digest.email_digest_filter_failed", { err: e.message });
        try {
          const { data } = await sbAdmin.from("profiles").select("id, email");
          profiles = data || [];
        } catch (e2) {
          throw new Error(`profiles select: ${e2.message}`);
        }
      }

      for (const p of profiles) {
        if (!p.email) { skipped += 1; continue; }
        try {
          const { data: hist } = await sbAdmin.from("user_state")
            .select("value")
            .eq("user_id", p.id)
            .eq("key", "networth_history")
            .maybeSingle();
          const arr = Array.isArray(hist?.value) ? hist.value : [];
          if (arr.length < 2) { skipped += 1; continue; }

          const latest = arr[arr.length - 1];
          // Find the entry from ~7 days ago (closest match).
          const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
          const baseline = arr.find(e => e.date >= sevenDaysAgo) || arr[0];
          const change = (latest?.value || 0) - (baseline?.value || 0);
          const pct = baseline?.value ? (change / baseline.value) * 100 : 0;
          const sign = change >= 0 ? "+" : "−";
          const fmt = n => `$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

          const text = [
            `Hi,`,
            ``,
            `Your MIZAN weekly digest:`,
            ``,
            `  Net worth: ${fmt(latest.value)} (${sign}${fmt(change)}, ${sign}${Math.abs(pct).toFixed(2)}%)`,
            `  Compared to ${baseline.date}.`,
            ``,
            `Sign in to see the full breakdown: https://omni-flow.net/`,
            ``,
            `— MIZAN`,
          ].join("\n");

          const r = await sendUserEmail(p.email, "Your MIZAN weekly digest", text, sbAdmin);
          if (r.ok) sent += 1; else failed += 1;
        } catch (e) {
          failed += 1;
          warn("cron.weekly_digest.user_failed", { userId: p.id, err: e.message });
        }
      }

      info("cron.weekly_digest.ok", { sent, skipped, failed, total: profiles.length });
    } catch (e) {
      lastErr = e.message;
      logError("cron.weekly_digest.failed", { err: e.message });
    } finally {
      sbAdmin.from("cron_jobs").upsert({
        job_name:    "weekly_digest",
        last_run_at: new Date().toISOString(),
        last_status: lastErr ? "error" : "ok",
        last_error:  lastErr,
        run_count:   1,
      }, { onConflict: "job_name" })
        .then(({ error }) => { if (error) warn("cron.upsert_failed", { err: error.message }); });
    }
    return { status: 200, body: { ok: !lastErr, sent, skipped, failed } };
  }

  // ── Dividend check cron ─────────────────────────────────
  // Pulls tomorrow's dividend calendar from Finnhub, inserts one
  // audit_log row per upcoming ex-date so the UI can surface "upcoming
  // dividends in your watchlist" without re-fetching. Cheap: one
  // Finnhub call per day. Schedule: 11:00 UTC daily.
  if (pathname === "/api/cron/dividend-check") {
    if (CRON_SECRET) {
      const authHeader = h.authorization || h.Authorization || "";
      if (authHeader !== `Bearer ${CRON_SECRET}`) {
        return { status: 401, body: { error: "Unauthorized" } };
      }
    }
    if (!sbAdmin) return { status: 200, body: { ok: true, skipped: "no-supabase" } };
    if (!FINNHUB_KEY) return { status: 503, body: { error: "Finnhub not configured" } };

    let inserted = 0;
    let lastErr = null;
    try {
      const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
      const url = `https://finnhub.io/api/v1/calendar/stock-dividend?from=${encodeURIComponent(tomorrow)}&to=${encodeURIComponent(tomorrow)}&token=${encodeURIComponent(FINNHUB_KEY)}`;
      const res = await fetchWithRetry(url, {}, { maxRetries: 2 });
      const json = await res.json().catch(() => ({}));
      const items = Array.isArray(json?.dividendCalendar) ? json.dividendCalendar : [];

      for (const d of items) {
        const ticker = d.symbol || d.ticker;
        if (!ticker) continue;
        try {
          await sbAdmin.from("audit_log").insert({
            user_id: null,
            action: "dividend_upcoming",
            target: ticker,
            metadata: {
              ticker,
              ex_date: d.date || d.exDate || tomorrow,
              amount: d.amount ?? null,
              currency: d.currency || "USD",
            },
          });
          inserted += 1;
        } catch (e) {
          warn("cron.dividend_check.audit_failed", { ticker, err: e.message });
        }
      }
      info("cron.dividend_check.ok", { inserted, total: items.length, date: tomorrow });
    } catch (e) {
      lastErr = e.message;
      logError("cron.dividend_check.failed", { err: e.message });
    } finally {
      sbAdmin.from("cron_jobs").upsert({
        job_name:    "dividend_check",
        last_run_at: new Date().toISOString(),
        last_status: lastErr ? "error" : "ok",
        last_error:  lastErr,
        run_count:   1,
      }, { onConflict: "job_name" })
        .then(({ error }) => { if (error) warn("cron.upsert_failed", { err: error.message }); });
    }
    return { status: 200, body: { ok: !lastErr, inserted } };
  }

  // ── Push notifications ──────────────────────────────────
  // VAPID public key is intentionally public — the browser uses it to
  // register a subscription with the push service. Returns null when
  // the server isn't configured so the client can hide the "enable
  // notifications" UI.
  if (pathname === "/api/notifications/vapid-public-key" && method === "GET") {
    return { status: 200, body: { key: process.env.VAPID_PUBLIC_KEY || null } };
  }

  if (pathname === "/api/notifications/subscribe" && method === "POST") {
    const user = await verifyUser(h);
    if (!user) return { status: 401, body: { error: "Unauthenticated" } };
    if (!sbAdmin) return { status: 503, body: { error: "Supabase not configured" } };

    const sub = parsed?.subscription;
    const endpoint = sub?.endpoint;
    const p256dh   = sub?.keys?.p256dh;
    const authKey  = sub?.keys?.auth;
    if (!endpoint || !p256dh || !authKey) {
      return { status: 400, body: { error: "subscription.endpoint + keys.{p256dh,auth} required" } };
    }

    const { error: upErr } = await sbAdmin.from("push_subscriptions").upsert({
      user_id: user.id,
      endpoint,
      p256dh,
      auth: authKey,
    }, { onConflict: "user_id,endpoint", ignoreDuplicates: true });
    if (upErr) {
      warn("notifications.subscribe_failed", { err: upErr.message });
      return { status: 500, body: { error: upErr.message } };
    }
    audit({ userId: user.id, action: "push.subscribed", headers: h });
    info("notifications.subscribed");
    return { status: 200, body: { ok: true } };
  }

  if (pathname === "/api/notifications/subscribe" && method === "DELETE") {
    const user = await verifyUser(h);
    if (!user) return { status: 401, body: { error: "Unauthenticated" } };
    if (!sbAdmin) return { status: 503, body: { error: "Supabase not configured" } };

    const endpoint = parsed?.endpoint;
    if (!endpoint) return { status: 400, body: { error: "endpoint required" } };

    const { error: delErr } = await sbAdmin.from("push_subscriptions")
      .delete()
      .eq("user_id", user.id)
      .eq("endpoint", endpoint);
    if (delErr) return { status: 500, body: { error: delErr.message } };
    audit({ userId: user.id, action: "push.unsubscribed", headers: h });
    return { status: 200, body: { ok: true } };
  }

  if (pathname === "/api/notifications/test" && method === "POST") {
    const gate = await requireAdmin();
    if (gate.early) return gate.early;
    if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY || !process.env.VAPID_SUBJECT) {
      return { status: 503, body: { error: "VAPID not configured" } };
    }
    const r = await sendPushToUser(sbAdmin, gate.user.id, {
      title: "MIZAN test",
      body:  "If you see this, push notifications are working.",
      url:   "/",
    });
    return { status: 200, body: r };
  }

  // ── Alpaca paper trading ────────────────────────────────
  // Thin proxy over Alpaca's paper-trading REST API. The Sharia
  // pre-check is intentionally simple — a hardcoded blocklist of
  // obvious non-compliant tickers — to short-circuit the most common
  // accidental mistakes. Real compliance lives elsewhere (AI advisor,
  // brokerage account screening).
  if (pathname === "/api/alpaca/order" && method === "POST") {
    const user = await verifyUser(h);
    if (!user) return { status: 401, body: { error: "Unauthenticated" } };
    if (!ALPACA_KEY_ID || !ALPACA_SECRET) {
      return { status: 503, body: { error: "Alpaca not configured" } };
    }

    const { symbol, qty, side, type, limitPrice } = parsed || {};
    if (!symbol || !qty || !side || !type) {
      return { status: 400, body: { error: "symbol, qty, side, type required" } };
    }
    const sideOk = side === "buy" || side === "sell";
    const typeOk = ["market", "limit", "stop", "stop_limit"].includes(type);
    if (!sideOk) return { status: 400, body: { error: "side must be 'buy' or 'sell'" } };
    if (!typeOk) return { status: 400, body: { error: "type must be market|limit|stop|stop_limit" } };

    const symbolUp = String(symbol).toUpperCase();
    if (HARAM_TICKERS.has(symbolUp)) {
      audit({ userId: user.id, action: "alpaca.order_blocked", target: symbolUp, metadata: { reason: "haram_precheck" }, headers: h });
      return { status: 403, body: { error: `${symbolUp} is on the Sharia precheck blocklist` } };
    }

    const orderBody = {
      symbol: symbolUp,
      qty: String(qty),
      side,
      type,
      time_in_force: "day",
    };
    if (type === "limit" || type === "stop_limit") {
      if (!limitPrice) return { status: 400, body: { error: "limitPrice required for limit orders" } };
      orderBody.limit_price = String(limitPrice);
    }

    let res;
    try {
      res = await fetchWithRetry(`${ALPACA_BASE}/orders`, {
        method: "POST",
        headers: {
          "APCA-API-KEY-ID":     ALPACA_KEY_ID,
          "APCA-API-SECRET-KEY": ALPACA_SECRET,
          "Content-Type":        "application/json",
        },
        body: JSON.stringify(orderBody),
      });
    } catch (e) {
      logError("alpaca.order_threw", { err: e.message });
      return { status: 502, body: { error: "Alpaca request failed" } };
    }
    const json = await res.json().catch(() => ({}));
    if (res.status >= 200 && res.status < 300) {
      audit({
        userId: user.id,
        action: "alpaca.order_placed",
        target: symbolUp,
        metadata: { qty, side, type, limitPrice: limitPrice ?? null, orderId: json?.id || null },
        headers: h,
      });
      info("alpaca.order.ok", { symbol: symbolUp, qty, side, type });
      return { status: 200, body: json };
    }
    warn("alpaca.order.failed", { status: res.status, symbol: symbolUp });
    return { status: res.status, body: json };
  }

  if (pathname === "/api/alpaca/orders" && method === "GET") {
    const user = await verifyUser(h);
    if (!user) return { status: 401, body: { error: "Unauthenticated" } };
    if (!ALPACA_KEY_ID || !ALPACA_SECRET) {
      return { status: 503, body: { error: "Alpaca not configured" } };
    }
    let res;
    try {
      res = await fetchWithRetry(`${ALPACA_BASE}/orders?status=all&limit=50`, {
        headers: {
          "APCA-API-KEY-ID":     ALPACA_KEY_ID,
          "APCA-API-SECRET-KEY": ALPACA_SECRET,
        },
      });
    } catch (e) {
      logError("alpaca.orders_threw", { err: e.message });
      return { status: 502, body: { error: "Alpaca request failed" } };
    }
    const json = await res.json().catch(() => []);
    return { status: res.status, body: json };
  }

  if (pathname === "/api/alpaca/positions" && method === "GET") {
    const user = await verifyUser(h);
    if (!user) return { status: 401, body: { error: "Unauthenticated" } };
    if (!ALPACA_KEY_ID || !ALPACA_SECRET) {
      return { status: 503, body: { error: "Alpaca not configured" } };
    }
    let res;
    try {
      res = await fetchWithRetry(`${ALPACA_BASE}/positions`, {
        headers: {
          "APCA-API-KEY-ID":     ALPACA_KEY_ID,
          "APCA-API-SECRET-KEY": ALPACA_SECRET,
        },
      });
    } catch (e) {
      logError("alpaca.positions_threw", { err: e.message });
      return { status: 502, body: { error: "Alpaca request failed" } };
    }
    const json = await res.json().catch(() => []);
    return { status: res.status, body: json };
  }

  return { status: 404, body: { error: "Not found" } };
}
