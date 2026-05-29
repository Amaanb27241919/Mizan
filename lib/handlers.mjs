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

// Server-side keys. Prefer the non-VITE_ name so the client bundle never
// has an excuse to read them. The VITE_ fallback is legacy support only and
// will be removed in the next release — set FINNHUB_KEY / POLYGON_KEY in
// Vercel and drop the VITE_ duplicates.
const FINNHUB_KEY   = (process.env.FINNHUB_KEY   || process.env.VITE_FINNHUB_KEY   || "").trim();
const ANTHROPIC_KEY = (process.env.ANTHROPIC_KEY || process.env.VITE_ANTHROPIC_KEY || "").trim();
const POLYGON_KEY   = (process.env.POLYGON_KEY   || process.env.VITE_POLYGON_KEY   || "").trim();

// Server-owned identity + guardrails prefix that always rides on the /api/advisor
// system prompt. Lives here (not on the client) for three reasons:
//   1. Sharia guardrails can't be edited by a curious user via DevTools.
//   2. The bytes are STABLE per deploy → prompt caching on the /v1/messages
//      endpoint can hit on every repeat advisor turn, cutting input-token cost
//      roughly 30-50% once warm. See: anthropic.com/docs/build-with-claude/prompt-caching
//   3. /api/advisor/count uses the same constant so its pre-flight token math
//      matches what /api/advisor actually sends.
//
// Keep this block at >~1KB so it crosses Anthropic's caching threshold; keep it
// MIZAN-specific so it's worth caching (a generic 100-char system prompt is too
// small for the cache to be a win).
const ADVISOR_SYSTEM_PREFIX = `You are MIZAN's AI advisor — a Sharia-aware personal finance assistant for a Muslim investor using MIZAN's dashboard. Your job is to give specific, numeric, actionable answers grounded in the user's actual portfolio context (provided by the client below this prefix).

OPERATING RULES:
- You are advisory, not transactional. You never place trades, move money, or modify the user's accounts. Direct the user to the relevant MIZAN screen instead (e.g. "Open the Holdings tab and use the Sell action…").
- Default to short, scannable, actionable answers. Aim for under 150 words unless the user explicitly asks for depth. Lead with the number or the conclusion; justify after.
- Cite sources when you make a factual market or ruling claim. If you do not have a source, say so explicitly ("based on general principles, not a specific fatwa").
- When you reference the user's portfolio, ground claims in the PORTFOLIO SUMMARY the client provides — do not invent positions, balances, or contributions.
- When you genuinely don't know, say "I don't know" rather than guessing.

SHARIA GUARDRAILS:
- Decline to recommend, optimize, or strategize around clearly haram instruments — anything whose core economics are riba (interest-bearing bonds, conventional savings yield, margin lending), gharar (excessive uncertainty / pure speculation), or maisir (gambling, lottery-style products, naked options). Politely explain why and suggest a halal alternative.
- For ambiguous instruments (mixed-revenue stocks, sukuk variants, REITs, certain ETFs), apply AAOIFI-style screening as a starting point and flag the ambiguity to the user — do not pretend the answer is settled when it isn't.
- For Zakat: use the user's nisab + lunar-year context if MIZAN provides it; otherwise note the assumptions you made.
- You are not a licensed financial advisor and not a qualified scholar. Always remind the user to consult both for material decisions.`;
// Owner email — when this user signs in, they inherit the legacy mizan_primary
// SnapTrade record (your existing connected brokerages). Everyone else gets a
// fresh empty user. Leave blank in production deployments where no owner-claim
// migration is needed.
const OWNER_EMAIL = (process.env.OWNER_EMAIL || "").trim().toLowerCase();

const SUPABASE_URL              = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
// Vercel sends `Authorization: Bearer ${CRON_SECRET}` on cron requests.
// Accept both names — historical Vercel projects landed on
// CRON_SECRET_PRODUCTION; new code prefers CRON_SECRET. Set EITHER name in
// Vercel; the cron auth gate uses whichever is present (CRON_SECRET wins
// when both exist).
const CRON_SECRET = (process.env.CRON_SECRET || process.env.CRON_SECRET_PRODUCTION || "").trim();

// Public base URL used for Plaid OAuth redirect, Plaid webhook callback,
// and links inside user-facing emails. Falls back to the prod alias so
// existing deployments don't break, but set APP_BASE_URL in Vercel to
// pin it to your canonical domain.
const APP_BASE_URL = (process.env.APP_BASE_URL || "https://mizan-puce.vercel.app").trim().replace(/\/$/, "");

// ── Plaid (banking aggregation) ─────────────────────────
// PLAID_ENV must be "production" on this deployment. We intentionally
// do NOT silently fall back to sandbox if the env var is missing —
// Plaid's production checklist warns against shipping code that
// accidentally talks to /sandbox/. If PLAID_ENV is unset or invalid,
// we refuse to initialize plaidClient and every /api/plaid/* call
// returns 503 "Plaid not configured server-side". Loud > silent.
const PLAID_CLIENT_ID = (process.env.PLAID_CLIENT_ID || "").trim();
const PLAID_SECRET    = (process.env.PLAID_SECRET    || "").trim();
const PLAID_ENV       = (process.env.PLAID_ENV       || "").trim();
const VALID_PLAID_ENVS = new Set(["sandbox", "development", "production"]);

let plaidClient = null;
if (PLAID_CLIENT_ID && PLAID_SECRET && VALID_PLAID_ENVS.has(PLAID_ENV)) {
  try {
    const { Configuration, PlaidApi, PlaidEnvironments } = await import("plaid");
    const basePath = PlaidEnvironments[PLAID_ENV];
    if (!basePath) {
      logError("plaid.init.failed", { reason: "unknown_env", PLAID_ENV });
    } else {
      const config = new Configuration({
        basePath,
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
    }
  } catch (err) {
    logError("plaid.init.failed", { err: err.message });
  }
} else {
  // Distinguish "no keys at all" from "keys present but PLAID_ENV missing
  // or invalid" — the second case is the one most likely to indicate a
  // misconfigured production deploy.
  const reason = !PLAID_CLIENT_ID || !PLAID_SECRET
    ? "not_configured"
    : !PLAID_ENV
    ? "missing_PLAID_ENV"
    : "invalid_PLAID_ENV";
  info("plaid.init.skipped", { reason, PLAID_ENV: PLAID_ENV || null });
}

// Map a Plaid SDK error to { status, code, message } so the frontend
// can show user-friendly text and trigger the right recovery flow.
// Plaid's error shape: err.response?.data has { error_type, error_code, error_message, display_message }.
// Reference: https://plaid.com/docs/errors/
function plaidErrorToResponse(err) {
  const data = err?.response?.data || {};
  const code = data.error_code || "PLAID_UNKNOWN";
  const map = {
    ITEM_LOGIN_REQUIRED:     { status: 401, hint: "UPDATE_MODE_REQUIRED",  msg: "Your bank requires you to sign in again. Click Re-authorize to fix it." },
    PENDING_EXPIRATION:      { status: 401, hint: "UPDATE_MODE_REQUIRED",  msg: "This connection is about to expire. Click Re-authorize to keep it active." },
    PENDING_DISCONNECT:      { status: 401, hint: "UPDATE_MODE_REQUIRED",  msg: "This connection will be disconnected soon. Click Re-authorize to keep it active." },
    INVALID_ACCESS_TOKEN:    { status: 401, hint: "RELINK_REQUIRED",       msg: "This connection is no longer valid. Please disconnect and reconnect this bank." },
    ITEM_LOCKED:             { status: 423, hint: "BANK_LOCKED",           msg: "Your bank locked this connection. Visit your bank's website to unlock, then try again." },
    RATE_LIMIT_EXCEEDED:     { status: 429, hint: "RATE_LIMIT",            msg: "Too many requests right now. Try again in a minute." },
    INVALID_CREDENTIALS:     { status: 401, hint: "RELINK_REQUIRED",       msg: "The credentials we have for this bank are no longer valid. Disconnect and reconnect." },
    INSTITUTION_DOWN:        { status: 503, hint: "BANK_DOWN",             msg: "Your bank is temporarily down. Try again later." },
    INSTITUTION_NOT_RESPONDING: { status: 503, hint: "BANK_DOWN",          msg: "Your bank is slow to respond right now. Try again shortly." },
    PRODUCTS_NOT_SUPPORTED:  { status: 400, hint: "PRODUCT_UNSUPPORTED",   msg: "This bank does not support the features MIZAN needs." },
  };
  const hit = map[code];
  // For mapped codes use our curated user-safe text. For mapped codes only
  // we also allow Plaid's `display_message` (which Plaid commits to being
  // user-safe). Never surface `error_message` to the client — it's an
  // internal diagnostic string that can leak institution names, internal
  // identifiers, or API path hints.
  const safeText = hit?.msg
    || data.display_message
    || "Something went wrong with this bank connection. Please try again.";
  return {
    status: hit?.status || 500,
    body: { error: safeText, code, hint: hit?.hint || null },
  };
}

// ── CSV helpers (used by /api/export/*) ─────────────────
// RFC-4180 cell escaping: any cell containing a comma, double-quote, or any
// kind of newline must be wrapped in double quotes, and any embedded double
// quote must be doubled. Numbers stay unquoted so spreadsheets parse them as
// numerics; null/undefined → empty cell. Booleans → "true"/"false" (unquoted).
// Exported for unit tests; also used internally by every /api/export/* route.
export function csvEscapeCell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  const str = String(value);
  if (/[",\r\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

// Build a CSV string from a column list and an array of row objects.
// Header row is always emitted (even when `rows` is empty) so callers can
// distinguish an empty-but-valid export from a server error. Exported for
// unit tests; also used by every /api/export/* route.
export function toCsv(cols, rows) {
  const safeCols = Array.isArray(cols) ? cols : [];
  const safeRows = Array.isArray(rows) ? rows : [];
  const header = safeCols.map(csvEscapeCell).join(",");
  if (!safeRows.length) return `${header}\r\n`;
  const body = safeRows
    .map((r) => safeCols.map((c) => csvEscapeCell(r ? r[c] : "")).join(","))
    .join("\r\n");
  return `${header}\r\n${body}\r\n`;
}

// ── DB-error classifier ───────────────────────────────────
// Supabase / PostgREST surface "relation does not exist" as PG code 42P01
// (and sometimes PGRST205 when PostgREST can't find the table in its schema
// cache). When a feature's migration hasn't been applied yet, every read
// from that table produces this error. Translate it into a 503 with a clear
// hint instead of a raw 500 — the client can then render "feature pending
// setup" instead of a scary "HTTP 500" message.
function isMissingRelationError(err) {
  if (!err) return false;
  const code = err.code || "";
  if (code === "42P01" || code === "PGRST205") return true;
  const msg = (err.message || "").toLowerCase();
  return /relation .* does not exist|could not find the table|schema cache/.test(msg);
}
function missingMigrationResponse(feature, migration) {
  return {
    status: 503,
    body: {
      error: `${feature} table not yet provisioned in this Supabase project.`,
      hint: "MIGRATION_PENDING",
      migration,
    },
  };
}

// ── Plaid /transactions/sync helper ──────────────────────
// Cursor-based diff sync per Plaid's recommended workflow:
// https://plaid.com/docs/transactions/
function mapPlaidTransaction(tx, userId, itemId) {
  return {
    user_id:           userId,
    item_id:           itemId,
    account_id:        tx.account_id,
    transaction_id:    tx.transaction_id,
    amount:            tx.amount,
    iso_currency_code: tx.iso_currency_code || null,
    name:              tx.name || null,
    merchant_name:     tx.merchant_name || null,
    category_primary:  tx.personal_finance_category?.primary || null,
    category_detailed: tx.personal_finance_category?.detailed || null,
    date:              tx.date || null,
    pending:           !!tx.pending,
    payment_channel:   tx.payment_channel || null,
    raw_data:          tx,
    updated_at:        new Date().toISOString(),
  };
}

async function syncPlaidItem(sbAdmin, plaidClient, token) {
  // token = { user_id, item_id, access_token, transactions_cursor }
  let cursor = token.transactions_cursor || null;
  let hasMore = true;
  let added = 0, modified = 0, removed = 0;

  // Hard cap on pages per single sync call. Each page is up to 500 txns, so
  // 200 pages = 100k transactions, well above any reasonable single-user
  // backfill. This is defensive against an unbounded loop if Plaid ever
  // returns has_more=true indefinitely.
  const MAX_PAGES = 200;
  let pages = 0;

  while (hasMore && pages < MAX_PAGES) {
    pages += 1;
    const r = await plaidClient.transactionsSync({
      access_token: token.access_token,
      cursor: cursor || undefined,
      count: 500,
    });
    const d = r.data || {};
    const addedRows    = (d.added    || []).map(tx => mapPlaidTransaction(tx, token.user_id, token.item_id));
    const modifiedRows = (d.modified || []).map(tx => mapPlaidTransaction(tx, token.user_id, token.item_id));
    const removedIds   = (d.removed  || []).map(rm => rm.transaction_id).filter(Boolean);

    if (addedRows.length || modifiedRows.length) {
      const upsertRows = [...addedRows, ...modifiedRows];
      const { error: upsertErr } = await sbAdmin
        .from("plaid_transactions")
        .upsert(upsertRows, { onConflict: "transaction_id" });
      if (upsertErr) throw new Error(`plaid_transactions upsert: ${upsertErr.message}`);
    }
    if (removedIds.length) {
      // Defense-in-depth: scope the delete by user_id in addition to
      // transaction_id. transaction_id is UNIQUE today so each row belongs
      // to exactly one user, but adding the user_id predicate means a
      // future schema change (e.g. relaxing the UNIQUE for re-ingest) can't
      // silently turn this into a cross-user delete.
      const { error: delErr } = await sbAdmin
        .from("plaid_transactions")
        .delete()
        .eq("user_id", token.user_id)
        .in("transaction_id", removedIds);
      if (delErr) throw new Error(`plaid_transactions delete: ${delErr.message}`);
    }

    added    += addedRows.length;
    modified += modifiedRows.length;
    removed  += removedIds.length;
    cursor   = d.next_cursor;
    hasMore  = !!d.has_more;
  }

  // Persist the advanced cursor so the next call resumes from here.
  const { error: cursorErr } = await sbAdmin
    .from("plaid_tokens")
    .update({ transactions_cursor: cursor })
    .eq("item_id", token.item_id);
  if (cursorErr) warn("plaid.sync.cursor_persist_failed", { item_id: token.item_id, err: cursorErr.message });

  return { added, modified, removed, pages };
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
async function applyRateLimit(pathname, headers, query = {}) {
  // Cron is gated by CRON_SECRET separately; skip rate limiting so the
  // scheduled job isn't starved by other traffic in the same minute.
  if (pathname === "/api/cron/sync"
      || pathname === "/api/cron/cleanup"
      || pathname === "/api/cron/nightly-snapshot"
      || pathname === "/api/cron/weekly-digest"
      || pathname === "/api/cron/dividend-check"
      || pathname === "/api/cron/bill-reminders") return null;
  if (pathname === "/api/snaptrade/status") return null;

  // Reconstruct a minimal query string so matchAction can detect ?sync=1
  // (which routes to the tighter plaid.sync bucket).
  const search = Object.entries(query)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  const action = matchAction(pathname, search);
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

  // Rate limit early — before we hit Supabase or any upstream API. Pass the
  // query so /api/plaid/transactions?sync=1 lands in the tighter bucket.
  const rl = await applyRateLimit(pathname, h, q);
  if (rl && !rl.allowed) {
    const retryAfter = 3600 - (Math.floor(Date.now() / 1000) % 3600);
    const search = Object.entries(q).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
    warn("rate.limit_hit", { action: matchAction(pathname, search), count: rl.count, max: rl.max });
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
    const clientSystem = typeof parsed.system === "string" ? parsed.system : "";
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

    // Prompt caching: send `system` as an array of text blocks with
    // cache_control on the last block. The MIZAN prefix is stable across all
    // advisor turns; the client-provided system block is stable across the
    // current conversation. Anthropic caches the longest matching prefix
    // automatically — see anthropic.com/docs/build-with-claude/prompt-caching.
    const systemBlocks = [
      { type: "text", text: ADVISOR_SYSTEM_PREFIX, cache_control: { type: "ephemeral" } },
    ];
    if (clientSystem) {
      systemBlocks.push({ type: "text", text: clientSystem, cache_control: { type: "ephemeral" } });
    }

    const payload = { model, max_tokens, messages, system: systemBlocks };
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
          // Required to opt into prompt caching at time of writing. Cheap to
          // keep set even after caching becomes GA — Anthropic ignores
          // unknown beta flags.
          "anthropic-beta":    "prompt-caching-2024-07-31",
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
    // Surface cache hit/miss separately so we can verify the caching strategy
    // in observability — cache_read_input_tokens climbing on repeat turns
    // means the prefix is hitting; cache_creation_input_tokens means the
    // cache slot was (re-)written this turn.
    {
      let cacheUserId = null;
      try {
        const cacheUser = await verifyUser(h);
        cacheUserId = cacheUser?.id || null;
      } catch { /* observability is best-effort */ }
      info("advisor.cache", {
        user: cacheUserId,
        cache_creation_input_tokens: usage.cache_creation_input_tokens || 0,
        cache_read_input_tokens:     usage.cache_read_input_tokens     || 0,
      });
    }
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

  // Pre-flight token counting. Lets the frontend reject obviously oversized
  // contexts before they hit the paid /v1/messages endpoint, and lets it warn
  // the user about long-context turns that will be slower / more expensive.
  // Plumbs ADVISOR_SYSTEM_PREFIX into the count so the number is honest
  // about what /api/advisor will actually send.
  // Docs: anthropic.com/docs/build-with-claude/token-counting
  if (pathname === "/api/advisor/count" && method === "POST") {
    if (!ANTHROPIC_KEY) {
      info("advisor.count.skipped", { reason: "no_key" });
      return { status: 503, body: { error: "ANTHROPIC_KEY not configured server-side" } };
    }
    const messages   = Array.isArray(parsed.messages) ? parsed.messages : [];
    const clientSystem = typeof parsed.system === "string" ? parsed.system : "";
    const model      = typeof parsed.model === "string" && parsed.model
      ? parsed.model
      : "claude-sonnet-4-20250514";

    const systemBlocks = [
      { type: "text", text: ADVISOR_SYSTEM_PREFIX },
    ];
    if (clientSystem) systemBlocks.push({ type: "text", text: clientSystem });

    const payload = { model, messages, system: systemBlocks };
    const bodyStr = JSON.stringify(payload);

    const countRes = await new Promise((resolve, reject) => {
      const r = https.request({
        hostname: "api.anthropic.com",
        port: 443,
        path: "/v1/messages/count_tokens",
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

    if (countRes.status !== 200 || typeof countRes.body !== "object") {
      warn("advisor.count.upstream_failed", { status: countRes.status });
      return { status: countRes.status || 502, body: countRes.body };
    }

    const input_tokens = Number(countRes.body?.input_tokens) || 0;
    const MAX_INPUT_TOKENS = 8000;
    if (input_tokens > MAX_INPUT_TOKENS) {
      info("advisor.count.rejected", { input_tokens });
      return {
        status: 400,
        body: {
          error: `Context too large (${input_tokens} input tokens, max ${MAX_INPUT_TOKENS}). Trim the conversation or reduce attached context.`,
          input_tokens,
          max_input_tokens: MAX_INPUT_TOKENS,
        },
      };
    }
    info("advisor.count.ok", { input_tokens });
    return { status: 200, body: { input_tokens } };
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

  // ── Account nicknames ───────────────────────────────────
  // Per-user overrides for the broker-default account labels. Both
  // SnapTrade and Plaid surface fixed names ("Chase ····0832") that
  // users with multiple connections find unreadable. This route lets
  // them rename "Chase ····0832" → "Sunduq Amaanah" without touching
  // either provider. The Supabase RLS policies (012_account_nicknames.sql)
  // pin every row to its owner; we use sbAdmin here so the
  // service-role bypasses RLS, but we still scope every query by
  // user.id derived from the verified JWT.
  if (pathname === "/api/account-nicknames") {
    if (!sbAdmin) return { status: 503, body: { error: "Supabase not configured" } };
    const user = await verifyUser(h);
    if (!user) return { status: 401, body: { error: "Unauthenticated" } };

    // GET — return the full map for the current user. Shape is
    // { nicknames: { <account_id>: <nickname>, ... } } so the client
    // can do an O(1) lookup per account card without re-walking an
    // array.
    if (method === "GET") {
      const { data, error } = await sbAdmin
        .from("account_nicknames")
        .select("account_id, nickname")
        .eq("user_id", user.id);
      if (error) {
        if (isMissingRelationError(error)) {
          info("account_nicknames.read.migration_pending");
          return missingMigrationResponse("Account nicknames", "012_account_nicknames.sql");
        }
        logError("account_nicknames.read.failed", { err: error.message });
        return { status: 500, body: { error: error.message } };
      }
      const nicknames = {};
      for (const row of data || []) {
        if (row?.account_id) nicknames[row.account_id] = row.nickname;
      }
      return { status: 200, body: { nicknames } };
    }

    // PUT — upsert (account_id, nickname). Empty / null / whitespace
    // nickname is treated as "remove the override", deleting the row
    // so the UI falls back to the broker-default name.
    if (method === "PUT") {
      const accountId = typeof parsed.account_id === "string" ? parsed.account_id.trim() : "";
      if (!accountId) return { status: 400, body: { error: "account_id required" } };
      // Cap nickname length at 80 chars — anything longer wraps badly
      // in the card UI and is almost certainly user error.
      const rawNickname = typeof parsed.nickname === "string" ? parsed.nickname.trim() : "";
      const nickname = rawNickname.slice(0, 80);
      if (!nickname) {
        const { error } = await sbAdmin
          .from("account_nicknames")
          .delete()
          .eq("user_id", user.id)
          .eq("account_id", accountId);
        if (error) {
          if (isMissingRelationError(error)) return missingMigrationResponse("Account nicknames", "012_account_nicknames.sql");
          logError("account_nicknames.delete.failed", { err: error.message });
          return { status: 500, body: { error: error.message } };
        }
        return { status: 200, body: { ok: true, account_id: accountId, nickname: null } };
      }
      const { error } = await sbAdmin
        .from("account_nicknames")
        .upsert(
          { user_id: user.id, account_id: accountId, nickname, updated_at: new Date().toISOString() },
          { onConflict: "user_id,account_id" }
        );
      if (error) {
        if (isMissingRelationError(error)) return missingMigrationResponse("Account nicknames", "012_account_nicknames.sql");
        logError("account_nicknames.write.failed", { err: error.message });
        return { status: 500, body: { error: error.message } };
      }
      return { status: 200, body: { ok: true, account_id: accountId, nickname } };
    }

    return { status: 405, body: { error: "Method not allowed" } };
  }

  // ── Plaid (banking aggregation) ──────────────────────
  // All Plaid endpoints require an authenticated Supabase user. The
  // access_token never leaves the server — clients only see sanitized
  // account info + balances + transactions.
  if (pathname.startsWith("/api/plaid/")) {
    if (!plaidClient) {
      return { status: 503, body: { error: "Plaid not configured server-side" } };
    }

    // POST /api/plaid/webhook — Plaid posts here for ITEM_LOGIN_REQUIRED,
    // PENDING_EXPIRATION, NEW_ACCOUNTS_AVAILABLE, TRANSACTIONS_SYNC_UPDATES,
    // and similar events. Plaid's servers do not authenticate via our JWT
    // (they're external), so this route is exempt from verifyUser + AAL2.
    // We store the event for the affected user to consume on next sign-in.
    if (pathname === "/api/plaid/webhook" && method === "POST") {
      try {
        const webhook_type = parsed.webhook_type || "UNKNOWN";
        const webhook_code = parsed.webhook_code || "UNKNOWN";
        const item_id      = parsed.item_id      || null;
        // Look up which user owns this Item so we can tag the event.
        let user_id = null;
        let institution_name = null;
        if (item_id && sbAdmin) {
          const { data: tok } = await sbAdmin
            .from("plaid_tokens")
            .select("user_id, institution_name")
            .eq("item_id", item_id)
            .maybeSingle();
          user_id = tok?.user_id || null;
          institution_name = tok?.institution_name || null;
          // For events that need the user's attention (re-auth, expiration),
          // record an audit entry tagged to that user so the in-app
          // notifications system can surface a prompt next sign-in.
          if (user_id) {
            // Allowlist the metadata we persist — never spread the raw
            // webhook body into audit_log. Plaid may add new fields over
            // time (partial account numbers, free-form text, etc.) and we
            // don't want any of that to land in the audit table without
            // explicit review. Stick to the few fields we actually use.
            const safeMetadata = { item_id, webhook_type, webhook_code };
            if (typeof parsed.new_transactions === "number") {
              safeMetadata.new_transactions = parsed.new_transactions;
            }
            if (typeof parsed.error?.error_code === "string") {
              safeMetadata.error_code = parsed.error.error_code;
            }
            audit({
              userId: user_id,
              action: `plaid.webhook.${webhook_type.toLowerCase()}.${webhook_code.toLowerCase()}`,
              target: institution_name,
              metadata: safeMetadata,
              headers: h,
            });
          }
        }
        // Auto-sync trigger. When Plaid says new transaction data is
        // available for an Item, fire syncPlaidItem immediately so the
        // user sees their transactions on next refresh without having to
        // click the manual Sync button. Covers BOTH:
        //   · TRANSACTIONS/SYNC_UPDATES_AVAILABLE — the cursor-API signal
        //   · TRANSACTIONS/INITIAL_UPDATE / HISTORICAL_UPDATE / DEFAULT_UPDATE
        //     — legacy webhooks; still fired even on the sync API path
        // We DO NOT block the webhook response on this. Plaid retries
        // aggressively if we 5xx or take too long, so we return 200 below
        // and let the sync run in the background.
        const SYNC_TRIGGERS = new Set([
          "SYNC_UPDATES_AVAILABLE",
          "INITIAL_UPDATE",
          "HISTORICAL_UPDATE",
          "DEFAULT_UPDATE",
        ]);
        if (
          webhook_type === "TRANSACTIONS" &&
          SYNC_TRIGGERS.has(webhook_code) &&
          user_id && item_id && sbAdmin && plaidClient
        ) {
          (async () => {
            try {
              const { data: tok } = await sbAdmin
                .from("plaid_tokens")
                .select("user_id, access_token, item_id, institution_name, transactions_cursor")
                .eq("item_id", item_id)
                .maybeSingle();
              if (!tok?.access_token) return;
              const result = await syncPlaidItem(sbAdmin, plaidClient, tok);
              info("plaid.webhook.auto_sync.ok", {
                item_id,
                user_id,
                webhook_code,
                added: result.added,
                modified: result.modified,
                removed: result.removed,
                pages: result.pages,
              });
            } catch (syncErr) {
              warn("plaid.webhook.auto_sync.failed", {
                item_id,
                user_id,
                webhook_code,
                err: syncErr.message,
              });
            }
          })();
        }

        // Side-channel: email the user when the connection genuinely needs
        // their attention (re-auth required, expiration, disconnect pending).
        // Plaid retries webhooks aggressively, so we fire-and-forget; the
        // 200 response below is what they care about.
        const NEEDS_EMAIL = new Set([
          "PENDING_EXPIRATION",
          "ITEM_LOGIN_REQUIRED",
          "PENDING_DISCONNECT",
        ]);
        if (user_id && sbAdmin && NEEDS_EMAIL.has(webhook_code)) {
          try {
            const { data: userRow } = await sbAdmin.auth.admin.getUserById(user_id);
            const email = userRow?.user?.email;
            if (email) {
              const instLabel = institution_name || "your bank";
              const subject = `Re-authorize ${instLabel} on MIZAN`;
              const body = `Your connected bank requires you to sign in again so we can keep balances and transactions in sync. Visit https://mizan-puce.vercel.app and click Re-authorize on ${instLabel}.`;
              sendUserEmail(email, subject, body, sbAdmin).catch(() => {});
            }
          } catch (mailErr) {
            warn("plaid.webhook.email_failed", { err: mailErr.message, webhook_code });
          }
        }
        info("plaid.webhook", { webhook_type, webhook_code, item_id, user_id });
        // Plaid expects a 200 quickly. We do not block on side effects.
        return { status: 200, body: { received: true } };
      } catch (err) {
        logError("plaid.webhook.failed", { err: err.message });
        // Still return 200 — Plaid retries failed webhooks aggressively
        // and our processing failure isn't their problem.
        return { status: 200, body: { received: true, processed: false } };
      }
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
    // redirect_uri is required by Plaid Production for OAuth institutions
    // (Chase, BofA, Capital One, USAA, Wells Fargo, etc.). It must:
    //   - be HTTPS
    //   - exactly match a URI on the Plaid Dashboard allowlist
    //   - point to a route the frontend handles by re-initialising
    //     Plaid Link with receivedRedirectUri=window.location.href
    // Default to /oauth-redirect on this deployment so the redirect lands
    // on a dedicated path the SPA can detect and resume. Override via
    // PLAID_REDIRECT_URI env var for staging / branch previews.
    // client_name uses ASCII MIZAN (no macron) so Plaid's text rendering
    // and Sentry telemetry don't trip on the diacritic.
    if (pathname === "/api/plaid/link-token" && method === "POST") {
      try {
        // Update mode: when an existing Item needs the user to re-auth
        // (password change, MFA reset, bank-side session expiry), the
        // client posts { item_id } and we look up the user's stored
        // access_token server-side. The access_token NEVER leaves the
        // server. Plaid then issues a link token that resumes the
        // existing connection instead of creating a new one.
        const updateItemId = parsed.item_id || null;
        let updateAccessToken = null;
        if (updateItemId) {
          const { data: tok } = await sbAdmin
            .from("plaid_tokens")
            .select("access_token")
            .eq("user_id", user.id)
            .eq("item_id", updateItemId)
            .maybeSingle();
          if (!tok?.access_token) {
            return { status: 404, body: { error: "Item not found for this user", code: "ITEM_NOT_FOUND" } };
          }
          updateAccessToken = tok.access_token;
        }
        const baseConfig = {
          user: { client_user_id: user.id },
          client_name: "MIZAN",
          country_codes: ["US"],
          language: "en",
          redirect_uri: process.env.PLAID_REDIRECT_URI || "https://mizan-puce.vercel.app/oauth-redirect",
          webhook: process.env.PLAID_WEBHOOK_URL || "https://mizan-puce.vercel.app/api/plaid/webhook",
        };
        const config = updateAccessToken
          ? { ...baseConfig, access_token: updateAccessToken }   // update mode
          : { ...baseConfig, products: ["transactions"] };       // new link
        const r = await plaidClient.linkTokenCreate(config);
        info("plaid.link_token.ok", { mode: updateAccessToken ? "update" : "new", item_id: updateItemId });
        return { status: 200, body: { link_token: r.data.link_token, expiration: r.data.expiration } };
      } catch (err) {
        logError("plaid.link_token.failed", { detail: err.response?.data || err.message });
        return plaidErrorToResponse(err);
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

        // Duplicate Item detection: if this user already has a token for
        // the same institution_id, the new public_token represents a
        // duplicate link. Plaid Production checklist item: prevent the
        // confusion + double billing of two Items for the same bank.
        // We revoke the new Item at Plaid (so we aren't billed for it),
        // log the duplicate, and surface a friendly response to the
        // client so the UI can prompt "you're already linked to X".
        if (institution_id) {
          const { data: existing } = await sbAdmin
            .from("plaid_tokens")
            .select("item_id, institution_name")
            .eq("user_id", user.id)
            .eq("institution_id", institution_id)
            .maybeSingle();
          if (existing?.item_id && existing.item_id !== item_id) {
            try { await plaidClient.itemRemove({ access_token }); } catch { /* best effort */ }
            audit({ userId: user.id, action: "bank.duplicate_blocked", target: institution_name, metadata: { institution_id, existing_item_id: existing.item_id, attempted_item_id: item_id }, headers: h });
            info("plaid.exchange.duplicate", { institution_id, existing_item_id: existing.item_id });
            return {
              status: 409,
              body: {
                error: `You are already linked to ${existing.institution_name}. Disconnect the existing link first if you want to re-connect.`,
                code: "PLAID_DUPLICATE_ITEM",
                institution_name: existing.institution_name,
              },
            };
          }
        }

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
        logError("plaid.exchange.failed", { detail: err.response?.data || err.message });
        return plaidErrorToResponse(err);
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
          try {
            const r = await plaidClient.accountsGet({ access_token: t.access_token });
            return {
              ok: true,
              accounts: (r.data.accounts || []).map(a => ({
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
              })),
            };
          } catch (perItemErr) {
            // Per-item Plaid error (e.g. ITEM_LOGIN_REQUIRED on one Item but
            // not others). Don't fail the whole request — surface the code
            // so the client can show a per-institution Re-authorize banner.
            const mapped = plaidErrorToResponse(perItemErr);
            logError("plaid.accounts.item_failed", {
              item_id: t.item_id,
              detail: perItemErr.response?.data || perItemErr.message,
            });
            return {
              ok: false,
              item_id: t.item_id,
              institution_name: t.institution_name,
              code: mapped.body.code,
              hint: mapped.body.hint,
              error: mapped.body.error,
            };
          }
        }));
        const accounts = settled.flatMap(r =>
          r.status === "fulfilled" && r.value.ok ? r.value.accounts : []);
        const itemErrors = settled
          .filter(r => r.status === "fulfilled" && !r.value.ok)
          .map(r => ({
            item_id: r.value.item_id,
            institution_name: r.value.institution_name,
            code: r.value.code,
            hint: r.value.hint,
            error: r.value.error,
          }));

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
        return { status: 200, body: { accounts, item_errors: itemErrors } };
      } catch (err) {
        logError("plaid.accounts.failed", { detail: err.response?.data || err.message });
        return plaidErrorToResponse(err);
      }
    }

    // GET /api/plaid/transactions
    //
    // Two modes, dispatched on `?sync=1`:
    //
    //   sync=1 — Pull fresh diffs from Plaid using the stored per-Item
    //            cursor, apply added/modified/removed to the
    //            plaid_transactions table, then advance the cursor.
    //            Returns counts only (the frontend re-reads from the table
    //            on the subsequent GET).
    //
    //   (no q) — Read the latest 200 rows from plaid_transactions for the
    //            current user, newest first. Cheap, cacheable, never hits
    //            Plaid. This is what the Finances tab calls on render.
    //
    // The split keeps reads fast (single Postgres query) and writes
    // batched (one /transactions/sync call per Item per sync trigger).
    if (pathname === "/api/plaid/transactions") {
      const shouldSync = q.sync === "1" || q.sync === "true";

      if (shouldSync) {
        // reset=1 clears the stored cursor before sync so Plaid replays
        // the Item from the beginning. Use case: the user's table is empty
        // but manual sync returns "Up to date" — meaning Plaid's cursor
        // advanced past data we either never persisted or never received.
        // Optional item_id scopes the reset (and sync) to one Item; without
        // it, every Item the user owns is reset and re-pulled. Idempotent:
        // a reset on an already-complete Item just re-walks pages and the
        // upsert(onConflict=transaction_id) writes nothing new.
        const shouldReset = q.reset === "1" || q.reset === "true";
        const onlyItemId  = typeof q.item_id === "string" && q.item_id ? q.item_id : null;
        try {
          let tokensQuery = sbAdmin
            .from("plaid_tokens")
            .select("user_id, access_token, item_id, institution_name, transactions_cursor")
            .eq("user_id", user.id);
          if (onlyItemId) tokensQuery = tokensQuery.eq("item_id", onlyItemId);
          const { data: tokens } = await tokensQuery;
          if (!Array.isArray(tokens) || tokens.length === 0) {
            return { status: 200, body: { ok: true, added: 0, modified: 0, removed: 0, items: 0 } };
          }

          if (shouldReset) {
            const itemIds = tokens.map(t => t.item_id);
            const { error: resetErr } = await sbAdmin
              .from("plaid_tokens")
              .update({ transactions_cursor: null })
              .eq("user_id", user.id)
              .in("item_id", itemIds);
            if (resetErr) {
              warn("plaid.transactions.sync.reset_failed", { user: user.id, err: resetErr.message });
            } else {
              // Sync from a null cursor below since we just nulled it in DB.
              for (const t of tokens) t.transactions_cursor = null;
              info("plaid.transactions.sync.reset", { user: user.id, items: itemIds.length });
              audit({ userId: user.id, action: "plaid.cursor_reset", metadata: { items: itemIds.length, item_id: onlyItemId || null }, headers: h });
            }
          }

          let added = 0, modified = 0, removed = 0, ok = 0, failed = 0;
          const errors = [];
          const perItem = [];
          for (const t of tokens) {
            try {
              const r = await syncPlaidItem(sbAdmin, plaidClient, t);
              added    += r.added;
              modified += r.modified;
              removed  += r.removed;
              ok += 1;
              perItem.push({ item_id: t.item_id, institution_name: t.institution_name, added: r.added, modified: r.modified, removed: r.removed, pages: r.pages });
            } catch (e) {
              failed += 1;
              const mapped = plaidErrorToResponse(e);
              warn("plaid.transactions.sync.item_failed", {
                item_id: t.item_id,
                detail: e.response?.data || e.message,
              });
              errors.push({
                item_id: t.item_id,
                institution_name: t.institution_name,
                code: mapped.body.code,
                hint: mapped.body.hint,
                error: mapped.body.error,
              });
            }
          }
          info("plaid.transactions.sync.ok", { user: user.id, items: tokens.length, ok, failed, added, modified, removed, reset: shouldReset });
          return { status: 200, body: { ok: failed === 0, items: tokens.length, ok_count: ok, failed, added, modified, removed, errors, per_item: perItem, reset: shouldReset } };
        } catch (err) {
          const detail = err.response?.data || err.message;
          logError("plaid.transactions.sync.failed", { detail });
          return { status: 500, body: { error: typeof detail === "string" ? detail : JSON.stringify(detail) } };
        }
      }

      // Read path — table only, no Plaid call. We reshape the row into
      // the legacy {personal_finance_category, iso_currency, category}
      // shape that the Finances component already understands, so the
      // frontend renders unchanged after this migration.
      try {
        const { data, error } = await sbAdmin
          .from("plaid_transactions")
          .select("*")
          .eq("user_id", user.id)
          .order("date", { ascending: false })
          .limit(200);
        if (error) throw new Error(error.message);
        const transactions = (data || []).map(row => ({
          transaction_id:   row.transaction_id,
          account_id:       row.account_id,
          item_id:          row.item_id,
          date:             row.date,
          name:             row.name,
          merchant_name:    row.merchant_name,
          amount:           row.amount,
          iso_currency:     row.iso_currency_code || "USD",
          pending:          !!row.pending,
          payment_channel:  row.payment_channel,
          personal_finance_category: row.category_primary
            ? { primary: row.category_primary, detailed: row.category_detailed || row.category_primary }
            : null,
          category: row.category_primary ? [row.category_primary] : [],
        }));
        return { status: 200, body: { transactions } };
      } catch (err) {
        logError("plaid.transactions.read.failed", { err: err.message });
        return { status: 500, body: { error: err.message } };
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
        // Honor the SECURITY.md retention rule: on disconnect, drop every
        // table row that holds data from this Item. Order: transactions →
        // accounts → tokens (tokens last so RLS-derived joins, if any are
        // added later, can still resolve user_id during the delete).
        await sbAdmin.from("plaid_transactions").delete().eq("user_id", user.id).eq("item_id", itemId);
        await sbAdmin.from("plaid_accounts"    ).delete().eq("user_id", user.id).eq("item_id", itemId);
        await sbAdmin.from("plaid_tokens"      ).delete().eq("user_id", user.id).eq("item_id", itemId);
        audit({ userId: user.id, action: "bank.disconnect", target: row.institution_name, metadata: { item_id: itemId }, headers: h });
        return { status: 200, body: { ok: true, item_id: itemId } };
      } catch (err) {
        logError("plaid.item_delete.failed", { detail: err.response?.data || err.message });
        return plaidErrorToResponse(err);
      }
    }

    return { status: 404, body: { error: "Unknown plaid endpoint" } };
  }

  // ── Connection Health (cross-provider status dashboard) ──────────
  // GET /api/connections/health → per-item status across both providers.
  // Lets Settings → Connections render a single triage view: which banks /
  // brokerages are healthy, which need re-auth, when each last synced.
  if (pathname === "/api/connections/health" && method === "GET") {
    if (!sbAdmin) return { status: 503, body: { error: "Supabase not configured" } };
    const user = await verifyUser(h);
    if (!user) return { status: 401, body: { error: "Unauthenticated" } };

    const items = [];

    // ── Plaid items (banking + investment via Plaid) ──────────────
    try {
      const { data: tokens, error: tokErr } = await sbAdmin
        .from("plaid_tokens")
        .select("item_id, institution_name, created_at")
        .eq("user_id", user.id);
      if (!tokErr && Array.isArray(tokens)) {
        // Pull the most-recent transaction per item to derive last_sync_at.
        const itemIds = tokens.map(t => t.item_id).filter(Boolean);
        const lastSyncByItem = new Map();
        if (itemIds.length) {
          for (const id of itemIds) {
            const { data: txRow } = await sbAdmin
              .from("plaid_transactions")
              .select("updated_at")
              .eq("user_id", user.id).eq("item_id", id)
              .order("updated_at", { ascending: false })
              .limit(1).maybeSingle();
            if (txRow?.updated_at) lastSyncByItem.set(id, txRow.updated_at);
          }
        }
        // Latest webhook code per item — drives "needs re-auth" inference.
        const REAUTH_CODES = new Set(["ITEM_LOGIN_REQUIRED","PENDING_EXPIRATION","PENDING_DISCONNECT"]);
        const lastWebhookByItem = new Map();
        if (itemIds.length) {
          const { data: events } = await sbAdmin
            .from("audit_log")
            .select("action, metadata, created_at")
            .eq("user_id", user.id)
            .like("action", "plaid.webhook.%")
            .order("created_at", { ascending: false })
            .limit(200);
          (events || []).forEach(ev => {
            const iid = ev?.metadata?.item_id;
            if (iid && !lastWebhookByItem.has(iid)) {
              lastWebhookByItem.set(iid, ev.metadata?.webhook_code || null);
            }
          });
        }
        tokens.forEach(t => {
          const wh = lastWebhookByItem.get(t.item_id) || null;
          const needs_reauth = REAUTH_CODES.has(wh || "");
          items.push({
            provider:     "plaid",
            item_id:      t.item_id,
            institution:  t.institution_name || "Bank",
            status:       needs_reauth ? "reauth" : "ok",
            last_sync_at: lastSyncByItem.get(t.item_id) || null,
            needs_reauth,
            error_code:   needs_reauth ? wh : null,
            connected_at: t.created_at || null,
          });
        });
      }
    } catch (e) {
      warn("connections.health.plaid_failed", { err: e.message });
    }

    // ── SnapTrade authorizations (brokerage) ──────────────────────
    try {
      const snap = await getSnapForRequest(h).catch(() => null);
      if (snap?.userId && snap?.userSecret) {
        const r = await snapReq("GET", "/authorizations", null,
          { userId: snap.userId, userSecret: snap.userSecret });
        const auths = Array.isArray(r?.body) ? r.body : [];
        auths.forEach(a => {
          const disabled = !!a.disabled;
          items.push({
            provider:     "snaptrade",
            item_id:      a.id,
            institution:  a.brokerage?.name || a.name || "Brokerage",
            status:       disabled ? "reauth" : "ok",
            last_sync_at: a.updated_date || a.created_date || null,
            needs_reauth: disabled,
            error_code:   disabled ? "DISABLED" : null,
            connected_at: a.created_date || null,
          });
        });
      }
    } catch (e) {
      warn("connections.health.snap_failed", { err: e.message });
    }

    return { status: 200, body: { items } };
  }

  // ── Bug report (in-app feedback → operator email) ────────────────
  // POST /api/bug-report — JWT-gated, rate-limited (10/hr per user).
  // Sends an email to OWNER_EMAIL via Resend with the description + a
  // small context blob (page, viewport, build SHA). We audit the
  // submission but NEVER persist the free-text description (it can hold
  // PII the user typed in panic) — only its length.
  if (pathname === "/api/bug-report" && method === "POST") {
    const user = await verifyUser(h);
    if (!user) return { status: 401, body: { error: "Unauthenticated" } };

    const description = String(parsed?.description || "").trim();
    const severity    = ["low","medium","high"].includes(parsed?.severity) ? parsed.severity : "medium";
    const context     = parsed?.context && typeof parsed.context === "object" ? parsed.context : {};

    if (description.length < 10)   return { status: 400, body: { error: "Description must be at least 10 characters" } };
    if (description.length > 2000) return { status: 400, body: { error: "Description must be under 2000 characters" } };

    // Allowlist what we actually surface in the email body — never spread
    // the raw context object (a malicious or buggy client could stuff
    // anything in there).
    const safeCtx = {
      url:         typeof context.url === "string"        ? context.url.slice(0, 300)        : null,
      user_agent:  typeof context.user_agent === "string" ? context.user_agent.slice(0, 300) : null,
      viewport:    typeof context.viewport === "string"   ? context.viewport.slice(0, 32)    : null,
      app_version: typeof context.app_version === "string"? context.app_version.slice(0, 64) : null,
      nav:         typeof context.nav === "string"        ? context.nav.slice(0, 32)         : null,
      theme:       typeof context.theme === "string"      ? context.theme.slice(0, 16)       : null,
    };

    let emailed = false;
    if (OWNER_EMAIL) {
      try {
        const subject = `[MIZAN bug · ${severity}] ${description.slice(0, 60)}${description.length > 60 ? "…" : ""}`;
        const body =
`Bug report from MIZAN user.

User ID:  ${user.id}
Email:    ${user.email || "(none)"}
Severity: ${severity}

────────────────────────────────────────
${description}
────────────────────────────────────────

Context:
${Object.entries(safeCtx).filter(([,v]) => v != null).map(([k,v]) => `  ${k}: ${v}`).join("\n")}
`;
        await sendUserEmail(OWNER_EMAIL, subject, body, sbAdmin);
        emailed = true;
      } catch (mailErr) {
        warn("bug_report.email_failed", { err: mailErr.message });
      }
    }

    audit({
      userId: user.id,
      action: "bug.reported",
      target: severity,
      metadata: { description_chars: description.length, has_context: Object.values(safeCtx).some(Boolean), emailed },
      headers: h,
    });
    info("bug.reported", { user: user.id, severity, chars: description.length, emailed });

    return { status: 200, body: { ok: true, emailed } };
  }

  // ── Budgets (per-category monthly caps) ────────────────
  // GET  /api/budgets — list the caller's budgets.
  // PUT  /api/budgets — body {category, monthly_limit}. If monthly_limit
  //                     <= 0 or null, DELETE the row; otherwise upsert.
  if (pathname === "/api/budgets") {
    if (!sbAdmin) return { status: 503, body: { error: "Supabase not configured" } };
    const user = await verifyUser(h);
    if (!user) return { status: 401, body: { error: "Unauthenticated" } };

    if (method === "GET") {
      const { data, error } = await sbAdmin
        .from("budgets")
        .select("category, monthly_limit, currency")
        .eq("user_id", user.id)
        .order("category", { ascending: true });
      if (error) {
        if (isMissingRelationError(error)) {
          info("budgets.read.migration_pending");
          return missingMigrationResponse("Budgets", "013_budgets.sql");
        }
        logError("budgets.read.failed", { err: error.message });
        return { status: 500, body: { error: error.message } };
      }
      const budgets = (data || []).map(r => ({
        category:      r.category,
        monthly_limit: Number(r.monthly_limit),
        currency:      r.currency || "USD",
      }));
      return { status: 200, body: { budgets } };
    }

    if (method === "PUT") {
      const rawCategory = parsed.category;
      const category = typeof rawCategory === "string" ? rawCategory.trim() : "";
      if (!category) return { status: 400, body: { error: "category required" } };

      const rawLimit = parsed.monthly_limit;
      const limit = rawLimit === null || rawLimit === undefined
        ? NaN
        : Number(rawLimit);

      try {
        // Delete semantics: null / <= 0 / non-numeric clears the cap.
        if (!Number.isFinite(limit) || limit <= 0) {
          const { error } = await sbAdmin
            .from("budgets")
            .delete()
            .eq("user_id", user.id)
            .eq("category", category);
          if (error) {
            if (isMissingRelationError(error)) return missingMigrationResponse("Budgets", "013_budgets.sql");
            throw new Error(error.message);
          }
          return { status: 200, body: { ok: true, deleted: true, category } };
        }

        const { error } = await sbAdmin
          .from("budgets")
          .upsert(
            {
              user_id:       user.id,
              category,
              monthly_limit: limit,
              currency:      "USD",
              updated_at:    new Date().toISOString(),
            },
            { onConflict: "user_id,category" },
          );
        if (error) {
          if (isMissingRelationError(error)) return missingMigrationResponse("Budgets", "013_budgets.sql");
          throw new Error(error.message);
        }
        return { status: 200, body: { ok: true, category, monthly_limit: limit } };
      } catch (err) {
        logError("budgets.write.failed", { err: err.message, category });
        return { status: 500, body: { error: err.message } };
      }
    }

    return { status: 405, body: { error: "Method not allowed" } };
  }

  // ── CSV export (GDPR / data portability) ────────────────
  // User-initiated CSV downloads. Throttled via the dedicated `export`
  // rate-limit bucket. Returns text/csv with Content-Disposition: attachment.
  if (pathname.startsWith("/api/export/")) {
    if (!sbAdmin) return { status: 503, body: { error: "Supabase not configured" } };
    const user = await verifyUser(h);
    if (!user) return { status: 401, body: { error: "Unauthenticated" } };

    const EXPORT_ROW_CAP = 5000;
    const csvHeaders = (filename) => ({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    });

    if (pathname === "/api/export/transactions.csv") {
      try {
        const { data: accts } = await sbAdmin
          .from("plaid_accounts")
          .select("account_id, name")
          .eq("user_id", user.id);
        const acctNameById = new Map();
        (accts || []).forEach((a) => { if (a?.account_id) acctNameById.set(a.account_id, a.name || ""); });

        const { data, error } = await sbAdmin
          .from("plaid_transactions")
          .select("date, account_id, merchant_name, name, amount, iso_currency_code, category_primary, category_detailed, pending, payment_channel, transaction_id")
          .eq("user_id", user.id)
          .order("date", { ascending: false })
          .limit(EXPORT_ROW_CAP);
        if (error) throw new Error(error.message);

        const cols = ["date", "account_id", "account_name", "merchant_name", "name", "amount", "iso_currency", "category_primary", "category_detailed", "pending", "payment_channel", "transaction_id"];
        const rows = (data || []).map((r) => ({
          date:              r.date || "",
          account_id:        r.account_id || "",
          account_name:      acctNameById.get(r.account_id) || "",
          merchant_name:     r.merchant_name || "",
          name:              r.name || "",
          amount:            r.amount,
          iso_currency:      r.iso_currency_code || "",
          category_primary:  r.category_primary || "",
          category_detailed: r.category_detailed || "",
          pending:           r.pending === true ? "true" : "false",
          payment_channel:   r.payment_channel || "",
          transaction_id:    r.transaction_id || "",
        }));
        const csv = toCsv(cols, rows);
        info("export.transactions.ok", { user: user.id, rows: rows.length });
        return { status: 200, body: csv, headers: csvHeaders("transactions.csv") };
      } catch (err) {
        logError("export.transactions.failed", { err: err.message });
        return { status: 500, body: { error: err.message } };
      }
    }

    if (pathname === "/api/export/holdings.csv") {
      const rows = [];

      // 1) Cached bank-side holdings from plaid_accounts. Plaid bank accounts
      // don't have ticker/units/cost — we still emit one row per account so
      // the export captures depository / credit / loan balances too. ticker,
      // units, price, market_value, average_cost are blank for these.
      try {
        const { data: plaidAccts } = await sbAdmin
          .from("plaid_accounts")
          .select("account_id, name, type, current_bal, institution_name, item_id")
          .eq("user_id", user.id)
          .limit(EXPORT_ROW_CAP);

        // institution_name lives on plaid_tokens, not plaid_accounts → join.
        const itemIds = Array.from(new Set((plaidAccts || []).map((a) => a.item_id).filter(Boolean)));
        const tokensByItemId = new Map();
        if (itemIds.length) {
          const { data: tokens } = await sbAdmin
            .from("plaid_tokens")
            .select("item_id, institution_name")
            .eq("user_id", user.id)
            .in("item_id", itemIds);
          (tokens || []).forEach((t) => { if (t?.item_id) tokensByItemId.set(t.item_id, t.institution_name || ""); });
        }

        (plaidAccts || []).forEach((a) => {
          if (rows.length >= EXPORT_ROW_CAP) return;
          const bal = Number(a.current_bal);
          rows.push({
            ticker:       "",
            name:         a.name || "",
            type:         a.type || "",
            units:        "",
            price:        "",
            market_value: Number.isFinite(bal) ? bal : "",
            average_cost: "",
            account_name: a.name || "",
            broker:       tokensByItemId.get(a.item_id) || "Plaid",
          });
        });
      } catch (plaidErr) {
        // Plaid cache failure shouldn't blank the whole export — keep going
        // and let the SnapTrade fan-out still populate brokerage positions.
        warn("export.holdings.plaid_cache_failed", { err: plaidErr.message });
      }

      // 2) Fresh SnapTrade positions. Calls /accounts then per-account
      // /positions. Same shape used in /api/snaptrade/all. Best-effort —
      // if SnapTrade is unreachable we still return the Plaid-only rows.
      try {
        const snap = await getSnapForRequest(h);
        const { userId, userSecret } = snap;
        const acctRes = await snapReq("GET", "/accounts", null, { userId, userSecret });
        const accounts = Array.isArray(acctRes.body) ? acctRes.body : [];

        const settled = await Promise.allSettled(accounts.map(async (acct) => {
          const posRes = await snapReq("GET", `/accounts/${acct.id}/positions`, null, { userId, userSecret });
          return { acct, positions: Array.isArray(posRes.body) ? posRes.body : [] };
        }));

        settled.forEach((res) => {
          if (res.status !== "fulfilled") return;
          const { acct, positions } = res.value;
          const accountName = acct.name || acct.number || acct.id || "";
          const broker = acct.brokerage?.name || acct.institution_name || "Unknown";
          positions.forEach((pos) => {
            if (rows.length >= EXPORT_ROW_CAP) return;
            // SnapTrade nests symbol metadata one or two levels deep.
            let sym = pos?.symbol;
            let depth = 0;
            while (sym && typeof sym === "object" && sym.symbol && typeof sym.symbol === "object" && depth < 3) { sym = sym.symbol; depth += 1; }
            const ticker = typeof sym === "string"
              ? sym
              : (sym?.symbol || sym?.raw_symbol || sym?.ticker || "");
            const name = (typeof sym === "object" && sym?.description) || pos?.symbol?.description || ticker;
            const tyRaw = typeof sym === "object" ? sym?.type : null;
            const type = typeof tyRaw === "string" ? tyRaw : (tyRaw?.code || tyRaw?.description || "");
            const units = Number(pos?.units);
            const price = Number(pos?.price);
            const averageCost = Number(pos?.average_purchase_price);
            const marketValue = Number.isFinite(units) && Number.isFinite(price) ? units * price : "";
            rows.push({
              ticker:       typeof ticker === "string" ? ticker : "",
              name:         typeof name === "string" ? name : "",
              type:         type || "",
              units:        Number.isFinite(units) ? units : "",
              price:        Number.isFinite(price) ? price : "",
              market_value: marketValue,
              average_cost: Number.isFinite(averageCost) ? averageCost : "",
              account_name: accountName,
              broker,
            });
          });
        });
      } catch (snapErr) {
        warn("export.holdings.snap_failed", { err: snapErr.message });
      }

      const cols = ["ticker", "name", "type", "units", "price", "market_value", "average_cost", "account_name", "broker"];
      const csv = toCsv(cols, rows);
      info("export.holdings.ok", { user: user.id, rows: rows.length });
      return { status: 200, body: csv, headers: csvHeaders("holdings.csv") };
    }

    if (pathname === "/api/export/activity.csv") {
      const rows = [];
      try {
        const snap = await getSnapForRequest(h);
        const { userId, userSecret } = snap;

        // Build an account-id → display-name lookup so we can stamp each
        // activity row with a human-readable account_name. Best effort.
        const acctRes = await snapReq("GET", "/accounts", null, { userId, userSecret });
        const accounts = Array.isArray(acctRes.body) ? acctRes.body : [];
        const acctNameById = new Map();
        accounts.forEach((a) => { if (a?.id) acctNameById.set(a.id, a.name || a.number || a.id || ""); });

        // Five-year window, matches /api/snaptrade/activities default.
        const today = new Date();
        const fiveYearsAgo = new Date(today); fiveYearsAgo.setFullYear(today.getFullYear() - 5);
        const startDate = fiveYearsAgo.toISOString().slice(0, 10);
        const endDate   = today.toISOString().slice(0, 10);
        const r = await snapReq("GET", "/activities", null, { userId, userSecret, startDate, endDate });
        const arr = Array.isArray(r.body) ? r.body : (r.body?.activities || []);

        arr.forEach((a) => {
          if (rows.length >= EXPORT_ROW_CAP) return;
          // Symbol on activities can be a string or an object (mirrors positions).
          let sym = a?.symbol;
          let depth = 0;
          while (sym && typeof sym === "object" && sym.symbol && typeof sym.symbol === "object" && depth < 3) { sym = sym.symbol; depth += 1; }
          const ticker = typeof sym === "string"
            ? sym
            : (sym?.symbol || sym?.raw_symbol || sym?.ticker || "");
          const units = Number(a?.units);
          const price = Number(a?.price);
          const amount = Number(a?.amount);
          const acctId = a?.account?.id;
          rows.push({
            trade_date:   a?.trade_date || a?.settlement_date || "",
            type:         (a?.type || "").toString().toUpperCase(),
            ticker:       typeof ticker === "string" ? ticker : "",
            units:        Number.isFinite(units) ? units : "",
            price:        Number.isFinite(price) ? price : "",
            amount:       Number.isFinite(amount) ? amount : "",
            currency:     a?.currency?.code || a?.currency || "",
            account_name: acctNameById.get(acctId) || a?.institution_name || "",
          });
        });
      } catch (snapErr) {
        warn("export.activity.snap_failed", { err: snapErr.message });
      }

      const cols = ["trade_date", "type", "ticker", "units", "price", "amount", "currency", "account_name"];
      const csv = toCsv(cols, rows);
      info("export.activity.ok", { user: user.id, rows: rows.length });
      return { status: 200, body: csv, headers: csvHeaders("activity.csv") };
    }

    return { status: 404, body: { error: "Unknown export endpoint" } };
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
      { file: "010_plaid_transactions.sql", tables: ["plaid_transactions"] },
      { file: "012_account_nicknames.sql",  tables: ["account_nicknames"] },
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

    // ── Plaid transactions sync ──────────────────────────────
    // Walks every linked Plaid Item and pulls /transactions/sync diffs
    // using the stored cursor. Best-effort: a single failing Item does
    // not abort the loop, and the cron response always 200s so Vercel
    // doesn't mark the schedule unhealthy when Plaid has a transient
    // outage on one user's bank.
    let plaidItems = 0, plaidOk = 0, plaidFailed = 0;
    let plaidAdded = 0, plaidModified = 0, plaidRemoved = 0;
    if (plaidClient) {
      try {
        const { data: pTokens, error: pErr } = await sbAdmin
          .from("plaid_tokens")
          .select("user_id, access_token, item_id, institution_name, transactions_cursor");
        if (pErr) throw new Error(`plaid_tokens select: ${pErr.message}`);
        plaidItems = (pTokens || []).length;
        for (const t of (pTokens || [])) {
          try {
            const r = await syncPlaidItem(sbAdmin, plaidClient, t);
            plaidAdded    += r.added;
            plaidModified += r.modified;
            plaidRemoved  += r.removed;
            plaidOk += 1;
          } catch (e) {
            plaidFailed += 1;
            warn("cron.sync.plaid.item_failed", { item_id: t.item_id, err: e.message });
          }
        }
        info("cron.sync.plaid.ok", { items: plaidItems, ok: plaidOk, failed: plaidFailed, added: plaidAdded, modified: plaidModified, removed: plaidRemoved });
      } catch (e) {
        warn("cron.sync.plaid.failed", { err: e.message });
      }
    }

    return {
      status: 200,
      body: {
        ok: true,
        synced, failed, refreshed, refreshFailed,
        total: (users || []).length,
        plaid: {
          items: plaidItems,
          ok: plaidOk,
          failed: plaidFailed,
          added: plaidAdded,
          modified: plaidModified,
          removed: plaidRemoved,
        },
      },
    };
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

  // ── Bill reminders cron ─────────────────────────────────
  // Walks every Plaid-linked user, looks back 90 days of transactions,
  // and for each "recurring" merchant (2+ distinct months) fires a web
  // push notification three days before the expected next charge. Median
  // gap between charges drives the projection. Idempotency is enforced
  // via audit_log: a row {action: "bill.reminder_sent", user_id, target,
  // metadata.expected_date} is inserted BEFORE the push fans out, so a
  // retry of the cron on the same calendar day cannot double-fire.
  //
  // Schedule (vercel.json): 14:00 UTC daily.
  if (pathname === "/api/cron/bill-reminders") {
    if (CRON_SECRET) {
      const authHeader = h.authorization || h.Authorization || "";
      if (authHeader !== `Bearer ${CRON_SECRET}`) {
        return { status: 401, body: { error: "Unauthorized" } };
      }
    }
    if (!sbAdmin) return { status: 200, body: { ok: true, skipped: "no-supabase", sent: 0 } };

    const todayMs       = Date.now();
    const ninetyDaysAgo = new Date(todayMs - 90 * 86_400_000).toISOString().slice(0, 10);
    // Target = today + 3 days, in UTC. Plaid transaction dates are
    // calendar dates without zones, so comparing on the YYYY-MM-DD
    // prefix is the safest equality check.
    const targetIso = new Date(todayMs + 3 * 86_400_000).toISOString().slice(0, 10);

    let sent = 0, skipped = 0, failed = 0;
    let lastErr = null;
    try {
      // Distinct list of user_ids who have a Plaid item linked.
      const { data: tokens, error: tErr } = await sbAdmin
        .from("plaid_tokens")
        .select("user_id");
      if (tErr) throw new Error(`plaid_tokens select: ${tErr.message}`);
      const userIds = [...new Set((tokens || []).map(t => t.user_id).filter(Boolean))];

      for (const userId of userIds) {
        try {
          // Pull last 90 days of transactions for this user.
          const { data: rows, error: rErr } = await sbAdmin
            .from("plaid_transactions")
            .select("merchant_name, name, amount, date")
            .eq("user_id", userId)
            .gte("date", ninetyDaysAgo);
          if (rErr) {
            warn("cron.bill_reminders.tx_select_failed", { userId, err: rErr.message });
            failed += 1;
            continue;
          }

          // Group by merchant — same rule as the frontend (2+ distinct
          // months, positive outflows only).
          const byMerchant = new Map();
          for (const t of (rows || [])) {
            const key = (t.merchant_name || t.name || "").trim();
            if (!key) continue;
            const amt = Number(t.amount);
            if (!Number.isFinite(amt) || amt <= 0) continue;
            const month = (t.date || "").slice(0, 7);
            if (!month) continue;
            let entry = byMerchant.get(key);
            if (!entry) {
              entry = { merchant: key, dates: [], amounts: [], months: new Set() };
              byMerchant.set(key, entry);
            }
            entry.dates.push(t.date);
            entry.amounts.push(amt);
            entry.months.add(month);
          }

          for (const entry of byMerchant.values()) {
            if (entry.months.size < 2) { skipped += 1; continue; }

            // Sort dates ascending, compute integer gaps in days, take median.
            const sortedDates = [...entry.dates].sort();
            const gaps = [];
            for (let i = 1; i < sortedDates.length; i += 1) {
              const a = new Date(`${sortedDates[i - 1]}T00:00:00Z`).getTime();
              const b = new Date(`${sortedDates[i]}T00:00:00Z`).getTime();
              const d = Math.round((b - a) / 86_400_000);
              if (d > 0) gaps.push(d);
            }
            if (gaps.length === 0) { skipped += 1; continue; }
            gaps.sort((a, b) => a - b);
            const mid       = Math.floor(gaps.length / 2);
            const medianGap = gaps.length % 2 === 0 ? (gaps[mid - 1] + gaps[mid]) / 2 : gaps[mid];
            if (!Number.isFinite(medianGap) || medianGap <= 0) { skipped += 1; continue; }

            const lastIso = sortedDates[sortedDates.length - 1];
            const lastMs  = new Date(`${lastIso}T00:00:00Z`).getTime();
            // Roll forward in median-gap steps until we land on or past today.
            let nextMs = lastMs + medianGap * 86_400_000;
            while (nextMs < todayMs) nextMs += medianGap * 86_400_000;
            const expectedIso = new Date(nextMs).toISOString().slice(0, 10);
            if (expectedIso !== targetIso) { skipped += 1; continue; }

            // Idempotency check: have we already sent this exact reminder?
            const { data: existing, error: dupErr } = await sbAdmin
              .from("audit_log")
              .select("id")
              .eq("user_id", userId)
              .eq("action",  "bill.reminder_sent")
              .eq("target",  entry.merchant)
              .contains("metadata", { expected_date: expectedIso })
              .limit(1);
            if (dupErr) {
              warn("cron.bill_reminders.dup_check_failed", { userId, target: entry.merchant, err: dupErr.message });
              failed += 1;
              continue;
            }
            if (existing && existing.length > 0) { skipped += 1; continue; }

            const estAmount = entry.amounts.reduce((s, n) => s + n, 0) / entry.amounts.length;

            // Insert audit row BEFORE sending so a crash mid-fanout can't
            // re-fire the push on retry.
            const { error: insErr } = await sbAdmin.from("audit_log").insert({
              user_id:  userId,
              action:   "bill.reminder_sent",
              target:   entry.merchant,
              metadata: {
                expected_date: expectedIso,
                est_amount:    Number(estAmount.toFixed(2)),
                median_gap:    medianGap,
              },
            });
            if (insErr) {
              warn("cron.bill_reminders.audit_insert_failed", { userId, target: entry.merchant, err: insErr.message });
              failed += 1;
              continue;
            }

            try {
              const title = "Upcoming bill in 3 days";
              const body  = `${entry.merchant} · ~$${estAmount.toFixed(2)} on ${expectedIso}`;
              const r = await sendPushToUser(sbAdmin, userId, { title, body, url: "/" });
              if (r?.ok) sent += 1; else failed += 1;
            } catch (pushErr) {
              failed += 1;
              warn("cron.bill_reminders.push_failed", { userId, target: entry.merchant, err: pushErr.message });
            }
          }
        } catch (uErr) {
          failed += 1;
          warn("cron.bill_reminders.user_failed", { userId, err: uErr.message });
        }
      }

      info("cron.bill_reminders.ok", { sent, skipped, failed, users: userIds.length, target_date: targetIso });
    } catch (e) {
      lastErr = e.message;
      logError("cron.bill_reminders.failed", { err: e.message });
    } finally {
      sbAdmin.from("cron_jobs").upsert({
        job_name:    "bill_reminders",
        last_run_at: new Date().toISOString(),
        last_status: lastErr ? "error" : "ok",
        last_error:  lastErr,
        run_count:   1,
      }, { onConflict: "job_name" })
        .then(({ error }) => { if (error) warn("cron.upsert_failed", { err: error.message }); });
    }
    return { status: 200, body: { ok: !lastErr, sent, skipped, failed } };
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

  // ── Goals ─────────────────────────────────────────────
  // Savings goals tied to specific accounts or to net-worth. Per-user
  // scoped via Supabase RLS plus an explicit `.eq("user_id", user.id)`
  // belt-and-braces on writes.
  //
  //   GET    /api/goals         → { goals: [...] }
  //   POST   /api/goals         → { id, ... }
  //   PUT    /api/goals/:id     → { id, ... }
  //   DELETE /api/goals/:id     → { ok: true }
  if (pathname === "/api/goals" && method === "GET") {
    const user = await verifyUser(h);
    if (!user) return { status: 401, body: { error: "Unauthenticated" } };
    if (!sbAdmin) return { status: 503, body: { error: "Supabase not configured" } };
    const { data, error: dbErr } = await sbAdmin
      .from("goals").select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });
    if (dbErr) {
      if (isMissingRelationError(dbErr)) {
        info("goals.list.migration_pending");
        return missingMigrationResponse("Goals", "014_goals.sql");
      }
      logError("goals.list_failed", { err: dbErr.message });
      return { status: 500, body: { error: dbErr.message } };
    }
    return { status: 200, body: { goals: data || [] } };
  }

  if (pathname === "/api/goals" && method === "POST") {
    const user = await verifyUser(h);
    if (!user) return { status: 401, body: { error: "Unauthenticated" } };
    if (!sbAdmin) return { status: 503, body: { error: "Supabase not configured" } };
    const name = String(parsed?.name || "").trim();
    const target_amount = Number(parsed?.target_amount);
    if (!name) return { status: 400, body: { error: "name required" } };
    if (!Number.isFinite(target_amount) || target_amount <= 0) {
      return { status: 400, body: { error: "target_amount must be a positive number" } };
    }
    const track_mode = ["account", "networth", "manual"].includes(parsed?.track_mode)
      ? parsed.track_mode : "account";
    const account_ids = Array.isArray(parsed?.account_ids)
      ? parsed.account_ids.map(String).filter(Boolean)
      : [];
    const target_date = parsed?.target_date ? String(parsed.target_date).slice(0, 10) : null;
    const manual_progress = Number.isFinite(Number(parsed?.manual_progress))
      ? Number(parsed.manual_progress) : 0;
    const currency = String(parsed?.currency || "USD").slice(0, 8);

    const row = {
      user_id: user.id,
      name, target_amount, target_date,
      account_ids, track_mode, manual_progress, currency,
    };
    const { data, error: dbErr } = await sbAdmin
      .from("goals").insert(row).select("*").single();
    if (dbErr) {
      if (isMissingRelationError(dbErr)) return missingMigrationResponse("Goals", "014_goals.sql");
      logError("goals.insert_failed", { err: dbErr.message });
      return { status: 500, body: { error: dbErr.message } };
    }
    audit({ userId: user.id, action: "goal.created", target: String(data.id), headers: h });
    info("goals.create.ok", { id: data.id });
    return { status: 200, body: data };
  }

  const goalIdMatch = pathname.match(/^\/api\/goals\/([^/]+)$/);
  if (goalIdMatch && (method === "PUT" || method === "DELETE")) {
    const user = await verifyUser(h);
    if (!user) return { status: 401, body: { error: "Unauthenticated" } };
    if (!sbAdmin) return { status: 503, body: { error: "Supabase not configured" } };
    const goalId = Number(goalIdMatch[1]);
    if (!Number.isFinite(goalId)) {
      return { status: 400, body: { error: "Invalid goal id" } };
    }

    if (method === "DELETE") {
      const { error: dbErr } = await sbAdmin
        .from("goals").delete()
        .eq("id", goalId).eq("user_id", user.id);
      if (dbErr) {
        if (isMissingRelationError(dbErr)) return missingMigrationResponse("Goals", "014_goals.sql");
        logError("goals.delete_failed", { err: dbErr.message });
        return { status: 500, body: { error: dbErr.message } };
      }
      audit({ userId: user.id, action: "goal.deleted", target: String(goalId), headers: h });
      return { status: 200, body: { ok: true } };
    }

    // PUT — partial update. Whitelist fields the client may write.
    const updates = { updated_at: new Date().toISOString() };
    if (typeof parsed?.name === "string" && parsed.name.trim()) {
      updates.name = parsed.name.trim();
    }
    if (parsed?.target_amount != null) {
      const n = Number(parsed.target_amount);
      if (!Number.isFinite(n) || n <= 0) {
        return { status: 400, body: { error: "target_amount must be a positive number" } };
      }
      updates.target_amount = n;
    }
    if (parsed?.target_date !== undefined) {
      updates.target_date = parsed.target_date
        ? String(parsed.target_date).slice(0, 10) : null;
    }
    if (Array.isArray(parsed?.account_ids)) {
      updates.account_ids = parsed.account_ids.map(String).filter(Boolean);
    }
    if (typeof parsed?.track_mode === "string"
        && ["account", "networth", "manual"].includes(parsed.track_mode)) {
      updates.track_mode = parsed.track_mode;
    }
    if (parsed?.manual_progress != null) {
      const n = Number(parsed.manual_progress);
      if (Number.isFinite(n)) updates.manual_progress = n;
    }
    if (typeof parsed?.currency === "string") {
      updates.currency = parsed.currency.slice(0, 8);
    }

    const { data, error: dbErr } = await sbAdmin
      .from("goals").update(updates)
      .eq("id", goalId).eq("user_id", user.id)
      .select("*").single();
    if (dbErr) {
      if (isMissingRelationError(dbErr)) return missingMigrationResponse("Goals", "014_goals.sql");
      // PostgREST "no rows" comes back as PGRST116 — surface 404.
      if (dbErr.code === "PGRST116") return { status: 404, body: { error: "Goal not found" } };
      logError("goals.update_failed", { err: dbErr.message });
      return { status: 500, body: { error: dbErr.message } };
    }
    audit({ userId: user.id, action: "goal.updated", target: String(goalId), headers: h });
    return { status: 200, body: data };
  }

  return { status: 404, body: { error: "Not found" } };
}
