/**
 * MĪZAN — Unified dev server (ESM)
 *
 * Runs Vite (frontend) + the SnapTrade backend on a single port (3000)
 * from a single terminal: `npm run dev`.
 *
 * In production (NODE_ENV=production), serves the built `dist/` folder.
 *
 * Crash diagnostics: signals, uncaught errors, and exit reasons are
 * appended to .dev.log so we can see what killed the process.
 */

import http   from "node:http";
import https  from "node:https";
import crypto from "node:crypto";
import fs     from "node:fs";
import path   from "node:path";
import zlib   from "node:zlib";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Crash / signal diagnostics ───────────────────────────
const LOG_FILE = path.join(__dirname, ".dev.log");
const ts = () => new Date().toISOString();
const logLine = msg => {
  const line = `[${ts()}] pid=${process.pid} ${msg}\n`;
  process.stderr.write(line);
  try { fs.appendFileSync(LOG_FILE, line); } catch {}
};

logLine(`startup node=${process.version} rss=${(process.memoryUsage().rss / 1e6).toFixed(0)}MB`);

["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"].forEach(sig => {
  process.on(sig, () => {
    logLine(`received ${sig} — shutting down`);
    process.exit(0);
  });
});

process.on("uncaughtException",  err => logLine(`uncaughtException: ${err.stack || err}`));
process.on("unhandledRejection", err => logLine(`unhandledRejection: ${err && err.stack || err}`));
process.on("exit", code => logLine(`exit code=${code}`));

// SIGKILL cannot be caught — but a periodic memory log lets us see if
// macOS OOM-killed us due to a memory blow-up.
setInterval(() => {
  const m = process.memoryUsage();
  logLine(`mem rss=${(m.rss / 1e6).toFixed(0)}MB heap=${(m.heapUsed / 1e6).toFixed(0)}MB`);
}, 60_000).unref();

// ── Load .env.local ──────────────────────────────────────
function loadEnv(filePath) {
  try {
    fs.readFileSync(filePath, "utf8").split("\n").forEach(line => {
      const clean = line.trim();
      if (!clean || clean.startsWith("#")) return;
      const eq = clean.indexOf("=");
      if (eq === -1) return;
      const key = clean.slice(0, eq).trim();
      const val = clean.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (key && val && !process.env[key]) process.env[key] = val;
    });
  } catch {}
}
loadEnv(path.join(__dirname, ".env.local"));
loadEnv(path.join(__dirname, ".env"));

// ── PWA icon generation (idempotent, runs at boot) ───────
// Materializes public/icon-192.png and public/icon-512.png if missing.
// Solid dark-navy (#06080D) background with a centered blue (#2563EB) diamond.
// Pure Node built-ins (zlib + Buffer) — no image deps.
function ensurePwaIcons() {
  const publicDir = path.join(__dirname, "public");
  const targets = [
    { size: 192, file: path.join(publicDir, "icon-192.png") },
    { size: 512, file: path.join(publicDir, "icon-512.png") },
  ];
  if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
  if (targets.every(t => fs.existsSync(t.file))) return;

  const BG = [0x06, 0x08, 0x0d];
  const FG = [0x25, 0x63, 0xeb];

  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();
  const crc32 = buf => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, "ascii");
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  };

  for (const { size, file } of targets) {
    if (fs.existsSync(file)) continue;
    const cx = (size - 1) / 2, cy = (size - 1) / 2, half = size * 0.36;
    const stride = size * 4;
    const filtered = Buffer.alloc(size * (stride + 1));
    for (let y = 0; y < size; y++) {
      const rowStart = y * (stride + 1);
      filtered[rowStart] = 0;
      for (let x = 0; x < size; x++) {
        const inDiamond = Math.abs(x - cx) + Math.abs(y - cy) <= half;
        const c = inDiamond ? FG : BG;
        const o = rowStart + 1 + x * 4;
        filtered[o] = c[0]; filtered[o + 1] = c[1]; filtered[o + 2] = c[2]; filtered[o + 3] = 0xff;
      }
    }
    const idat = zlib.deflateSync(filtered, { level: 9 });
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
    ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const png = Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
    fs.writeFileSync(file, png);
    logLine(`pwa: wrote ${path.basename(file)} (${png.length} bytes)`);
  }
}
try { ensurePwaIcons(); } catch (err) { logLine(`pwa icon gen failed: ${err.message}`); }

const CLIENT_ID = (
  process.env.VITE_SNAPTRADE_CLIENT_ID ||
  process.env.SNAPTRADE_CLIENT_ID || ""
).trim();

const CONSUMER_KEY = (
  process.env.VITE_SNAPTRADE_CONSUMER_KEY ||
  process.env.SNAPTRADE_CONSUMER_KEY || ""
).trim();

const FINNHUB_KEY = (process.env.VITE_FINNHUB_KEY || "").trim();

const ANTHROPIC_KEY = (process.env.ANTHROPIC_KEY || process.env.VITE_ANTHROPIC_KEY || "").trim();
const POLYGON_KEY   = (process.env.POLYGON_KEY   || process.env.VITE_POLYGON_KEY   || "").trim();
// Owner email — when this user signs in, they inherit the legacy mizan_primary
// SnapTrade record (your existing connected brokerages). Everyone else gets a
// fresh empty user. Leave blank in production deployments where no owner-claim
// migration is needed.
const OWNER_EMAIL = (process.env.OWNER_EMAIL || "").trim().toLowerCase();

if (!CLIENT_ID || !CONSUMER_KEY) {
  console.error("\n  ❌  Missing SnapTrade keys in .env.local\n");
  console.error("  Add these two lines with your actual values:");
  console.error("  VITE_SNAPTRADE_CLIENT_ID=your-client-id-here");
  console.error("  VITE_SNAPTRADE_CONSUMER_KEY=your-consumer-key-here\n");
  process.exit(1);
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

// ── Supabase admin client (server-only, bypasses RLS) ────
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
let sbAdmin = null;
if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  try {
    const { createClient } = await import("@supabase/supabase-js");
    sbAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    logLine("supabase: admin client ready (per-user SnapTrade enabled)");
  } catch (err) {
    logLine(`supabase: admin client failed — ${err.message}`);
  }
} else {
  logLine("supabase: not configured — falling back to mizan_primary single-user mode");
}

// Verify Supabase JWT in Authorization header.
// Returns auth.users row on success, null otherwise.
async function verifyUser(req) {
  if (!sbAdmin) return null;
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  try {
    const { data, error } = await sbAdmin.auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user;
  } catch { return null; }
}

// ── User store: per-Supabase-user SnapTrade isolation ────
// File-backed legacy store (mizan_primary) preserved for single-user mode and
// existing connections. New users get rows in Postgres user_snaptrade table.
const STORE = path.join(__dirname, ".snaptrade-users.json");
const loadUsers = () => { try { return JSON.parse(fs.readFileSync(STORE, "utf8")); } catch { return {}; } };
const saveUsers = u  => fs.writeFileSync(STORE, JSON.stringify(u, null, 2));

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

// Resolve {userId, userSecret} for the current request.
// - Authenticated (Supabase JWT in header): per-user record from Postgres
//   user_snaptrade table. Auto-registers with SnapTrade on first call.
// - Otherwise: falls back to mizan_primary in the JSON file (single-user mode
//   and backward-compat for accounts already connected before multi-user shipped).
async function getSnapForRequest(req) {
  const user = await verifyUser(req);
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
        if (claimErr) logLine(`owner-claim upsert failed: ${claimErr.message}`);
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
      if (insErr) logLine(`user_snaptrade upsert failed: ${insErr.message}`);
      console.log(`  ✓ Per-user SnapTrade registered: ${stUserId}`);
      return { userId: stUserId, userSecret, supabaseUser: user };
    }
    throw new Error(`registerUser ${res.status}: ${JSON.stringify(res.body)}`);
  }
  // Single-user fallback
  return getOrCreateUser("mizan_primary");
}

// ── API handler ──────────────────────────────────────────
async function handleApi(req, res, url) {
  let body = "";
  for await (const chunk of req) body += chunk;
  let parsed = {};
  try { parsed = body ? JSON.parse(body) : {}; } catch {}

  const send = (data, status = 200) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  };

  if (url.pathname === "/api/snaptrade/status") {
    return send({ ok: true, clientId: CLIENT_ID.slice(0, 8) + "..." });
  }

  if (url.pathname === "/api/snaptrade/brokerages") {
    // Public endpoint — returns SnapTrade's full supported-brokerage list.
    // No userSecret required; clientId + signature only.
    const r = await snapReq("GET", "/brokerages", null, {});
    const arr = Array.isArray(r.body) ? r.body : [];
    console.log(`  ✓ /brokerages: ${arr.length} brokerages`);
    return send({ brokerages: arr });
  }

  if (url.pathname === "/api/snaptrade/login" && req.method === "POST") {
    const { broker, connectionType = "read" } = parsed;
    if (!broker) return send({ error: "broker is required" }, 400);

    const { userId, userSecret } = await getSnapForRequest(req);
    const loginRes = await snapReq(
      "POST", "/snapTrade/login",
      { broker, connectionType },
      { userId, userSecret }
    );
    if (loginRes.status !== 200) {
      throw new Error(`login ${loginRes.status}: ${JSON.stringify(loginRes.body)}`);
    }
    console.log(`  ✓ Login link ready for ${broker}`);
    return send({ loginLink: loginRes.body.redirectURI });
  }

  if (url.pathname === "/api/snaptrade/accounts") {
    let snap; try { snap = await getSnapForRequest(req); } catch { return send({ accounts: [] }); }
    const { userId, userSecret } = snap;
    const r = await snapReq("GET", "/accounts", null, { userId, userSecret });
    return send({ accounts: Array.isArray(r.body) ? r.body : [] });
  }

  if (url.pathname === "/api/snaptrade/all") {
    let snap; try { snap = await getSnapForRequest(req); } catch { return send({ accounts: [] }); }
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
    return send({ accounts: result });
  }

  if (url.pathname === "/api/snaptrade/disconnect" && req.method === "POST") {
    let snap; try { snap = await getSnapForRequest(req); } catch { return send({ error: "No registered user" }, 404); }
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
    if (!authId) return send({ error: "brokerage_authorization not resolvable" }, 400);

    const r = await snapReq("DELETE", `/authorizations/${authId}`, null,
      { userId, userSecret });
    if (r.status >= 200 && r.status < 300) {
      console.log(`  ✓ disconnected authorization ${authId}`);
      return send({ ok: true, authorizationId: authId });
    }
    return send({ error: `disconnect ${r.status}: ${JSON.stringify(r.body)}` }, r.status || 500);
  }

  if (url.pathname === "/api/snaptrade/activities") {
    let snap; try { snap = await getSnapForRequest(req); } catch { return send({ activities: [] }); }
    const { userId, userSecret } = snap;

    const today = new Date();
    const fiveYearsAgo = new Date(today); fiveYearsAgo.setFullYear(today.getFullYear() - 5);
    const startDate = url.searchParams.get("startDate") || fiveYearsAgo.toISOString().slice(0, 10);
    const endDate   = url.searchParams.get("endDate")   || today.toISOString().slice(0, 10);
    const accounts  = url.searchParams.get("accounts");
    const type      = url.searchParams.get("type");

    const extra = { userId, userSecret, startDate, endDate };
    if (accounts) extra.accounts = accounts;
    if (type)     extra.type     = type;

    const r = await snapReq("GET", "/activities", null, extra);
    const arr = Array.isArray(r.body) ? r.body : (r.body?.activities || []);
    console.log(`  ✓ /activities: ${arr.length} rows (${startDate} → ${endDate})`);
    return send({ activities: arr, startDate, endDate });
  }

  if (url.pathname === "/api/snaptrade/holdings") {
    const accountId = url.searchParams.get("accountId");
    if (!accountId) return send({ error: "accountId required" }, 400);
    let snap; try { snap = await getSnapForRequest(req); } catch { return send({ error: "No registered user" }, 404); }
    const { userId, userSecret } = snap;
    const r = await snapReq(
      "GET", `/accounts/${accountId}/positions`, null,
      { userId, userSecret }
    );
    return send({ holdings: r.body });
  }

  if (url.pathname === "/api/finnhub/earnings") {
    if (!FINNHUB_KEY) {
      console.log("  ✓ /finnhub/earnings: count=0 (no key)");
      return send({ earningsCalendar: [] });
    }
    const today = new Date();
    const plus30 = new Date(today); plus30.setDate(today.getDate() + 30);
    const from = url.searchParams.get("from") || today.toISOString().slice(0, 10);
    const to   = url.searchParams.get("to")   || plus30.toISOString().slice(0, 10);
    const finUrl = `https://finnhub.io/api/v1/calendar/earnings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&token=${encodeURIComponent(FINNHUB_KEY)}`;
    const r = await httpsGetJson(finUrl);
    const arr = Array.isArray(r.body?.earningsCalendar) ? r.body.earningsCalendar : [];
    console.log(`  ✓ /finnhub/earnings: count=${arr.length} (${from} → ${to})`);
    return send(r.body && typeof r.body === "object" ? r.body : { earningsCalendar: [] });
  }

  if (url.pathname === "/api/finnhub/dividends") {
    const symbol = url.searchParams.get("symbol");
    if (!symbol) return send({ error: "symbol is required" }, 400);
    if (!FINNHUB_KEY) {
      console.log(`  ✓ /finnhub/dividends: count=0 (no key) symbol=${symbol}`);
      return send({ dividends: [] });
    }
    const today = new Date();
    const oneYearAgo = new Date(today); oneYearAgo.setFullYear(today.getFullYear() - 1);
    const from = url.searchParams.get("from") || oneYearAgo.toISOString().slice(0, 10);
    const to   = url.searchParams.get("to")   || today.toISOString().slice(0, 10);
    const finUrl = `https://finnhub.io/api/v1/stock/dividend?symbol=${encodeURIComponent(symbol)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&token=${encodeURIComponent(FINNHUB_KEY)}`;
    const r = await httpsGetJson(finUrl);
    const arr = Array.isArray(r.body) ? r.body : [];
    console.log(`  ✓ /finnhub/dividends: count=${arr.length} symbol=${symbol} (${from} → ${to})`);
    return send({ dividends: arr });
  }

  if (url.pathname === "/api/finnhub/profile2") {
    const symbol = url.searchParams.get("symbol");
    if (!symbol) return send({ error: "symbol is required" }, 400);
    if (!FINNHUB_KEY) return send({});
    const finUrl = `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(FINNHUB_KEY)}`;
    const r = await httpsGetJson(finUrl);
    return send(r.body && typeof r.body === "object" ? r.body : {});
  }

  if (url.pathname === "/api/finnhub/metric") {
    const symbol = url.searchParams.get("symbol");
    if (!symbol) return send({ error: "symbol is required" }, 400);
    if (!FINNHUB_KEY) return send({ metric: {} });
    const finUrl = `https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all&token=${encodeURIComponent(FINNHUB_KEY)}`;
    const r = await httpsGetJson(finUrl);
    return send(r.body && typeof r.body === "object" ? r.body : { metric: {} });
  }

  if (url.pathname === "/api/snaptrade/documents") {
    let snap; try { snap = await getSnapForRequest(req); } catch {
      console.log("  ✓ /snaptrade/documents: count=0 (no user)");
      return send({ documents: [] });
    }
    const { userId, userSecret } = snap;
    const r = await snapReq("GET", "/documents", null, { userId, userSecret });
    const count = Array.isArray(r.body) ? r.body.length : (r.body?.documents?.length ?? 0);
    console.log(`  ✓ /snaptrade/documents: count=${count}`);
    return send({ documents: r.body });
  }

  if (url.pathname === "/api/advisor" && req.method === "POST") {
    if (!ANTHROPIC_KEY) {
      console.log("  ✓ /api/advisor: ANTHROPIC_KEY not configured");
      return send({ error: "ANTHROPIC_KEY not configured server-side" }, 503);
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
    return send(anthropicRes.body, anthropicRes.status || 200);
  }

  if (url.pathname === "/api/snaptrade/trade/impact" && req.method === "POST") {
    let snap; try { snap = await getSnapForRequest(req); } catch { return send({ error: "No registered user" }, 404); }
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
      return send({ error: "accountId, action, units, symbol, orderType required" }, 400);
    }

    const body = {
      account_id:          accountId,
      action,
      universal_symbol_id: symbol,
      order_type:          orderType,
      time_in_force:       timeInForce || "Day",
      units,
      price:               price ?? null,
      stop:                stopPrice ?? null,
    };
    const r = await snapReq("POST", "/trade/impact", body, { userId, userSecret });
    if (r.status >= 200 && r.status < 300) {
      const tradeId = r.body?.trade?.id || r.body?.id || "(no id)";
      console.log(`  ✓ /trade/impact: ${action} ${units} ${symbol} → tradeId=${tradeId}`);
      return send({ impact: r.body });
    }
    console.log(`  ✗ /trade/impact: ${r.status}`);
    return send({ error: `impact ${r.status}: ${JSON.stringify(r.body)}` }, r.status || 500);
  }

  if (url.pathname === "/api/snaptrade/trade/place" && req.method === "POST") {
    let snap; try { snap = await getSnapForRequest(req); } catch { return send({ error: "No registered user" }, 404); }
    const { userId, userSecret } = snap;

    const tradeId = parsed.tradeId;
    if (!tradeId) return send({ error: "tradeId required" }, 400);

    const r = await snapReq("POST", `/trade/${tradeId}`, null, { userId, userSecret });
    if (r.status >= 200 && r.status < 300) {
      console.log(`  ✓ /trade/place: tradeId=${tradeId} placed`);
      return send({ placed: r.body });
    }
    console.log(`  ✗ /trade/place: ${r.status}`);
    return send({ error: `place ${r.status}: ${JSON.stringify(r.body)}` }, r.status || 500);
  }

  if (url.pathname === "/api/polygon/bars") {
    const symbol = url.searchParams.get("symbol");
    if (!symbol) return send({ error: "symbol is required" }, 400);
    if (!POLYGON_KEY) {
      console.log(`  ✓ /api/polygon/bars: count=0 (no key) symbol=${symbol}`);
      return send({ bars: [] });
    }
    const today = new Date();
    const fiveYearsAgo = new Date(today); fiveYearsAgo.setFullYear(today.getFullYear() - 5);
    const from     = url.searchParams.get("from")     || fiveYearsAgo.toISOString().slice(0, 10);
    const to       = url.searchParams.get("to")       || today.toISOString().slice(0, 10);
    const timespan = url.searchParams.get("timespan") || "day";
    const polyUrl =
      `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(symbol.toUpperCase())}` +
      `/range/1/${encodeURIComponent(timespan)}/${encodeURIComponent(from)}/${encodeURIComponent(to)}` +
      `?apiKey=${encodeURIComponent(POLYGON_KEY)}&adjusted=true&sort=asc&limit=5000`;
    const r = await httpsGetJson(polyUrl);
    const arr = Array.isArray(r.body?.results) ? r.body.results : [];
    console.log(`  ✓ /api/polygon/bars: count=${arr.length} symbol=${symbol} (${from} → ${to}, ${timespan})`);
    return send({ bars: arr });
  }

  send({ error: "Not found" }, 404);
}

// ── Boot: Vite middleware + API on one port ──────────────
const PORT = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === "production";

let viteMiddleware = null;
let staticHandler  = null;

if (isProd) {
  const distDir = path.join(__dirname, "dist");
  if (!fs.existsSync(distDir)) {
    console.error(`\n  ❌  ${distDir} not found. Run 'npm run build' first.\n`);
    process.exit(1);
  }
  staticHandler = (req, res) => {
    let p = req.url.split("?")[0];
    if (p === "/" || !path.extname(p)) p = "/index.html";
    const file = path.join(distDir, p);
    if (!file.startsWith(distDir) || !fs.existsSync(file)) {
      res.writeHead(404); res.end("Not found"); return;
    }
    const ext = path.extname(file).toLowerCase();
    const types = {
      ".html":"text/html",".js":"application/javascript",".css":"text/css",
      ".json":"application/json",".svg":"image/svg+xml",".png":"image/png",
      ".jpg":"image/jpeg",".woff2":"font/woff2",".ico":"image/x-icon",
      ".webmanifest":"application/manifest+json",
      ".woff":"font/woff",".txt":"text/plain",
    };
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  };
} else {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    root: __dirname,
    server: { middlewareMode: true },
    appType: "spa",
  });
  viteMiddleware = vite.middlewares;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (
    url.pathname.startsWith("/api/snaptrade") ||
    url.pathname.startsWith("/api/finnhub")   ||
    url.pathname.startsWith("/api/polygon")   ||
    url.pathname === "/api/advisor"
  ) {
    console.log(`${req.method} ${url.pathname}`);
    try { await handleApi(req, res, url); }
    catch (err) {
      logLine(`api error: ${err.stack || err}`);
      console.error("  ✗", err.message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (viteMiddleware) return viteMiddleware(req, res);
  if (staticHandler)  return staticHandler(req, res);
  res.writeHead(503); res.end("No frontend handler");
});

server.on("error", err => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n  ✗  Port ${PORT} is already in use.`);
    console.error(`     Free it with:  lsof -ti:${PORT} | xargs kill -9\n`);
    process.exit(1);
  }
  logLine(`server error: ${err.stack || err}`);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`
  MĪZAN ${isProd ? "(production)" : "(dev)"}
  → http://localhost:${PORT}
  Client ID: ${CLIENT_ID.slice(0, 8)}...

  API:
    GET  /api/snaptrade/status
    POST /api/snaptrade/login     { broker, connectionType }
    GET  /api/snaptrade/accounts
    GET  /api/snaptrade/holdings?accountId=xxx

  Crash log: ${LOG_FILE}
`);
});
