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
    console.log(`plaid: ${PLAID_ENV} environment ready`);
  } catch (err) {
    console.error(`plaid: client init failed — ${err.message}`);
  }
} else {
  console.log("plaid: not configured — banking aggregation disabled");
}

// ── Supabase admin client (server-only, bypasses RLS) ────
let sbAdmin = null;
if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  try {
    const { createClient } = await import("@supabase/supabase-js");
    sbAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    console.log("supabase: admin client ready (per-user SnapTrade enabled)");
  } catch (err) {
    console.error(`supabase: admin client failed — ${err.message}`);
  }
} else {
  console.log("supabase: not configured — falling back to mizan_primary single-user mode");
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
const saveUsers = u  => { try { fs.writeFileSync(STORE, JSON.stringify(u, null, 2)); } catch (err) { console.error(`saveUsers failed: ${err.message}`); } };

async function getOrCreateUser(userId) {
  const users = loadUsers();
  if (users[userId]) return { userId, userSecret: users[userId] };
  console.log(`  → Registering new SnapTrade user (legacy): ${userId}`);
  const res = await snapReq("POST", "/snapTrade/registerUser", { userId });
  if (res.status === 200 || res.status === 201) {
    const { userSecret } = res.body;
    users[userId] = userSecret;
    saveUsers(users);
    console.log("  ✓ Registered and stored");
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
        if (claimErr) console.error(`owner-claim upsert failed: ${claimErr.message}`);
        else console.log(`  ✓ Owner claim: ${user.email} → mizan_primary (existing connections preserved)`);
        return { userId: "mizan_primary", userSecret: legacy, supabaseUser: user };
      }
    }
    // Register a fresh SnapTrade user for this Supabase user
    console.log(`  → Registering new SnapTrade user (per-user): ${user.email}`);
    const res = await snapReq("POST", "/snapTrade/registerUser", { userId: stUserId });
    if (res.status >= 200 && res.status < 300) {
      const { userSecret } = res.body;
      const { error: insErr } = await sbAdmin.from("user_snaptrade").upsert({
        user_id: user.id,
        snaptrade_user_id: stUserId,
        snaptrade_user_secret: userSecret,
      });
      if (insErr) console.error(`user_snaptrade upsert failed: ${insErr.message}`);
      console.log(`  ✓ Per-user SnapTrade registered: ${stUserId}`);
      return { userId: stUserId, userSecret, supabaseUser: user };
    }
    throw new Error(`registerUser ${res.status}: ${JSON.stringify(res.body)}`);
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

// ── Rate limiter ─────────────────────────────────────────
// Per-instance in-memory token bucket. Survives within a single warm Vercel
// function instance; serverless cold starts reset the counters (acceptable —
// the goal is to slow runaway clients, not to enforce a quota). For stricter
// quotas, swap the Map for a Supabase table or Upstash Redis.
//
// Limits:
//   anonymous IP:           30 req / 60 s
//   authenticated user_id: 120 req / 60 s
//   /api/advisor (any):     30 req / 3600 s   (Anthropic spend protection)
//   /api/cron/sync:         unlimited (CRON_SECRET-gated)
const RL_WINDOWS = { default: 60_000, advisor: 3_600_000 };
const RL_LIMITS  = { anon: 30, user: 120, advisor: 30 };
const _rlBuckets = new Map(); // key → { count, resetAt }

function rateLimitCheck(key, limit, windowMs) {
  const now = Date.now();
  const bucket = _rlBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    _rlBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, resetAt: now + windowMs };
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    return { ok: false, remaining: 0, resetAt: bucket.resetAt, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { ok: true, remaining: limit - bucket.count, resetAt: bucket.resetAt };
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
  // intentionally not awaited
  sbAdmin
    .from("audit_log")
    .insert({ user_id: userId, action, target, metadata, ip, user_agent: ua })
    .then(({ error }) => { if (error) console.error(`audit ${action}: ${error.message}`); });
}

async function applyRateLimit(pathname, headers) {
  // Cron is gated by CRON_SECRET separately; skip rate limiting so the
  // scheduled job isn't starved by other traffic in the same minute.
  if (pathname === "/api/cron/sync") return null;

  // Try to identify the caller. Authenticated users get a per-user bucket
  // (higher limit). Anonymous callers share an IP-keyed bucket (lower limit).
  let identity = `ip:${clientIp(headers)}`;
  let limit = RL_LIMITS.anon;
  try {
    const user = await verifyUser(headers);
    if (user?.id) {
      identity = `user:${user.id}`;
      limit = RL_LIMITS.user;
    }
  } catch { /* verifyUser only throws on supabase errors — fall through */ }

  // Advisor-specific cap on top of the general bucket.
  if (pathname === "/api/advisor") {
    const advisorKey = `advisor:${identity}`;
    const advisorCheck = rateLimitCheck(advisorKey, RL_LIMITS.advisor, RL_WINDOWS.advisor);
    if (!advisorCheck.ok) return advisorCheck;
  }

  return rateLimitCheck(`${identity}:${pathname}`, limit, RL_WINDOWS.default);
}

// ── Main entry point ─────────────────────────────────────
// Normalized request → { status, body }. The caller serializes.
export async function handleApiRequest({ method, pathname, query, body, headers }) {
  const parsed = body || {};
  const q = query || {};
  const h = headers || {};

  // Rate limit early — before we hit Supabase or any upstream API. The cron
  // path and pure status checks are excluded.
  if (pathname !== "/api/snaptrade/status") {
    const rl = await applyRateLimit(pathname, h);
    if (rl && !rl.ok) {
      return {
        status: 429,
        body: { error: "Too many requests", retryAfter: rl.retryAfter },
        headers: { "Retry-After": String(rl.retryAfter) },
      };
    }
  }

  if (pathname === "/api/snaptrade/status") {
    return { status: 200, body: { ok: true, clientId: CLIENT_ID.slice(0, 8) + "..." } };
  }

  if (pathname === "/api/snaptrade/brokerages") {
    // Public endpoint — returns SnapTrade's full supported-brokerage list.
    // No userSecret required; clientId + signature only.
    const r = await snapReq("GET", "/brokerages", null, {});
    const arr = Array.isArray(r.body) ? r.body : [];
    console.log(`  ✓ /brokerages: ${arr.length} brokerages`);
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
      throw new Error(`login ${loginRes.status}: ${JSON.stringify(loginRes.body)}`);
    }
    audit({ userId: supabaseUser?.id, action: "broker.connect_initiated", target: broker, metadata: { connectionType }, headers: h });
    console.log(`  ✓ Login link ready for ${broker}`);
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
    console.log(`  ✓ /all: ${result.length} accounts, ${result.reduce((s,a)=>s+a.positions.length,0)} positions`);
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
      console.log(`  ✓ disconnected authorization ${authId}`);
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
    console.log(`  ✓ /activities: ${arr.length} rows (${startDate} → ${endDate})`);
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
      console.log("  ✓ /finnhub/earnings: count=0 (no key)");
      return { status: 200, body: { earningsCalendar: [] } };
    }
    const today = new Date();
    const plus30 = new Date(today); plus30.setDate(today.getDate() + 30);
    const from = q.from || today.toISOString().slice(0, 10);
    const to   = q.to   || plus30.toISOString().slice(0, 10);
    const finUrl = `https://finnhub.io/api/v1/calendar/earnings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&token=${encodeURIComponent(FINNHUB_KEY)}`;
    const r = await httpsGetJson(finUrl);
    const arr = Array.isArray(r.body?.earningsCalendar) ? r.body.earningsCalendar : [];
    console.log(`  ✓ /finnhub/earnings: count=${arr.length} (${from} → ${to})`);
    return { status: 200, body: r.body && typeof r.body === "object" ? r.body : { earningsCalendar: [] } };
  }

  if (pathname === "/api/finnhub/dividends") {
    const symbol = q.symbol;
    if (!symbol) return { status: 400, body: { error: "symbol is required" } };
    if (!FINNHUB_KEY) {
      console.log(`  ✓ /finnhub/dividends: count=0 (no key) symbol=${symbol}`);
      return { status: 200, body: { dividends: [] } };
    }
    const today = new Date();
    const oneYearAgo = new Date(today); oneYearAgo.setFullYear(today.getFullYear() - 1);
    const from = q.from || oneYearAgo.toISOString().slice(0, 10);
    const to   = q.to   || today.toISOString().slice(0, 10);
    const finUrl = `https://finnhub.io/api/v1/stock/dividend?symbol=${encodeURIComponent(symbol)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&token=${encodeURIComponent(FINNHUB_KEY)}`;
    const r = await httpsGetJson(finUrl);
    const arr = Array.isArray(r.body) ? r.body : [];
    console.log(`  ✓ /finnhub/dividends: count=${arr.length} symbol=${symbol} (${from} → ${to})`);
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
      console.log("  ✓ /snaptrade/documents: count=0 (no user)");
      return { status: 200, body: { documents: [] } };
    }
    const { userId, userSecret } = snap;
    const r = await snapReq("GET", "/documents", null, { userId, userSecret });
    const count = Array.isArray(r.body) ? r.body.length : (r.body?.documents?.length ?? 0);
    console.log(`  ✓ /snaptrade/documents: count=${count}`);
    return { status: 200, body: { documents: r.body } };
  }

  if (pathname === "/api/advisor" && method === "POST") {
    if (!ANTHROPIC_KEY) {
      console.log("  ✓ /api/advisor: ANTHROPIC_KEY not configured");
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

    const summary = (typeof anthropicRes.body === "object" && anthropicRes.body?.usage)
      ? `in=${anthropicRes.body.usage.input_tokens || 0} out=${anthropicRes.body.usage.output_tokens || 0}`
      : `status=${anthropicRes.status}`;
    console.log(`  ✓ /api/advisor: ${summary}`);
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
      console.log(`  ✓ /trade/impact: ${action} ${units} ${symbol} → tradeId=${tradeId}`);
      return { status: 200, body: { impact: r.body } };
    }
    console.log(`  ✗ /trade/impact: ${r.status}`);
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
    console.log(`  ✓ /snaptrade/refresh: queued ${queued}/${auths.length} (throttled ${throttled})`);
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
      console.log(`  ✓ /trade/place: tradeId=${tradeId} placed`);
      return { status: 200, body: { placed: r.body } };
    }
    console.log(`  ✗ /trade/place: ${r.status}`);
    return { status: r.status || 500, body: { error: `place ${r.status}: ${JSON.stringify(r.body)}` } };
  }

  if (pathname === "/api/polygon/bars") {
    const symbol = q.symbol;
    if (!symbol) return { status: 400, body: { error: "symbol is required" } };
    if (!POLYGON_KEY) {
      console.log(`  ✓ /api/polygon/bars: count=0 (no key) symbol=${symbol}`);
      return { status: 200, body: { bars: [] } };
    }
    const today = new Date();
    const fiveYearsAgo = new Date(today); fiveYearsAgo.setFullYear(today.getFullYear() - 5);
    const from     = q.from     || fiveYearsAgo.toISOString().slice(0, 10);
    const to       = q.to       || today.toISOString().slice(0, 10);
    const timespan = q.timespan || "day";
    const polyUrl =
      `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(symbol.toUpperCase())}` +
      `/range/1/${encodeURIComponent(timespan)}/${encodeURIComponent(from)}/${encodeURIComponent(to)}` +
      `?apiKey=${encodeURIComponent(POLYGON_KEY)}&adjusted=true&sort=asc&limit=5000`;
    const r = await httpsGetJson(polyUrl);
    const arr = Array.isArray(r.body?.results) ? r.body.results : [];
    console.log(`  ✓ /api/polygon/bars: count=${arr.length} symbol=${symbol} (${from} → ${to}, ${timespan})`);
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
    audit({ userId: user.id, action, target, metadata, headers: h });
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
        console.error("plaid/link-token failed:", detail);
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
          console.error("plaid/exchange: account seed failed:", acctErr.message);
        }

        audit({ userId: user.id, action: "bank.connect", target: institution_name, metadata: { item_id, institution_id }, headers: h });
        console.log(`  ✓ plaid/exchange: ${institution_name} (${item_id})`);
        return { status: 200, body: { ok: true, item_id, institution_name } };
      } catch (err) {
        const detail = err.response?.data || err.message;
        console.error("plaid/exchange failed:", detail);
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
        console.error("plaid/accounts failed:", detail);
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
        console.error("plaid/transactions failed:", detail);
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
        catch (rmErr) { console.warn("plaid/item: Plaid itemRemove warning:", rmErr.message); }
        await sbAdmin.from("plaid_accounts").delete().eq("user_id", user.id).eq("item_id", itemId);
        await sbAdmin.from("plaid_tokens"  ).delete().eq("user_id", user.id).eq("item_id", itemId);
        audit({ userId: user.id, action: "bank.disconnect", target: row.institution_name, metadata: { item_id: itemId }, headers: h });
        return { status: 200, body: { ok: true, item_id: itemId } };
      } catch (err) {
        const detail = err.response?.data || err.message;
        console.error("plaid/item DELETE failed:", detail);
        return { status: 500, body: { error: typeof detail === "string" ? detail : JSON.stringify(detail) } };
      }
    }

    return { status: 404, body: { error: "Unknown plaid endpoint" } };
  }

  // ── DB schema status (admin-only) ───────────────────────
  // Returns which migration tables exist in the public schema, so you
  // can verify Supabase is current without logging into the dashboard.
  // Gated to OWNER_EMAIL (the same root check used elsewhere) — any other
  // authenticated user gets 403; unauthenticated gets 401.
  if (pathname === "/api/admin/db-status") {
    if (!sbAdmin) {
      return { status: 503, body: { error: "Supabase not configured" } };
    }
    const user = await verifyUser(h);
    if (!user) return { status: 401, body: { error: "Unauthenticated" } };
    const userEmail = (user.email || "").toLowerCase();
    const isOwner   = OWNER_EMAIL && userEmail === OWNER_EMAIL;
    const isRootMeta = user.app_metadata?.role === "root";
    if (!isOwner && !isRootMeta) {
      return { status: 403, body: { error: "Admin only" } };
    }

    // Map of migration file → tables it should have created.
    const MIGRATIONS = [
      { file: "001_audit_log.sql",  tables: ["audit_log"] },
      { file: "002_user_state.sql", tables: ["user_snaptrade", "user_state", "user_keys"] },
      { file: "003_plaid.sql",      tables: ["plaid_tokens", "plaid_accounts"] },
    ];
    const expectedTables = MIGRATIONS.flatMap((m) => m.tables);

    // Use a Postgres view exposed by Supabase: information_schema.tables.
    // Service-role bypasses RLS so this works even with no auth.users row.
    const { data: rows, error: schemaErr } = await sbAdmin
      .from("information_schema.tables")
      .select("table_name")
      .eq("table_schema", "public")
      .in("table_name", expectedTables);

    // Fallback: pg_catalog query via rpc if information_schema isn't
    // exposed. Returns an empty set on error rather than 500ing.
    let present = new Set();
    if (!schemaErr && Array.isArray(rows)) {
      present = new Set(rows.map((r) => r.table_name));
    } else {
      // Last-ditch: probe each table with a HEAD count. Slower but works
      // against any Supabase project. count={ head:true } returns 0 bytes.
      for (const t of expectedTables) {
        try {
          const probe = await sbAdmin.from(t).select("*", { count: "exact", head: true });
          if (!probe.error) present.add(t);
        } catch { /* table missing → leave unset */ }
      }
    }

    const status = MIGRATIONS.map((m) => ({
      migration: m.file,
      tables:    m.tables.map((t) => ({ name: t, present: present.has(t) })),
      complete:  m.tables.every((t) => present.has(t)),
    }));
    const allComplete = status.every((s) => s.complete);
    return {
      status: 200,
      body: {
        ok: allComplete,
        migrations: status,
        missing: expectedTables.filter((t) => !present.has(t)),
      },
    };
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

    let synced = 0, failed = 0;
    const BATCH = 5;
    for (let i = 0; i < (users || []).length; i += BATCH) {
      const batch = users.slice(i, i + BATCH);
      const settled = await Promise.allSettled(batch.map(async u => {
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

    console.log(`  ✓ /cron/sync: ${synced}/${(users || []).length} users synced, ${failed} failed`);
    return { status: 200, body: { ok: true, synced, failed, total: (users || []).length } };
  }

  return { status: 404, body: { error: "Not found" } };
}
