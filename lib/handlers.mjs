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

// ── Main entry point ─────────────────────────────────────
// Normalized request → { status, body }. The caller serializes.
export async function handleApiRequest({ method, pathname, query, body, headers }) {
  const parsed = body || {};
  const q = query || {};
  const h = headers || {};

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

    const { userId, userSecret } = await getSnapForRequest(h);
    const loginRes = await snapReq(
      "POST", "/snapTrade/login",
      { broker, connectionType },
      { userId, userSecret }
    );
    if (loginRes.status !== 200) {
      throw new Error(`login ${loginRes.status}: ${JSON.stringify(loginRes.body)}`);
    }
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

    const payload = { model, max_tokens, messages };
    if (system) payload.system = system;
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

  if (pathname === "/api/snaptrade/trade/place" && method === "POST") {
    let snap; try { snap = await getSnapForRequest(h); } catch { return { status: 404, body: { error: "No registered user" } }; }
    const { userId, userSecret } = snap;

    const tradeId = parsed.tradeId;
    if (!tradeId) return { status: 400, body: { error: "tradeId required" } };

    const r = await snapReq("POST", `/trade/${tradeId}`, null, { userId, userSecret });
    if (r.status >= 200 && r.status < 300) {
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
