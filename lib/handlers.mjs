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
import { info, warn, error as logError, setLogContext, withRequestContext, newRequestId } from "./logger.mjs";
import { encrypt as encryptSecret, decrypt as decryptSecret } from "./crypto.mjs";
import { checkRateLimit, matchAction, RATE_LIMITS } from "./rateLimit.mjs";
import { isIpBlocked, trackAuthFailure, trackSnapTradeError, checkCronStaleness, checkNewDevice } from "./anomaly.mjs";
import { fetchWithRetry } from "./fetchWithRetry.mjs";
import { sendUserEmail } from "./alerts.mjs";
import { sendPushToUser } from "./notify.mjs";
import { Sentry } from "./sentry.mjs";
import { screenSymbol, screenBatch, activeShariaProvider } from "./sharia.mjs";

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

// Default halal screening universe for bot strategies that don't name their own
// candidates. These are themselves Sharia-screened funds (SPUS/HLAL/UMMA are
// AAOIFI-compliant ETFs) plus a small set of commonly-compliant large caps.
// Every candidate is still re-checked against HARAM_TICKERS before any signal.
// A strategy may override this via params.universe_tickers (an explicit array).
const HALAL_UNIVERSE_DEFAULT = [
  "SPUS", "HLAL", "UMMA", "SPSK", "SPWO",          // halal-screened ETFs
  "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN",          // typically-compliant large caps
  "AVGO", "ADBE", "CRM", "AMD", "QCOM",
];

// Resolve a strategy's screening candidates: its explicit universe_tickers when
// present, else the default halal set. Always filtered through the Sharia gate,
// deduped, and uppercased. Returns a non-empty array (falls back to the
// strategy's own ticker if everything got filtered out).
function strategyUniverse(strat) {
  const raw = Array.isArray(strat?.params?.universe_tickers) ? strat.params.universe_tickers : [];
  const fromStrat = raw.length ? raw : HALAL_UNIVERSE_DEFAULT;
  const cleaned = [...new Set(fromStrat.map(t => String(t || "").toUpperCase().trim()).filter(Boolean))]
    .filter(t => !HARAM_TICKERS.has(t));
  if (cleaned.length) return cleaned;
  const fallback = String(strat?.ticker || "").toUpperCase().trim();
  return fallback && !HARAM_TICKERS.has(fallback) ? [fallback] : [];
}

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
const CRON_SECRET   = (process.env.CRON_SECRET || process.env.CRON_SECRET_PRODUCTION || "").trim();
const ENC_ENABLED   = Boolean((process.env.ENCRYPTION_KEY || "").trim());

// Cron auth — FAIL CLOSED. Returns true when the request is NOT an authorized
// Vercel cron call: a missing/mismatched bearer, OR no CRON_SECRET configured
// at all. The "no secret" case is the important one — if the env var is ever
// unset, every /api/cron/* must reject rather than run unauthenticated.
function cronUnauthorized(headers) {
  const authHeader = (headers && (headers.authorization || headers.Authorization)) || "";
  return !CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`;
}

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
function httpsGetJson(urlStr, headers) {
  return new Promise((resolve, reject) => {
    const opts = headers ? { headers } : {};
    https.get(urlStr, opts, res => {
      let data = "";
      res.on("data", chunk => (data += chunk));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    }).on("error", reject);
  });
}

// Free price fallback via Alpaca's market-data API (IEX feed, included with the
// paper account the app already holds keys for). Used when Finnhub has no key,
// is rate-limited, or returns no price for a symbol (e.g. a freshly-added
// watchlist ticker). One batched request for all symbols; prevDailyBar gives an
// accurate previous close for the change %. Returns the client quote shape
// ({ tk, price, chg, pct, hi, lo, src }).
async function fetchAlpacaQuotes(symbols) {
  if (!ALPACA_KEY_ID || !ALPACA_SECRET || !symbols.length) return [];
  const url = `https://data.alpaca.markets/v2/stocks/snapshots?feed=iex&symbols=${encodeURIComponent(symbols.join(","))}`;
  const r = await httpsGetJson(url, {
    "APCA-API-KEY-ID":     ALPACA_KEY_ID,
    "APCA-API-SECRET-KEY": ALPACA_SECRET,
  });
  const snaps = r.body && typeof r.body === "object" ? r.body : {};
  const out = [];
  for (const sym of symbols) {
    const s = snaps[sym];
    if (!s) continue;
    const price = s.latestTrade?.p ?? s.dailyBar?.c;
    const prev = s.prevDailyBar?.c;
    if (price == null || price === 0) continue;
    const chg = prev != null ? price - prev : null;
    const pct = prev ? ((price - prev) / prev) * 100 : null;
    out.push({
      tk: sym,
      price,
      chg,
      pct,
      hi: s.dailyBar?.h ?? null,
      lo: s.dailyBar?.l ?? null,
      src: "Alpaca",
    });
  }
  return out;
}

// Last-resort key-less fallback via Yahoo Finance's chart endpoint. Yahoo rate-
// limits aggressively (429) so this is only tried when both Finnhub and Alpaca
// come up empty; it returns [] on any failure and never blocks the response.
const YAHOO_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
async function fetchYahooQuotes(symbols) {
  const settled = await Promise.allSettled(symbols.map(async sym => {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1d`;
    const r = await httpsGetJson(url, { "User-Agent": YAHOO_UA });
    const meta = r.body?.chart?.result?.[0]?.meta;
    if (!meta) return null;
    const price = meta.regularMarketPrice;
    const prev = meta.chartPreviousClose ?? meta.previousClose;
    if (price == null || price === 0) return null;
    const chg = prev != null ? price - prev : null;
    const pct = prev ? ((price - prev) / prev) * 100 : null;
    return {
      tk: sym,
      price,
      chg,
      pct,
      hi: meta.regularMarketDayHigh ?? null,
      lo: meta.regularMarketDayLow ?? null,
      src: "Yahoo",
    };
  }));
  return settled.filter(r => r.status === "fulfilled" && r.value).map(r => r.value);
}

// ── Secret encryption helpers ──────────────────────────────────────────────
// Extract and decrypt snaptrade_user_secret from a DB row.
// Tries ciphertext columns first; falls back to plaintext for un-migrated rows.
function extractUserSecret(row) {
  if (row.secret_ciphertext && row.secret_iv && row.secret_auth_tag) {
    return decryptSecret({
      ciphertext: row.secret_ciphertext,
      iv:         row.secret_iv,
      authTag:    row.secret_auth_tag,
    });
  }
  return row.snaptrade_user_secret || null;
}

// Build the upsert fields for writing a SnapTrade user secret.
// When ENC_ENABLED: stores ciphertext + nulls out plaintext.
// When not enabled: stores plaintext as before (backward compat).
function encryptedSecretFields(plaintext) {
  if (ENC_ENABLED) {
    const enc = encryptSecret(plaintext);
    return {
      snaptrade_user_secret: null,
      secret_ciphertext:     enc.ciphertext,
      secret_iv:             enc.iv,
      secret_auth_tag:       enc.authTag,
    };
  }
  return { snaptrade_user_secret: plaintext };
}

// SELECT columns that carry the SnapTrade secret (both plaintext fallback
// and the encrypted columns so extractUserSecret() works for both states).
const SNAP_SECRET_COLS =
  "snaptrade_user_id, snaptrade_user_secret, secret_ciphertext, secret_iv, secret_auth_tag";

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

// ── Plaid webhook verification ───────────────────────────────────────────────
// Plaid signs every webhook with a JWS (ES256) in the Plaid-Verification header.
// We verify it without a JWT dependency: fetch the EC P-256 public key by `kid`
// via the Plaid API (cached), verify the signature with Node crypto, and require
// a fresh `iat`. When the raw request body is available we additionally bind the
// token to the body via the `request_body_sha256` claim. On Vercel the body is
// pre-parsed so the hash bind is best-effort; the signature + freshness checks
// alone already reject any forged or stale webhook. Returns true only for a
// valid, fresh, Plaid-signed token. Never throws.
const _plaidJwkCache = new Map(); // kid -> jwk
const PLAID_WEBHOOK_MAX_AGE_S = 5 * 60;
function _b64urlJson(seg) {
  const pad = seg.length % 4 ? "=".repeat(4 - (seg.length % 4)) : "";
  return JSON.parse(Buffer.from(seg.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64").toString("utf8"));
}
async function verifyPlaidWebhook(headers, rawBody) {
  try {
    if (!plaidClient) return false;
    const jws = headers["plaid-verification"] || headers["Plaid-Verification"] || "";
    const parts = jws.split(".");
    if (parts.length !== 3) return false;
    const header = _b64urlJson(parts[0]);
    if (header.alg !== "ES256" || !header.kid) return false;

    // Resolve + cache the signing key (EC P-256) for this kid.
    let jwk = _plaidJwkCache.get(header.kid);
    if (!jwk) {
      const r = await plaidClient.webhookVerificationKeyGet({ key_id: header.kid });
      const k = r?.data?.key;
      if (!k || k.kty !== "EC" || k.crv !== "P-256") return false;
      jwk = { kty: "EC", crv: "P-256", x: k.x, y: k.y };
      _plaidJwkCache.set(header.kid, jwk);
    }

    // Verify the ES256 signature over `${header}.${payload}` (raw R||S form).
    const pubKey = crypto.createPublicKey({ key: jwk, format: "jwk" });
    const signingInput = Buffer.from(`${parts[0]}.${parts[1]}`);
    const sigPad = (4 - (parts[2].length % 4)) % 4;
    const sig = Buffer.from(parts[2].replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(sigPad), "base64");
    const ok = crypto.verify("sha256", signingInput, { key: pubKey, dsaEncoding: "ieee-p1363" }, sig);
    if (!ok) return false;

    const payload = _b64urlJson(parts[1]);
    // Freshness: reject tokens older than 5 minutes (replay window).
    const now = Math.floor(Date.now() / 1000);
    if (!payload.iat || (now - Number(payload.iat)) > PLAID_WEBHOOK_MAX_AGE_S) return false;

    // Body binding when raw bytes are available (best-effort on Vercel).
    if (rawBody && payload.request_body_sha256) {
      const digest = crypto.createHash("sha256").update(rawBody, "utf8").digest("hex");
      if (digest !== payload.request_body_sha256) return false;
    }
    return true;
  } catch (e) {
    warn("plaid.webhook.verify_failed", { err: e?.message });
    return false;
  }
}

// Resolve {userId, userSecret} for the current request.
// Authenticated (Supabase JWT in header) path only — Supabase is required.
// The legacy .snaptrade-users.json flat-file path has been removed; if the
// owner has not yet signed in to claim the mizan_primary record, they must
// do so using the existing user_snaptrade row or re-register.
async function getSnapForRequest(headers) {
  const user = await verifyUser(headers);
  if (user && sbAdmin) {
    const stUserId = `mizan_${user.id}`;
    const { data: row, error: selErr } = await sbAdmin
      .from("user_snaptrade")
      .select(SNAP_SECRET_COLS)
      .eq("user_id", user.id)
      .maybeSingle();
    const existingSecret = row ? extractUserSecret(row) : null;
    if (!selErr && existingSecret) {
      return { userId: row.snaptrade_user_id || stUserId, userSecret: existingSecret, supabaseUser: user };
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
        ...encryptedSecretFields(userSecret),
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
  if (!sbAdmin) {
    const err = new Error("Supabase is not configured — MĪZAN requires Supabase.");
    err.status = 503;
    throw err;
  }
  const err = new Error("UNAUTHENTICATED");
  err.status = 401;
  throw err;
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
      || pathname === "/api/cron/bill-reminders"
      || pathname === "/api/cron/bot-signals") return null;
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

// ── Trading Bot access gates ──────────────────────────────────────────────────
// Server-enforced: every trade/bot endpoint must call canUseTradingBot()
// before processing. A modified client that omits the client-side gate
// still gets 403 here.
async function canUseTradingBot(user) {
  if (await isRootUser(user)) return true;
  // Beta allowlist: a non-root user explicitly granted trading_bot_enabled gets
  // Trade access (Manual/Semi only — full-auto stays root-gated below).
  if (!user || !sbAdmin) return false;
  const { data } = await sbAdmin.from("profiles").select("trading_bot_enabled").eq("id", user.id).maybeSingle();
  return !!data?.trading_bot_enabled;
}

// First-use consent for the bot's experimental / "Mizan is not an RIA" risk
// disclosure. Root is implicitly consented (owner's own money, own terms);
// every other (beta) user must accept before creating a strategy or executing
// a trade. Enforced on strategy-create, signal-approve, and manual order place.
async function botConsentOk(user) {
  if (await isRootUser(user)) return true;
  if (!user || !sbAdmin) return false;
  const { data } = await sbAdmin.from("profiles").select("trading_bot_consent_at").eq("id", user.id).maybeSingle();
  return !!data?.trading_bot_consent_at;
}

// Full-auto requires root AND explicit per-profile opt-in.
// COMPLIANCE: enabling full-auto for non-owner accounts likely requires RIA
// registration. Do not change without legal review.
async function canUseFullAuto(user) {
  if (!user || !sbAdmin) return false;
  if (!(await isRootUser(user))) return false;
  const { data } = await sbAdmin.from("profiles").select("full_auto_enabled").eq("id", user.id).maybeSingle();
  return !!data?.full_auto_enabled;
}

// Per-account full-auto opt-in (Layer 3). True only if the owner explicitly
// enabled autonomous execution for THIS connected account (default false).
// This is checked IN ADDITION to the profile master switch (canUseFullAuto).
async function accountFullAutoEnabled(userId, accountId) {
  if (!userId || !accountId || !sbAdmin) return false;
  const { data } = await sbAdmin.from("account_full_auto")
    .select("enabled").eq("user_id", userId).eq("account_id", accountId).maybeSingle();
  return !!data?.enabled;
}

// ── Broker execution (shared) ────────────────────────────
// Single execution path used by BOTH the manual Alpaca endpoint and the
// trading bot (signal approval + full-auto cron). Alpaca PAPER only —
// ALPACA_BASE points at paper-api, so no real money is ever at risk here.
// The Sharia gate is applied unconditionally; a haram ticker can never be
// routed to the broker. Returns a normalized result object.
//
// NOTE: live-money execution (SnapTrade) is intentionally NOT wired into
// the bot. That path needs ticker→universal_symbol_id resolution and live
// brokerage testing, and full-auto on non-owner accounts is RIA-sensitive
// (see canUseFullAuto). Keep autonomous execution on paper until that work
// and the necessary legal review are done.
async function placeAlpacaOrder({ symbol, qty, side, type = "market", limitPrice = null }) {
  if (!ALPACA_KEY_ID || !ALPACA_SECRET) return { ok: false, status: 503, error: "Alpaca not configured" };
  const symbolUp = String(symbol || "").toUpperCase();
  if (!symbolUp || !qty) return { ok: false, status: 400, error: "symbol and qty required" };
  if (side !== "buy" && side !== "sell") return { ok: false, status: 400, error: "side must be 'buy' or 'sell'" };
  if (!["market", "limit", "stop", "stop_limit"].includes(type)) return { ok: false, status: 400, error: "invalid order type" };
  // Sharia gate — non-negotiable, server-side.
  if (HARAM_TICKERS.has(symbolUp)) return { ok: false, status: 403, sharia_blocked: true, error: `${symbolUp} is on the Sharia precheck blocklist` };

  const orderBody = { symbol: symbolUp, qty: String(qty), side, type, time_in_force: "day" };
  if (type === "limit" || type === "stop_limit") {
    if (!limitPrice) return { ok: false, status: 400, error: "limitPrice required for limit orders" };
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
    return { ok: false, status: 502, error: "Alpaca request failed" };
  }
  const json = await res.json().catch(() => ({}));
  if (res.status >= 200 && res.status < 300) {
    return { ok: true, status: res.status, json, orderId: json?.id || null };
  }
  return { ok: false, status: res.status, json, error: (json && (json.message || JSON.stringify(json))) || `alpaca ${res.status}` };
}

// ── SnapTrade live execution (owner-gated bot + manual ticket) ───────────
// Reads a user's stored SnapTrade credentials WITHOUT the registration
// side-effects of getSnapForRequest — needed by server-initiated flows
// (the bot cron and signal approval) that have no live request to verify.
async function getSnapCredsForUser(userId) {
  if (!userId || !sbAdmin) return null;
  const { data: row, error } = await sbAdmin
    .from("user_snaptrade")
    .select(SNAP_SECRET_COLS)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !row) return null;
  const userSecret = extractUserSecret(row);
  if (!userSecret) return null;
  return { userId: row.snaptrade_user_id || `mizan_${userId}`, userSecret };
}

// /trade/impact wants a universal_symbol_id (a UUID), NOT a ticker. Resolve
// a plain ticker for a specific account via SnapTrade's account symbol search.
async function resolveUniversalSymbolId({ userId, userSecret, accountId, ticker }) {
  const t = String(ticker || "").toUpperCase();
  if (!t) return null;
  // Already a universal_symbol_id (UUID)? Pass it through.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) return t;
  const r = await snapReq("POST", `/accounts/${accountId}/symbols`, { substring: t }, { userId, userSecret });
  if (r.status < 200 || r.status >= 300 || !Array.isArray(r.body)) {
    warn("snaptrade.symbol_search.failed", { status: r.status, ticker: t });
    return null;
  }
  const norm = s => String(s || "").toUpperCase();
  const match = r.body.find(u =>
    norm(u.symbol) === t || norm(u.raw_symbol) === t || norm(u.symbol?.raw_symbol) === t
  ) || r.body[0];
  return match?.id || null;
}

// Execute a REAL order through SnapTrade (impact → place). Callers must be
// owner-gated (canUseTradingBot). The Sharia gate is re-applied here so a
// haram ticker can never reach the broker, regardless of caller. Money never
// flows through MĪZAN — this only instructs the connected brokerage.
async function executeSnapTradeOrder({ userId, userSecret, accountId, ticker, side, qty, orderType = "Market" }) {
  const t = String(ticker || "").toUpperCase();
  if (HARAM_TICKERS.has(t)) return { ok: false, status: 403, sharia_blocked: true, error: `${t} is on the Sharia blocklist` };
  if (!userId || !userSecret) return { ok: false, status: 400, error: "broker_not_connected" };
  if (!accountId) return { ok: false, status: 400, error: "no_account" };
  if (!(side === "buy" || side === "sell")) return { ok: false, status: 400, error: "invalid_side" };
  if (!(qty > 0)) return { ok: false, status: 400, error: "invalid_qty" };

  const symbolId = await resolveUniversalSymbolId({ userId, userSecret, accountId, ticker: t });
  if (!symbolId) return { ok: false, status: 422, error: `could not resolve symbol ${t} for account` };

  const impactBody = {
    account_id:          accountId,
    action:              side === "buy" ? "BUY" : "SELL",
    universal_symbol_id: symbolId,
    order_type:          orderType,
    time_in_force:       "Day",
    units:               qty,
    price:               null,
    stop:                null,
  };
  const imp = await snapReq("POST", "/trade/impact", impactBody, { userId, userSecret });
  if (imp.status < 200 || imp.status >= 300) {
    return { ok: false, status: imp.status, error: `impact ${imp.status}: ${JSON.stringify(imp.body)}` };
  }
  const tradeId = imp.body?.trade?.id || imp.body?.id;
  if (!tradeId) return { ok: false, status: 502, error: "no_trade_id_from_impact" };

  const placed = await snapReq("POST", `/trade/${tradeId}`, null, { userId, userSecret });
  if (placed.status < 200 || placed.status >= 300) {
    return { ok: false, status: placed.status, error: `place ${placed.status}: ${JSON.stringify(placed.body)}` };
  }
  return { ok: true, status: 200, tradeId, orderId: tradeId, placed: placed.body };
}

// ── Trading-bot runtime helpers ──────────────────────────────────────────
// Live last price for a ticker via Finnhub. Returns null on any failure —
// callers must treat a null quote as "skip", never throw.
async function finnhubQuote(ticker) {
  const t = String(ticker || "").toUpperCase();
  if (!t || !FINNHUB_KEY) return null;
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(t)}&token=${FINNHUB_KEY}`;
  const q = await fetch(url).then(r => r.ok ? r.json() : null).catch(() => null);
  if (!q || !Number.isFinite(Number(q.c)) || Number(q.c) <= 0) return null;
  return { current: Number(q.c), prevClose: Number(q.pc) || null };
}

// Reconstruct the strategy's net open position from its EXECUTED signals.
// SnapTrade doesn't give lot-level basis here, so this is an explicit, pragmatic
// approximation: net qty = Σ(buys) − Σ(sells); avg entry = qty-weighted avg of
// executed buy prices. Returns { netQty, avgEntry, executedCount } and never throws.
async function botPositionFromSignals(strategyId) {
  if (!sbAdmin || !strategyId) return { netQty: 0, avgEntry: null, executedCount: 0 };
  const { data, error } = await sbAdmin.from("pending_signals")
    .select("side, qty, suggested_price, executed_at, ticker")
    .eq("strategy_id", strategyId)
    .eq("status", "executed");
  if (error || !Array.isArray(data)) return { netQty: 0, avgEntry: null, executedCount: 0, ticker: null };
  let netQty = 0, buyQty = 0, buyCost = 0, lastBuyAt = 0, ticker = null;
  for (const s of data) {
    const q = Number(s.qty) || 0;
    const px = Number(s.suggested_price) || 0;
    if (s.side === "buy") {
      netQty += q; buyQty += q; buyCost += q * px;
      // Track the most recently bought ticker — a screening strategy holds one
      // name at a time, so this is the currently-open position's symbol.
      const at = s.executed_at ? new Date(s.executed_at).getTime() : 0;
      if (at >= lastBuyAt && s.ticker) { lastBuyAt = at; ticker = String(s.ticker).toUpperCase(); }
    } else if (s.side === "sell") { netQty -= q; }
  }
  const avgEntry = buyQty > 0 ? buyCost / buyQty : null;
  return { netQty: Math.max(0, Math.round(netQty * 100) / 100), avgEntry, executedCount: data.length, ticker };
}

// Realized P&L ledger from a strategy's EXECUTED signals. Walks fills in
// chronological order keeping a per-ticker average-cost book; every SELL closes
// (part of) a position and books realized P&L = qty × (sell − avgCost). This is
// the round-trip history that vanishes from the open-position view once a
// position is fully sold (netQty → 0). Basis is the signal's suggested_price
// (no lot-level fills from SnapTrade), same documented approximation as the
// open-position math. Never throws.
//
// Returns { realized_pnl, closed_count, wins, losses, trades: [{ ticker, qty,
// entry, exit, realized, realized_pct, closed_at }] } newest-first.
async function botRealizedPnl(strategyId) {
  const empty = { realized_pnl: 0, closed_count: 0, wins: 0, losses: 0, trades: [] };
  if (!sbAdmin || !strategyId) return empty;
  const { data, error } = await sbAdmin.from("pending_signals")
    .select("side, qty, suggested_price, executed_at, ticker")
    .eq("strategy_id", strategyId)
    .eq("status", "executed")
    .order("executed_at", { ascending: true });
  if (error || !Array.isArray(data)) return empty;

  const book = new Map(); // ticker → { qty, cost } (cost = basis of held qty)
  const out = { realized_pnl: 0, closed_count: 0, wins: 0, losses: 0, trades: [] };
  for (const s of data) {
    const t = String(s.ticker || "").toUpperCase();
    const q = Number(s.qty) || 0;
    const px = Number(s.suggested_price) || 0;
    if (!t || q <= 0) continue;
    if (!book.has(t)) book.set(t, { qty: 0, cost: 0 });
    const b = book.get(t);
    if (s.side === "buy") {
      b.qty += q; b.cost += q * px;
    } else if (s.side === "sell") {
      // Can only realize against shares we have a basis for.
      const sellQty = Math.min(q, b.qty);
      if (sellQty > 0) {
        const avgCost = b.cost / b.qty;
        const realized = Math.round(sellQty * (px - avgCost) * 100) / 100;
        const realizedPct = avgCost > 0 ? Math.round(((px - avgCost) / avgCost) * 1000) / 10 : 0;
        out.realized_pnl += realized;
        out.closed_count += 1;
        if (realized >= 0) out.wins += 1; else out.losses += 1;
        out.trades.push({
          ticker: t, qty: sellQty,
          entry: Math.round(avgCost * 100) / 100, exit: Math.round(px * 100) / 100,
          realized, realized_pct: realizedPct, closed_at: s.executed_at || null,
        });
        b.cost -= sellQty * avgCost; b.qty -= sellQty;
        if (b.qty <= 0.0001) { b.qty = 0; b.cost = 0; }
      }
    }
  }
  out.realized_pnl = Math.round(out.realized_pnl * 100) / 100;
  out.trades.reverse(); // newest-first
  return out;
}

// Per-strategy progress for the GET /api/bot/strategies response. Approximate by
// design (no lot-level basis) and defensive — any failure yields zeros, never throws.
async function computeStrategyProgress(strat) {
  const out = {
    current_value: 0,
    pct_to_target: 0,
    days_elapsed: 0,
    days_horizon: Number(strat?.time_horizon_days) || 0,
    trades_executed: 0,
    realized_pnl: 0,
    closed_count: 0,
    wins: 0,
    losses: 0,
  };
  try {
    const pos = await botPositionFromSignals(strat.id);
    out.trades_executed = pos.executedCount;

    // Realized P&L from closed round-trips (separate from open-position value).
    const realized = await botRealizedPnl(strat.id);
    out.realized_pnl = realized.realized_pnl;
    out.closed_count = realized.closed_count;
    out.wins = realized.wins;
    out.losses = realized.losses;

    const created = strat?.created_at ? new Date(strat.created_at).getTime() : NaN;
    if (Number.isFinite(created)) {
      out.days_elapsed = Math.max(0, Math.floor((Date.now() - created) / 86400000));
    }

    if (pos.netQty > 0) {
      // Screening strategies hold a name the engine picked, not strat.ticker.
      out.held_ticker = pos.ticker || strat.ticker;
      const quote = await finnhubQuote(out.held_ticker);
      if (quote) {
        out.current_value = Math.round(pos.netQty * quote.current * 100) / 100;
        // Approximate progress toward profit_target_pct from avg entry → live price.
        const target = Number(strat?.profit_target_pct) || 0;
        if (pos.avgEntry && pos.avgEntry > 0 && target > 0) {
          const gainPct = ((quote.current - pos.avgEntry) / pos.avgEntry) * 100;
          out.pct_to_target = Math.round(Math.max(0, Math.min(100, (gainPct / target) * 100)) * 10) / 10;
        }
      }
    }
  } catch (e) {
    warn("bot.progress.failed", { strategy_id: strat?.id, err: e?.message });
  }
  return out;
}

// ── Main entry point ─────────────────────────────────────
// Normalized request → { status, body }. The caller serializes.
// Wraps the work in withRequestContext so every log line inside the
// handler chain auto-carries the request id + method + path; logs
// request.start at entry and request.end at exit with durationMs.
export async function handleApiRequest({ method, pathname, query, body, headers, rawBody }) {
  const rid = headers["x-request-id"] || newRequestId();
  return withRequestContext({ rid, method, path: pathname }, async () => {
    const t0 = Date.now();
    info("request.start", { ip: clientIp(headers) });
    try {
      const result = await _handle({ method, pathname, query, body, headers, rawBody });
      info("request.end", { status: result.status, durationMs: Date.now() - t0 });
      return { ...result, headers: { ...(result.headers || {}), "X-Request-Id": rid } };
    } catch (err) {
      logError("request.failed", { err: err?.message, stack: err?.stack, durationMs: Date.now() - t0 });
      try { Sentry.captureException(err, { tags: { rid, path: pathname, method } }); } catch { /* swallow */ }
      throw err;
    }
  });
}

async function _handle({ method, pathname, query, body, headers, rawBody }) {
  const parsed = body || {};
  const q = query || {};
  const h = headers || {};

  // IP-block check — brute-force detector writes to security_events when
  // an IP crosses the failed-auth threshold. Consistent across cold starts
  // and all Vercel instances because it reads from Supabase, not in-memory.
  const ip = clientIp(h);
  if (await isIpBlocked(sbAdmin, ip)) {
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

  // ── Sharia screening (single source of truth) ─────────────────────────────
  // GET  /api/screen?symbol=AAPL          → one normalized verdict
  // POST /api/screen { symbols: [...] }   → { provider, results: { TK: verdict } }
  // Provider-dispatched in lib/sharia.mjs (Finnhub now, Zoya when keyed). This
  // is what governs h.sh_ on the client, so Screener / Overview / Rebalancer /
  // Purification all read the same verdict. Auth + rate-limited.
  if (pathname === "/api/screen") {
    const user = await verifyUser(h);
    if (!user) return { status: 401, body: { error: "unauthorized" } };
    // Rate limiting is already applied globally (applyRateLimit) before routing.

    if (method === "GET") {
      const symbol = q.symbol;
      if (!symbol) return { status: 400, body: { error: "symbol is required" } };
      const verdict = await screenSymbol(symbol);
      return { status: 200, body: { provider: activeShariaProvider(), verdict } };
    }
    if (method === "POST") {
      const symbols = Array.isArray(parsed.symbols) ? parsed.symbols : [];
      if (!symbols.length) return { status: 200, body: { provider: activeShariaProvider(), results: {} } };
      const results = await screenBatch(symbols);
      return { status: 200, body: { provider: activeShariaProvider(), results } };
    }
    return { status: 405, body: { error: "method_not_allowed" } };
  }

  // Batched live-quote proxy. Replaces direct browser → finnhub.io calls
  // so users never need to hold a vendor key in the browser bundle.
  // Accepts ?symbols=AAPL,MSFT,NVDA (max 25). Returns the same shape the
  // client's `fetchFinnhub` used to produce.
  if (pathname === "/api/finnhub/quote") {
    const symbolsRaw = (q.symbols || "").trim();
    if (!symbolsRaw) return { status: 200, body: { quotes: [] } };
    const symbols = symbolsRaw.split(",").map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 25);
    // Primary: Finnhub (when keyed). Per-symbol fan-out; missing prices fall
    // through to the free Yahoo fallback below so watchlist tickers Finnhub
    // can't price (or all tickers when FINNHUB_KEY is unset) still resolve.
    let quotes = [];
    if (FINNHUB_KEY) {
      const settled = await Promise.allSettled(symbols.map(async sym => {
        const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${encodeURIComponent(FINNHUB_KEY)}`;
        const r = await httpsGetJson(url);
        const d = r.body || {};
        if (!d.c || d.c === 0) return null;
        return { tk: sym, price: d.c, chg: d.d, pct: d.dp, hi: d.h, lo: d.l, src: "Finnhub" };
      }));
      quotes = settled.filter(r => r.status === "fulfilled" && r.value).map(r => r.value);
    }
    // Fall back for any symbol Finnhub couldn't price: Alpaca first (keyed,
    // batched, reliable), then Yahoo (keyless, last resort).
    let missing = symbols.filter(s => !new Set(quotes.map(x => x.tk)).has(s));
    if (missing.length) {
      try { quotes = quotes.concat(await fetchAlpacaQuotes(missing)); }
      catch { /* Alpaca down — try Yahoo next */ }
    }
    missing = symbols.filter(s => !new Set(quotes.map(x => x.tk)).has(s));
    if (missing.length) {
      try { quotes = quotes.concat(await fetchYahooQuotes(missing)); }
      catch { /* all sources down — return whatever we have */ }
    }
    // Per-source counts so the fallback chain is observable in runtime logs
    // (which tier actually served each quote, and how many came back empty).
    info("finnhub.quote.served", {
      requested: symbols.length,
      finnhub:   quotes.filter(x => x.src === "Finnhub").length,
      alpaca:    quotes.filter(x => x.src === "Alpaca").length,
      yahoo:     quotes.filter(x => x.src === "Yahoo").length,
      missing:   symbols.length - quotes.length,
    });
    return { status: 200, body: { quotes } };
  }

  if (pathname === "/api/finnhub/news") {
    if (!FINNHUB_KEY) return { status: 200, body: { news: [] } };
    const symbol = (q.symbol || "").trim().toUpperCase();
    if (symbol) {
      // Per-symbol company news via Finnhub /company-news (last 7 days)
      const today = new Date();
      const weekAgo = new Date(today); weekAgo.setDate(today.getDate() - 7);
      const from = q.from || weekAgo.toISOString().slice(0, 10);
      const to   = q.to   || today.toISOString().slice(0, 10);
      const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&token=${encodeURIComponent(FINNHUB_KEY)}`;
      const r = await httpsGetJson(url);
      const arr = Array.isArray(r.body) ? r.body : [];
      const news = arr.slice(0, 5).map(n => ({
        h: n.headline, src: n.source, url: n.url, s: "neutral",
        datetime: n.datetime || (Date.now() / 1000),
      }));
      info("finnhub.company_news.ok", { symbol, count: news.length, from, to });
      return { status: 200, body: { news } };
    }
    // General market news (no symbol param)
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

  // GET /api/metals/spot — gold + silver spot prices for the Zakat nisab
  // calculator. Proxies Stooq's public CSV snapshots (XAUUSD / XAGUSD,
  // quoted per troy ounce), converts to USD/g, and pre-computes the two
  // nisab thresholds (87.48 g gold, 612.36 g silver). No API key required.
  // 12-hour in-memory cache — precious-metals spot moves slowly enough
  // that we don't need intraday freshness, and Stooq doesn't appreciate
  // hammering.
  //
  // Source rationale: Finnhub's free tier rejects OANDA forex / commodity
  // quotes ("You don't have access to this resource"). Stooq publishes a
  // one-line CSV at /q/l/?s=<sym> with no auth at all and updates intraday.
  //
  // Falls back to {ok:false, source:"fallback"} when the fetch fails so
  // the client renders its static defaults instead of NaN.
  if (pathname === "/api/metals/spot" && method === "GET") {
    const TROY_OZ_TO_G = 31.1034768;
    const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
    if (globalThis.__mizan_metals_cache && (Date.now() - globalThis.__mizan_metals_cache.at) < CACHE_TTL_MS) {
      return { status: 200, body: globalThis.__mizan_metals_cache.body };
    }
    const fallback = {
      ok: false, source: "fallback", refreshed_at: null,
      gold_usd_per_oz: null, silver_usd_per_oz: null,
      gold_usd_per_g: null,  silver_usd_per_g:  null,
      nisab_gold_usd: null,  nisab_silver_usd:  null,
    };
    // Parse Stooq's two-line CSV. Header: Symbol,Date,Time,Open,High,Low,Close.
    // We want column 6 (Close).
    function parseStooqClose(text) {
      const lines = String(text || "").trim().split(/\r?\n/);
      if (lines.length < 2) return NaN;
      const cells = lines[1].split(",");
      return Number(cells[6]);
    }
    async function fetchStooq(symbol) {
      const url = `https://stooq.com/q/l/?s=${symbol}&f=sd2t2ohlc&h&e=csv`;
      const r = await fetch(url, { headers: { "User-Agent": "Mizan/1.0 (zakat-nisab)" } });
      if (!r.ok) throw new Error(`stooq ${symbol} ${r.status}`);
      return parseStooqClose(await r.text());
    }
    try {
      const [goldOz, silverOz] = await Promise.all([
        fetchStooq("xauusd"),
        fetchStooq("xagusd"),
      ]);
      if (!Number.isFinite(goldOz) || goldOz <= 0 || !Number.isFinite(silverOz) || silverOz <= 0) {
        throw new Error(`unexpected stooq quote: gold=${goldOz}, silver=${silverOz}`);
      }
      const round2 = (n) => Math.round(n * 100) / 100;
      const body = {
        ok: true,
        source: "stooq",
        refreshed_at: new Date().toISOString(),
        gold_usd_per_oz:   round2(goldOz),
        silver_usd_per_oz: round2(silverOz),
        gold_usd_per_g:    round2(goldOz   / TROY_OZ_TO_G),
        silver_usd_per_g:  round2(silverOz / TROY_OZ_TO_G),
        nisab_gold_usd:    round2(87.48  * goldOz   / TROY_OZ_TO_G),
        nisab_silver_usd:  round2(612.36 * silverOz / TROY_OZ_TO_G),
        ttl_seconds: Math.round(CACHE_TTL_MS / 1000),
      };
      globalThis.__mizan_metals_cache = { at: Date.now(), body };
      info("metals.spot.ok", { gold_oz: body.gold_usd_per_oz, silver_oz: body.silver_usd_per_oz, nisab_gold: body.nisab_gold_usd, nisab_silver: body.nisab_silver_usd });
      return { status: 200, body };
    } catch (err) {
      logError("metals.spot.failed", { err: err.message });
      return { status: 200, body: { ...fallback, reason: "fetch_failed", error: err.message } };
    }
  }

  // GET /api/user/features — feature flags for the current user.
  // Client uses this to conditionally show/hide admin-gated UI.
  if (pathname === "/api/user/features" && method === "GET") {
    const user = await verifyUser(h);
    if (!user) return { status: 401, body: { error: "unauthorized" } };
    const trading_bot = await canUseTradingBot(user);
    const is_root     = await isRootUser(user);
    const full_auto   = trading_bot ? await canUseFullAuto(user) : false;
    // Non-root beta users must accept the disclosure once; root is implicit.
    const trading_bot_consented = trading_bot ? await botConsentOk(user) : false;
    return { status: 200, body: { trading_bot, full_auto, is_root, trading_bot_consented } };
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
      : "claude-sonnet-4-6";
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
      : "claude-sonnet-4-6";

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

    // Trading bot gate — server-enforced, cannot be bypassed by client
    const tradeAuthUser = snap.supabaseUser;
    if (!(await canUseTradingBot(tradeAuthUser))) {
      return { status: 403, body: { error: "trading_not_enabled" } };
    }

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

    // Sharia gate — server-side, before any broker call (Layer 1). Non-negotiable.
    const tickerUp = String(symbol).toUpperCase();
    if (HARAM_TICKERS.has(tickerUp)) {
      audit({ userId: tradeAuthUser?.id, action: "trade.sharia_blocked", target: tickerUp, metadata: { layer: "manual" }, headers: h });
      return { status: 403, body: { error: "sharia_blocked", ticker: tickerUp, message: `${tickerUp} is flagged non-compliant with AAOIFI standards.` } };
    }

    // /trade/impact needs a universal_symbol_id (UUID); the client sends a
    // ticker. Resolve it for this account (passes through if already a UUID).
    const universalSymbolId = await resolveUniversalSymbolId({ userId, userSecret, accountId, ticker: symbol });
    if (!universalSymbolId) {
      return { status: 422, body: { error: `Could not resolve symbol ${tickerUp} for this account.` } };
    }

    const tradeBody = {
      account_id:          accountId,
      action,
      universal_symbol_id: universalSymbolId,
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
    // SnapTrade returns 403 + code 1141 "Manual refresh not enabled on
    // the real-time plan. Data endpoints already return real-time data."
    // for accounts on the real-time / PAYG plan — refresh is intentionally
    // disabled because /accounts and /activities already stream live. This
    // is success-shaped state, not a failure. Detect it so we don't render
    // the misleading "rejected the refresh" toast.
    const realtimeDisabled = results.filter(r =>
      r.status === 403 && (r.body?.code === "1141" || r.body?.code === 1141 ||
        (typeof r.body?.detail === "string" && /real-time plan/i.test(r.body.detail)))
    ).length;

    audit({ userId: supabaseUser?.id, action: "broker.force_refresh", metadata: { total: auths.length, queued, throttled, realtimeDisabled }, headers: h });

    if (queued === 0 && throttled === auths.length) {
      return {
        status: 429,
        body: { error: "All connections are throttled by SnapTrade. Try again in ~1 hour.", results },
        headers: { "Retry-After": "3600" },
      };
    }
    if (queued === 0 && realtimeDisabled === auths.length) {
      info("snaptrade.refresh.realtime_plan", { total: auths.length });
      return {
        status: 200,
        body: {
          ok: true,
          queued: auths.length,
          total: auths.length,
          throttled: 0,
          message: "Already real-time on your SnapTrade plan — manual refresh not needed. Balances and activity update live.",
          results,
        },
      };
    }
    if (queued === 0) {
      return { status: 502, body: { error: "SnapTrade rejected the refresh for all connections.", results } };
    }
    info("snaptrade.refresh.ok", { queued, total: auths.length, throttled, realtimeDisabled });
    return { status: 200, body: { ok: true, queued, total: auths.length, throttled, realtimeDisabled, results } };
  }

  if (pathname === "/api/snaptrade/trade/place" && method === "POST") {
    let snap; try { snap = await getSnapForRequest(h); } catch { return { status: 404, body: { error: "No registered user" } }; }
    const { userId, userSecret } = snap;

    // Trading bot gate — server-enforced, cannot be bypassed by client
    const placeAuthUser = snap.supabaseUser;
    if (!(await canUseTradingBot(placeAuthUser))) {
      return { status: 403, body: { error: "trading_not_enabled" } };
    }
    // Placing a real order requires the non-root beta user to have consented.
    if (!(await botConsentOk(placeAuthUser))) {
      return { status: 403, body: { error: "consent_required" } };
    }

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
      // Authenticity gate: only act on webhooks Plaid actually signed. Rejects
      // forged POSTs that would otherwise pollute a victim's audit_log and
      // trigger cross-user syncs by guessing an item_id.
      if (!(await verifyPlaidWebhook(h, rawBody))) {
        warn("plaid.webhook.rejected", { ip: clientIp(h) });
        return { status: 401, body: { error: "invalid_webhook_signature" } };
      }
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
          const tokensRes = await tokensQuery;
          // Distinguish "PostgREST error" from "no rows": both produced
          // data: null prior to this change, which the next line treated
          // as "no tokens" and returned a 200 with added: 0. That's what
          // made migration 010 not being applied (transactions_cursor
          // column missing → 42703) look like "Plaid returned no
          // transactions" in the UI for months. Loud > silent.
          if (tokensRes?.error) {
            logError("plaid.transactions.sync.tokens_query_failed", {
              user: user.id,
              code: tokensRes.error.code,
              message: tokensRes.error.message,
            });
            return {
              status: 500,
              body: {
                error: "Server-side Plaid tokens read failed. Check Supabase migrations are applied.",
                code: tokensRes.error.code || null,
                detail: tokensRes.error.message || null,
              },
            };
          }
          const tokens = Array.isArray(tokensRes?.data) ? tokensRes.data : [];
          if (tokens.length === 0) {
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

    // GET /api/plaid/item-status?item_id=X — Plaid /item/get diagnostic.
    // Surfaces consent_expiration_time, available_products,
    // consented_products, the Item-level error (if any), and the latest
    // transactions update timestamps. Used by Connection Health's DETAILS
    // expander to answer "why is /transactions/sync returning empty?"
    // without forcing the user to disconnect + relink.
    if (pathname === "/api/plaid/item-status" && method === "GET") {
      const itemId = q.item_id || q.itemId;
      if (!itemId) return { status: 400, body: { error: "item_id required" } };
      try {
        // Fetch every Plaid token owned by this user, then locate the
        // requested one in memory. Avoids a supabase-js .maybeSingle() path
        // that silently returned null on this exact (user_id, item_id) pair
        // in production even though the row demonstrably existed
        // (confirmed by re-querying without the .eq("item_id") filter).
        // Plaid Items per user are O(small), so the unfiltered fetch is
        // cheaper than chasing the maybeSingle quirk.
        // Run two queries: the "fat" projection we actually need, AND a
        // narrow projection that matches what /api/connections/health uses.
        // The user reported Connection Health shows their items while this
        // endpoint sees zero — same sbAdmin, same user.id, same table. Best
        // remaining suspect: PostgREST silently rejecting the fat projection
        // (column-level error swallowed by maybeSingle-adjacent code paths)
        // while the narrow projection succeeds. Surfacing both lets us see
        // which one is misbehaving without another round trip.
        const fatRes = await sbAdmin
          .from("plaid_tokens")
          .select("access_token, item_id, institution_name, transactions_cursor, created_at")
          .eq("user_id", user.id);
        const narrowRes = await sbAdmin
          .from("plaid_tokens")
          .select("item_id, institution_name")
          .eq("user_id", user.id);
        const fatRows    = Array.isArray(fatRes?.data)    ? fatRes.data    : [];
        const narrowRows = Array.isArray(narrowRes?.data) ? narrowRes.data : [];
        const tok = fatRows.find(r => r.item_id === itemId);
        if (!tok?.access_token) {
          warn("plaid.item_status.not_found", {
            user: user.id,
            requested_item_id: itemId,
            fat_count: fatRows.length,
            narrow_count: narrowRows.length,
            fat_error: fatRes?.error?.message || null,
            narrow_error: narrowRes?.error?.message || null,
          });
          return {
            status: 404,
            body: {
              error: "item not found",
              debug: {
                requested_item_id: itemId,
                requested_item_id_len: itemId.length,
                user_id_prefix: user.id.slice(0, 8) + "…",
                fat_count: fatRows.length,
                narrow_count: narrowRows.length,
                fat_error: fatRes?.error ? { message: fatRes.error.message, code: fatRes.error.code, hint: fatRes.error.hint, details: fatRes.error.details } : null,
                narrow_error: narrowRes?.error ? { message: narrowRes.error.message, code: narrowRes.error.code } : null,
                narrow_item_ids: narrowRows.map(r => ({ id: r.item_id, institution: r.institution_name })),
              },
            },
          };
        }

        const ig = await plaidClient.itemGet({ access_token: tok.access_token });
        const item    = ig.data?.item   || {};
        const status  = ig.data?.status || {};
        const txStatus = status.transactions || {};

        // Sanitize: only return the fields the diagnostic actually needs.
        // Never echo access_token or any raw Plaid object the client doesn't
        // need — keep the response small and auditable.
        return {
          status: 200,
          body: {
            item_id:                  item.item_id || tok.item_id,
            institution_id:           item.institution_id || null,
            institution_name:         tok.institution_name || null,
            connected_at:             tok.created_at || null,
            cursor_set:               !!tok.transactions_cursor,
            available_products:       item.available_products  || [],
            billed_products:          item.billed_products     || [],
            products:                 item.products            || [],
            consented_products:       item.consented_products  || null,
            consent_expiration_time:  item.consent_expiration_time || null,
            update_type:              item.update_type         || null,
            error:                    item.error               || null,
            transactions_status: {
              last_successful_update: txStatus.last_successful_update || null,
              last_failed_update:     txStatus.last_failed_update     || null,
            },
            last_webhook: status.last_webhook || null,
          },
        };
      } catch (err) {
        logError("plaid.item_status.failed", { detail: err.response?.data || err.message });
        return plaidErrorToResponse(err);
      }
    }

    // GET /api/plaid/recurring — Plaid's native recurring-transactions endpoint.
    // Calls transactionsRecurringGet for every connected Item and merges
    // outflow_streams across all of them. Credit-card Items are included by
    // default since that's where most subscriptions live.
    if (pathname === "/api/plaid/recurring" && method === "GET") {
      try {
        const { data: tokenRows, error: tokErr } = await sbAdmin
          .from("plaid_tokens")
          .select("access_token, item_id, institution_name")
          .eq("user_id", user.id);
        if (tokErr) return { status: 500, body: { error: "Failed to read tokens", detail: tokErr.message } };
        const tokens = Array.isArray(tokenRows) ? tokenRows : [];
        if (tokens.length === 0) return { status: 200, body: { outflow_streams: [], inflow_streams: [] } };

        const allOutflows = [];
        const allInflows  = [];
        for (const tok of tokens) {
          try {
            const res = await plaidClient.transactionsRecurringGet({ access_token: tok.access_token });
            const outflows = Array.isArray(res.data?.outflow_streams) ? res.data.outflow_streams : [];
            const inflows  = Array.isArray(res.data?.inflow_streams)  ? res.data.inflow_streams  : [];
            // Tag each stream with the institution name so the UI can show it.
            outflows.forEach(s => { s._institution = tok.institution_name || null; });
            inflows.forEach(s  => { s._institution = tok.institution_name || null; });
            allOutflows.push(...outflows);
            allInflows.push(...inflows);
          } catch (itemErr) {
            warn("plaid.recurring.item_failed", { item_id: tok.item_id, err: itemErr.response?.data?.error_code || itemErr.message });
          }
        }

        return { status: 200, body: { outflow_streams: allOutflows, inflow_streams: allInflows } };
      } catch (err) {
        logError("plaid.recurring.failed", { err: err.message });
        return plaidErrorToResponse(err);
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
      .select(SNAP_SECRET_COLS)
      .eq("user_id", targetId).maybeSingle();
    const targetSecret = row ? extractUserSecret(row) : null;
    if (rowErr || !targetSecret) {
      return { status: 404, body: { error: "Target has no SnapTrade record" } };
    }
    const r = await snapReq("DELETE", `/authorizations/${authId}`, null, {
      userId: row.snaptrade_user_id, userSecret: targetSecret,
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

  // ── Trading Bot: strategy CRUD ────────────────────────────────────────────────
  // POST /api/bot/consent — record acceptance of the experimental/not-an-RIA
  // disclosure. Required for non-root users before they can create a strategy or
  // execute a trade. Root is implicitly consented.
  if (pathname === "/api/bot/consent" && method === "POST") {
    const user = await verifyUser(h);
    if (!user) return { status: 401, body: { error: "unauthorized" } };
    if (!(await canUseTradingBot(user))) return { status: 403, body: { error: "trading_not_enabled" } };
    const now = new Date().toISOString();
    const { error } = await sbAdmin.from("profiles").update({ trading_bot_consent_at: now }).eq("id", user.id);
    if (error) { warn("bot.consent.persist_failed", { err: error.message }); return { status: 500, body: { error: "db_error" } }; }
    audit({ userId: user.id, action: "bot.consent.accepted", metadata: {}, headers: h });
    return { status: 200, body: { ok: true, consented_at: now } };
  }

  // GET /api/bot/trades — realized-P&L ledger across ALL of the user's
  // strategies. The aggregate "did Trade make money" answer + closed round-trip
  // history (which the open-position view loses once netQty → 0).
  if (pathname === "/api/bot/trades" && method === "GET") {
    const user = await verifyUser(h);
    if (!user) return { status: 401, body: { error: "unauthorized" } };
    if (!(await canUseTradingBot(user))) return { status: 403, body: { error: "trading_not_enabled" } };
    const { data: strats, error } = await sbAdmin.from("bot_strategies")
      .select("id, ticker, params").eq("user_id", user.id);
    if (error) { warn("bot.trades.list_failed", { err: error.message }); return { status: 500, body: { error: "db_error" } }; }
    const nameOf = (s) => (Array.isArray(s.params?.universe_tickers) && s.params.universe_tickers.length > 1)
      ? `${s.params.universe_tickers.length} halal names` : (s.ticker || "—");
    let realized_pnl = 0, wins = 0, losses = 0;
    const trades = [];
    for (const s of (strats || [])) {
      const r = await botRealizedPnl(s.id);
      realized_pnl += r.realized_pnl; wins += r.wins; losses += r.losses;
      for (const t of r.trades) trades.push({ ...t, strategy_id: s.id, strategy_label: nameOf(s) });
    }
    trades.sort((a, b) => new Date(b.closed_at || 0) - new Date(a.closed_at || 0));
    const closed_count = wins + losses;
    return { status: 200, body: {
      realized_pnl: Math.round(realized_pnl * 100) / 100,
      closed_count, wins, losses,
      win_rate: closed_count > 0 ? Math.round((wins / closed_count) * 1000) / 10 : null,
      trades,
    } };
  }

  // GET /api/bot/activity — the bot's full action timeline across all of the
  // user's strategies, straight from pending_signals (the bot's own ledger).
  // Every signal it generated and what became of it: BUY/SELL, executed (filled),
  // pending, approved, rejected, expired, or failed (status approved + error_msg).
  // Immediate — does NOT depend on SnapTrade activity sync, so a full-auto fill
  // shows here the moment the cron runs, before it appears in the broker Activity tab.
  if (pathname === "/api/bot/activity" && method === "GET") {
    const user = await verifyUser(h);
    if (!user) return { status: 401, body: { error: "unauthorized" } };
    if (!(await canUseTradingBot(user))) return { status: 403, body: { error: "trading_not_enabled" } };
    const { data, error } = await sbAdmin.from("pending_signals")
      .select("id, ticker, side, qty, suggested_price, status, created_at, executed_at, expires_at, error_msg, strategy_id")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) { warn("bot.activity.list_failed", { err: error.message }); return { status: 500, body: { error: "db_error" } }; }
    return { status: 200, body: { items: data || [] } };
  }

  if (pathname.startsWith("/api/bot/strategies")) {
    const user = await verifyUser(h);
    if (!user) return { status: 401, body: { error: "unauthorized" } };
    if (!(await canUseTradingBot(user))) return { status: 403, body: { error: "trading_not_enabled" } };
    // Computed once for the block: full-auto create/edit is root-only.
    const isRoot = await isRootUser(user);

    // GET /api/bot/strategies
    if (method === "GET" && pathname === "/api/bot/strategies") {
      const { data, error } = await sbAdmin.from("bot_strategies").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
      if (error) { warn("bot.strategies.list_failed", { err: error.message }); return { status: 500, body: { error: "db_error" } }; }
      const strategies = await Promise.all((data || []).map(async (s) => {
        const progress = await computeStrategyProgress(s);
        return { ...s, progress };
      }));
      return { status: 200, body: { strategies } };
    }

    // POST /api/bot/strategies — create
    if (method === "POST" && pathname === "/api/bot/strategies") {
      // Non-root beta users must have accepted the risk disclosure first.
      if (!(await botConsentOk(user))) return { status: 403, body: { error: "consent_required" } };
      const { ticker, account_id, strategy_type, params = {}, mode,
              layer, universe_tickers,
              capital_allocated = 0, profit_target_pct, stop_loss_pct = 15,
              max_drawdown_pct = 20, time_horizon_days = 28, max_trades_per_day = 3,
              nl_description, nl_risk_disclosed = false } = parsed;
      if (!ticker || !account_id || !strategy_type) return { status: 400, body: { error: "ticker, account_id, strategy_type required" } };
      // Compliance gate: a strategy without a stop-loss can NEVER be saved.
      if (stop_loss_pct == null || !(Number(stop_loss_pct) > 0)) return { status: 400, body: { error: "stop_loss_required" } };
      // Execution layer (manual | semi | full). Default semi if unspecified.
      // The DB mode column is the full-auto safety gate, so it is derived from
      // the layer: only layer='full' maps to mode='full'.
      const effLayer = ["manual", "semi", "full"].includes(layer) ? layer
                       : (mode === "full" ? "full" : "semi");
      const dbMode = effLayer === "full" ? "full" : "semi";
      // COMPLIANCE: full-auto (autonomous execution) is owner-only. A non-root
      // beta user can run Manual/Semi (a human approves every trade on their own
      // account) but can never create a full-auto strategy.
      if (!isRoot && (effLayer === "full" || dbMode === "full")) {
        return { status: 403, body: { error: "full_auto_root_only" } };
      }
      // Persist the user-facing layer + screening candidates inside params jsonb
      // (no schema change needed). universe_tickers drives the cron screener.
      const candidates = Array.isArray(universe_tickers)
        ? universe_tickers : (Array.isArray(params.universe_tickers) ? params.universe_tickers : []);
      const mergedParams = {
        ...params,
        layer: effLayer,
        universe_tickers: [...new Set(candidates.map(t => String(t || "").toUpperCase().trim()).filter(Boolean))],
      };
      const { data, error } = await sbAdmin.from("bot_strategies").insert({
        user_id: user.id, ticker: ticker.toUpperCase(), account_id, strategy_type, params: mergedParams,
        mode: dbMode, capital_allocated, profit_target_pct, stop_loss_pct, max_drawdown_pct,
        time_horizon_days, max_trades_per_day, nl_description, nl_risk_disclosed,
      }).select().single();
      if (error) { warn("bot.strategies.create_failed", { err: error.message }); return { status: 500, body: { error: "db_error" } }; }
      audit({ userId: user.id, action: "bot.strategy.created", target: data.id, metadata: { ticker, strategy_type, layer: effLayer }, headers: h });
      return { status: 201, body: { strategy: data } };
    }

    // PATCH /api/bot/strategies/:id — update (or pause-all)
    const patchMatch = pathname.match(/^\/api\/bot\/strategies\/([^/]+)$/);
    if (method === "PATCH" && patchMatch) {
      const stratId = patchMatch[1];
      // ticker/account_id/strategy_type are editable too (in-place strategy edit).
      // universe_tickers is NOT a column — it's folded into the params jsonb below.
      const allowed = ["enabled","mode","ticker","account_id","strategy_type","params","capital_allocated","profit_target_pct","stop_loss_pct","max_drawdown_pct","time_horizon_days","max_trades_per_day","nl_risk_disclosed","full_auto_enabled"];
      const updates = {};
      allowed.forEach(k => { if (k in parsed) updates[k] = parsed[k]; });
      updates.updated_at = new Date().toISOString();
      // Pause-all special case: sets all strategies enabled=false for this user
      if (stratId === "pause-all") {
        const { error } = await sbAdmin.from("bot_strategies").update({ enabled: false, updated_at: updates.updated_at }).eq("user_id", user.id);
        if (error) return { status: 500, body: { error: "db_error" } };
        audit({ userId: user.id, action: "bot.kill_switch.activated", metadata: {}, headers: h });
        return { status: 200, body: { ok: true } };
      }
      // COMPLIANCE: non-root beta users can never switch a strategy to full-auto.
      if (!isRoot && (parsed.layer === "full" || parsed.mode === "full")) {
        return { status: 403, body: { error: "full_auto_root_only" } };
      }
      // Compliance gate (mirrors the create path): editing the stop-loss can never
      // remove it. Only fires when stop_loss_pct is part of THIS edit, so unrelated
      // PATCHes (pause/resume, layer toggle) are unaffected.
      if ("stop_loss_pct" in parsed && !(Number(parsed.stop_loss_pct) > 0)) {
        return { status: 400, body: { error: "stop_loss_required" } };
      }
      // Normalize ticker to the create path's storage form and reject blank
      // identity fields when they're explicitly part of the edit.
      if ("ticker" in updates) updates.ticker = String(updates.ticker || "").toUpperCase().trim();
      for (const k of ["ticker","account_id","strategy_type"]) {
        if (k in updates && !String(updates[k] || "").trim()) return { status: 400, body: { error: `${k}_required` } };
      }
      // Any edit touching layer / universe_tickers / params must read-modify-write
      // the params jsonb so we never clobber layer, universe_tickers, or entry/exit
      // rules that aren't part of this particular edit.
      const editsLayer = "layer" in parsed && ["manual", "semi", "full"].includes(parsed.layer);
      const editsUniverse = "universe_tickers" in parsed;
      if (editsLayer || editsUniverse || "params" in parsed) {
        const { data: cur } = await sbAdmin.from("bot_strategies").select("params").eq("id", stratId).eq("user_id", user.id).single();
        const nextParams = { ...(cur?.params || {}), ...(updates.params || {}) };
        if (editsLayer) {
          updates.mode = parsed.layer === "full" ? "full" : "semi";
          nextParams.layer = parsed.layer;
        }
        if (editsUniverse) {
          const cands = Array.isArray(parsed.universe_tickers) ? parsed.universe_tickers : [];
          nextParams.universe_tickers = [...new Set(cands.map(t => String(t || "").toUpperCase().trim()).filter(Boolean))];
        }
        updates.params = nextParams;
      }
      const { data, error } = await sbAdmin.from("bot_strategies").update(updates).eq("id", stratId).eq("user_id", user.id).select().single();
      if (error) return { status: 500, body: { error: "db_error" } };
      audit({ userId: user.id, action: "bot.strategy.updated", target: stratId, metadata: updates, headers: h });
      return { status: 200, body: { strategy: data } };
    }

    // DELETE /api/bot/strategies/:id
    const delMatch = pathname.match(/^\/api\/bot\/strategies\/([^/]+)$/);
    if (method === "DELETE" && delMatch) {
      const stratId = delMatch[1];
      const { error } = await sbAdmin.from("bot_strategies").delete().eq("id", stratId).eq("user_id", user.id);
      if (error) return { status: 500, body: { error: "db_error" } };
      audit({ userId: user.id, action: "bot.strategy.deleted", target: stratId, metadata: {}, headers: h });
      return { status: 200, body: { ok: true } };
    }
  }

  // ── Trading Bot: signals ───────────────────────────────────────────────────────
  if (pathname.startsWith("/api/bot/signals")) {
    const user = await verifyUser(h);
    if (!user) return { status: 401, body: { error: "unauthorized" } };
    if (!(await canUseTradingBot(user))) return { status: 403, body: { error: "trading_not_enabled" } };

    // GET /api/bot/signals — pending signals not yet expired
    if (method === "GET" && pathname === "/api/bot/signals") {
      const { data, error } = await sbAdmin.from("pending_signals")
        .select("*, bot_strategies(ticker, strategy_type, mode)")
        .eq("user_id", user.id)
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false });
      if (error) return { status: 500, body: { error: "db_error" } };
      return { status: 200, body: { signals: data || [] } };
    }

    // POST /api/bot/signals/:id/approve — approve and execute the signal
    const approveMatch = pathname.match(/^\/api\/bot\/signals\/([^/]+)\/approve$/);
    if (method === "POST" && approveMatch) {
      // Executing a real trade requires the non-root beta user to have consented.
      if (!(await botConsentOk(user))) return { status: 403, body: { error: "consent_required" } };
      const signalId = approveMatch[1];
      const { data: sig, error: sigErr } = await sbAdmin.from("pending_signals")
        .select("*, bot_strategies(account_id)").eq("id", signalId).eq("user_id", user.id).single();
      if (sigErr || !sig) return { status: 404, body: { error: "signal_not_found" } };
      if (sig.status !== "pending") return { status: 400, body: { error: "signal_not_pending" } };
      if (new Date(sig.expires_at) < new Date()) {
        await sbAdmin.from("pending_signals").update({ status: "expired" }).eq("id", signalId);
        return { status: 400, body: { error: "signal_expired" } };
      }

      // Sharia gate — non-negotiable
      const tickerUp = sig.ticker.toUpperCase();
      if (HARAM_TICKERS.has(tickerUp)) {
        await sbAdmin.from("pending_signals").update({ status: "rejected", error_msg: "sharia_blocked" }).eq("id", signalId);
        audit({ userId: user.id, action: "bot.signal.sharia_blocked", target: signalId, metadata: { ticker: tickerUp }, headers: h });
        return { status: 400, body: { error: "sharia_blocked", ticker: tickerUp } };
      }

      // Mark approved, then execute on the paper broker (Sharia gate re-applied inside).
      // Mark approved, then execute the REAL order via SnapTrade (Sharia gate
      // re-applied inside executeSnapTradeOrder). Layer 2 = semi-auto.
      await sbAdmin.from("pending_signals").update({ status: "approved" }).eq("id", signalId);
      audit({ userId: user.id, action: "bot.signal.approved", target: signalId, metadata: { ticker: sig.ticker, side: sig.side, layer: "semi" }, headers: h });

      const creds = await getSnapCredsForUser(user.id);
      const accountId = sig.bot_strategies?.account_id;
      const exec = creds
        ? await executeSnapTradeOrder({ ...creds, accountId, ticker: sig.ticker, side: sig.side, qty: sig.qty })
        : { ok: false, status: 400, error: "broker_not_connected" };

      if (!exec.ok) {
        // Keep status "approved" (never falsely executed); record why it didn't fill.
        await sbAdmin.from("pending_signals").update({ error_msg: String(exec.error || "execution_failed").slice(0, 300) }).eq("id", signalId);
        audit({ userId: user.id, action: "bot.signal.execute_failed", target: signalId, metadata: { ticker: sig.ticker, side: sig.side, layer: "semi", error: exec.error }, headers: h });
        warn("bot.signal.execute_failed", { signalId, status: exec.status });
        return { status: 502, body: { error: "execution_failed", detail: exec.error } };
      }
      await sbAdmin.from("pending_signals").update({ status: "executed", executed_at: new Date().toISOString() }).eq("id", signalId);
      audit({ userId: user.id, action: "bot.signal.executed", target: signalId, metadata: { ticker: sig.ticker, side: sig.side, qty: sig.qty, tradeId: exec.tradeId, layer: "semi", broker: "snaptrade", account: accountId }, headers: h });
      info("bot.signal.executed", { signalId, ticker: sig.ticker, side: sig.side });
      return { status: 200, body: { ok: true, signal_id: signalId, trade_id: exec.tradeId, broker: "snaptrade" } };
    }

    // POST /api/bot/signals/:id/reject
    const rejectMatch = pathname.match(/^\/api\/bot\/signals\/([^/]+)\/reject$/);
    if (method === "POST" && rejectMatch) {
      const signalId = rejectMatch[1];
      await sbAdmin.from("pending_signals").update({ status: "rejected" }).eq("id", signalId).eq("user_id", user.id);
      audit({ userId: user.id, action: "bot.signal.rejected", target: signalId, metadata: {}, headers: h });
      return { status: 200, body: { ok: true } };
    }
  }

  // ── Per-account full-auto opt-in (Layer 3 boundary) ──────────────────────
  // The owner deliberately enables autonomous execution for each connected
  // account; defaults to false even for the owner. Owner-gated.
  if (pathname.startsWith("/api/bot/full-auto-accounts")) {
    const user = await verifyUser(h);
    if (!user) return { status: 401, body: { error: "Unauthenticated" } };
    if (!(await canUseTradingBot(user))) return { status: 403, body: { error: "trading_not_enabled" } };

    if (method === "GET" && pathname === "/api/bot/full-auto-accounts") {
      const { data, error } = await sbAdmin.from("account_full_auto")
        .select("account_id, enabled, updated_at").eq("user_id", user.id);
      if (error) return { status: 500, body: { error: "db_error" } };
      return { status: 200, body: { accounts: data || [], master: await canUseFullAuto(user) } };
    }

    const faMatch = pathname.match(/^\/api\/bot\/full-auto-accounts\/([^/]+)$/);
    if (method === "PATCH" && faMatch) {
      // COMPLIANCE: opting an account into full-auto is owner-only.
      if (!(await isRootUser(user))) return { status: 403, body: { error: "full_auto_root_only" } };
      const accountId = decodeURIComponent(faMatch[1]);
      const enabled = !!parsed?.enabled;
      const { error } = await sbAdmin.from("account_full_auto")
        .upsert({ user_id: user.id, account_id: accountId, enabled, updated_at: new Date().toISOString() }, { onConflict: "user_id,account_id" });
      if (error) return { status: 500, body: { error: "db_error", detail: error.message } };
      audit({ userId: user.id, action: enabled ? "bot.full_auto.account_enabled" : "bot.full_auto.account_disabled", target: accountId, metadata: { account: accountId }, headers: h });
      return { status: 200, body: { ok: true, account_id: accountId, enabled } };
    }
  }

  // POST /api/bot/strategy/nl — parse natural-language strategy description into
  // a structured JSON strategy object using Claude.
  if (pathname === "/api/bot/strategy/nl" && method === "POST") {
    const user = await verifyUser(h);
    if (!user) return { status: 401, body: { error: "unauthorized" } };
    if (!(await canUseTradingBot(user))) return { status: 403, body: { error: "trading_not_enabled" } };
    if (!ANTHROPIC_KEY) return { status: 503, body: { error: "ANTHROPIC_KEY not configured" } };

    const { description, accounts = [] } = parsed;
    if (!description || typeof description !== "string" || description.trim().length < 10) {
      return { status: 400, body: { error: "description must be at least 10 characters" } };
    }

    // Each account is {id, name}. The model resolves account_id by matching the
    // broker named in the description against this list.
    const accountsStr = accounts.map(a => `${a.name || a.institution_name} (id: ${a.id})`).join(", ") || "no accounts listed";

    const systemPrompt = `You are a strategy parser for the MĪZAN halal trading bot. Convert the user's plain-English description into ONE structured JSON strategy object.

OUTPUT CONTRACT (absolute):
- Output ONLY a single JSON object. No prose, no markdown, no code fences, no commentary before or after.
- If the request cannot be honored (see REFUSALS below), output ONLY a JSON object of the shape {"error": "<one short sentence explaining why>"} and nothing else.

REFUSALS — refuse ONLY for these Sharia + risk violations (never negotiable). Return the {"error": ...} object naming which one applied:
- Anything requiring margin, leverage, buying power beyond cash, or borrowing.
- Options, futures, or any derivative.
- Short selling or any position that profits from a price decline.
- Interest-bearing instruments (bonds, money-market, conventional-finance tickers).

DO NOT REFUSE for any other reason. The following are NOT refusals — always build the closest legitimate cash-equity (spot, long-only) halal strategy and let the downstream reality-check + risk_disclosure handle expectations:
- Ambitious, aggressive, or "unrealistic" return goals ("double my money", "2x-3x it", "turn $50 into $150"). Treat the desired multiple as profit_target_pct: "double"→100, "triple"→200, "+50%"→50. NEVER refuse just because a goal looks unlikely — that is exactly what the reality-check screen is for.
- Requests phrased as questions ("which strategy can we use…", "how long will it take to 2x…"). Extract the intent and emit the strategy anyway; never answer in prose.
- Short time horizons ("next week", "by Friday"). Set time_horizon_days accordingly (minimum 1).
- Small amounts of capital (e.g. $50). Set capital_allocated to the stated amount.
- Strategy styles: swing trading, small-cap, momentum, breakout, dip-buying / mean-reversion ("buy a 5-10% dip, sell a 5-10% gain"). All are permissible long-only spot-equity strategies — encode the dip-buy entry and the take-profit in entry_rules/exit_rules, set profit_target_pct from the stated take-profit (use the higher of any range), and pick the closest strategy_type.

STRATEGY OBJECT — emit exactly these fields:
- ticker (string, uppercase): the PRIMARY symbol — the most representative name in the universe (the first candidate). Keep it Sharia-screened (no alcohol, tobacco, gambling, weapons, adult, or conventional-finance names).
- universe_tickers (array of uppercase strings): the FULL set of candidate symbols the bot may screen and pick from. If the user named specific tickers, list them all. If the user described a theme but no explicit tickers (e.g. "halal tech", "Shariah ETFs"), propose 3–8 liquid, Sharia-screened tickers that fit. If the user named exactly one ticker, return just that one. Every entry must be Sharia-compliant.
- account_id (string or null): resolve by matching the broker/account NAME mentioned in the description against this list — ${accountsStr}. Return the matching account's id. If no account is named or none matches, return null.
- strategy_type (string): one of "momentum", "ma_crossover", "breakout". Pick the closest fit to the described edge.
- capital_allocated (number, USD): how much cash to commit. 0 if unspecified.
- profit_target_pct (number): the gain at which to TAKE PROFIT. This is ONLY a take-profit level — it is NOT an input to the entry or exit edge. Never bake the target into entry_rules/exit_rules logic.
- stop_loss_pct (number, MANDATORY, > 0): max loss per position before forced exit. If the user only described upside and gave no stop, set 15. A strategy with no stop-loss is INVALID — always include a positive value.
- max_drawdown_pct (number, MANDATORY, > 0): max peak-to-trough drawdown before the strategy is paused. If unspecified, set 20.
- time_horizon_days (integer): how long to run before closing out. Default 28.
- max_trades_per_day (integer): default 3.
- position_size_pct (number): per-trade cap as a percentage of capital_allocated. Default 25.
- universe (string): plain-English description of the halal screened universe this trades within (e.g. "single halal-screened equity: <ticker>").
- entry_rules (string): plain-English description of the ACTUAL signal that opens a position — a real, testable edge (e.g. "buy when 20-day momentum turns positive and price closes above the 20-day SMA"). Do NOT reference profit_target_pct here.
- exit_rules (string): plain-English description of the signal that closes a position for reasons OTHER than the take-profit target or the stop (e.g. "exit when momentum turns negative or price closes below the 20-day SMA"). Do NOT reference profit_target_pct here.
- params (object): { "universe": <universe>, "universe_tickers": <universe_tickers>, "entry_rules": <entry_rules>, "exit_rules": <exit_rules>, "position_size_pct": <position_size_pct> } — mirror the rule text and candidate list into params so they persist in the params jsonb column and drive the screener.
- risk_disclosure (string): plain-English warning — profit_target_pct is a GOAL, not a guarantee; the position can lose up to stop_loss_pct% of capital_allocated and the strategy pauses at max_drawdown_pct% drawdown; this is not financial advice.

The entry/exit rules must express a genuine edge. The profit target only decides WHEN to take profit, never WHETHER to enter or exit on signal.

Output the JSON object only.`;

    const nlBody = JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: description.trim() }],
    });

    const nlRes = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: "api.anthropic.com",
        path: "/v1/messages",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(nlBody),
          "x-api-key": ANTHROPIC_KEY,
          "anthropic-version": "2023-06-01",
        },
      }, (res) => {
        let raw = "";
        res.on("data", c => raw += c);
        res.on("end", () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
          catch { resolve({ status: res.statusCode, body: { error: "parse_failed", raw } }); }
        });
      });
      req.on("error", reject);
      req.write(nlBody);
      req.end();
    });

    if (nlRes.status !== 200) {
      warn("bot.nl.claude_failed", { status: nlRes.status });
      return { status: 502, body: { error: "strategy_parse_failed" } };
    }

    const content = nlRes.body?.content?.[0]?.text || "";
    let parsedStrategy;
    try {
      // Claude should output only JSON, but strip any accidental markdown fences
      const cleaned = content.replace(/^```json?\n?/i, "").replace(/```$/i, "").trim();
      parsedStrategy = JSON.parse(cleaned);
    } catch {
      warn("bot.nl.parse_failed", { content });
      return { status: 422, body: { error: "could_not_parse_strategy", raw: content } };
    }

    // Refusal path: the model returns { error } for margin/options/short/leverage
    // requests. Surface it verbatim — never coerce a refused strategy into a save.
    if (parsedStrategy && typeof parsedStrategy.error === "string") {
      audit({ userId: user.id, action: "bot.strategy.nl_refused", metadata: { reason: parsedStrategy.error.slice(0, 200) }, headers: h });
      return { status: 200, body: { error: parsedStrategy.error } };
    }

    // Normalize + enforce the schema with the mandatory-risk defaults. Stop-loss
    // and max-drawdown can never be absent or non-positive.
    const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
    const posOr = (v, d) => { const n = Number(v); return (Number.isFinite(n) && n > 0) ? n : d; };
    const p = parsedStrategy || {};
    const universe        = typeof p.universe === "string" ? p.universe : (p.params?.universe || "");
    const entry_rules     = typeof p.entry_rules === "string" ? p.entry_rules : (p.params?.entry_rules || "");
    const exit_rules      = typeof p.exit_rules === "string" ? p.exit_rules : (p.params?.exit_rules || "");
    const position_size_pct = posOr(p.position_size_pct ?? p.params?.position_size_pct, 25);
    const tickerUp        = String(p.ticker || "").toUpperCase();
    // Candidate set the screener picks from — clean, dedupe, drop known-haram,
    // and guarantee the primary ticker is included.
    const rawCandidates   = Array.isArray(p.universe_tickers) ? p.universe_tickers
                            : (Array.isArray(p.params?.universe_tickers) ? p.params.universe_tickers : []);
    const universe_tickers = [...new Set([tickerUp, ...rawCandidates.map(t => String(t || "").toUpperCase().trim())].filter(Boolean))]
                              .filter(t => !HARAM_TICKERS.has(t));

    const strategy = {
      ticker:             tickerUp,
      account_id:         (typeof p.account_id === "string" && p.account_id) ? p.account_id : null,
      strategy_type:      ["momentum", "ma_crossover", "breakout"].includes(p.strategy_type) ? p.strategy_type : "momentum",
      capital_allocated:  num(p.capital_allocated, 0),
      profit_target_pct:  num(p.profit_target_pct, 10),
      stop_loss_pct:      posOr(p.stop_loss_pct, 15),       // MANDATORY — never null/<=0
      max_drawdown_pct:   posOr(p.max_drawdown_pct, 20),    // MANDATORY — never null/<=0
      time_horizon_days:  Math.max(1, Math.round(num(p.time_horizon_days, 28))),
      max_trades_per_day: Math.max(1, Math.round(num(p.max_trades_per_day, 3))),
      position_size_pct,
      layer:              "semi", // default execution layer; user can switch with the ack gate
      universe_tickers,
      params:             { universe, universe_tickers, entry_rules, exit_rules, position_size_pct, layer: "semi" },
      risk_disclosure:    typeof p.risk_disclosure === "string" ? p.risk_disclosure
                            : "Profit target is a goal, not a guarantee. This position can lose up to the stop-loss percentage of allocated capital and the strategy pauses at the max-drawdown limit. Not financial advice.",
    };

    audit({ userId: user.id, action: "bot.strategy.nl_parsed", metadata: { strategy_type: strategy.strategy_type, ticker: strategy.ticker }, headers: h });
    return { status: 200, body: { strategy, description } };
  }

  // ── Cleanup cron (90-day audit log + 24-hour rate_limits) ─
  // Vercel cron POSTs Authorization: Bearer ${CRON_SECRET}. Without the
  // secret the endpoint is unreachable, so we don't accidentally let
  // anonymous traffic trigger a destructive sweep.
  if (pathname === "/api/cron/cleanup") {
    if (cronUnauthorized(h)) { warn("cron.cleanup.unauth"); return { status: 401, body: { error: "Unauthorized" } }; }
    if (!sbAdmin) return { status: 200, body: { ok: true, skipped: "no-supabase" } };

    const ninetyDaysAgo  = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
    const oneDayAgo      = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

    let deletedAudit = 0, deletedRate = 0, deletedSecEvents = 0;
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
    try {
      const { count: s } = await sbAdmin.from("security_events")
        .delete({ count: "exact" })
        .lt("expires_at", new Date().toISOString());
      deletedSecEvents = s || 0;
    } catch (e) { warn("cron.cleanup.security_events_failed", { err: e.message }); }

    info("cron.cleanup.ok", { deleted_audit: deletedAudit, deleted_rate_limits: deletedRate, deleted_security_events: deletedSecEvents });
    // Self-record so /api/admin/db-status can surface "last cleanup ran X hours ago"
    audit({ action: "cron.cleanup", metadata: { deleted_audit: deletedAudit, deleted_rate_limits: deletedRate, deleted_security_events: deletedSecEvents }, headers: h });
    return { status: 200, body: { ok: true, deleted_audit: deletedAudit, deleted_rate_limits: deletedRate, deleted_security_events: deletedSecEvents } };
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
      sbAdmin.from("user_keys").select("finnhub_key, polygon_key, finnhub_key_ciphertext, finnhub_key_iv, finnhub_key_auth_tag, polygon_key_ciphertext, polygon_key_iv, polygon_key_auth_tag, encrypted, updated_at").eq("user_id", user.id).maybeSingle(),
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
      user_keys:      (() => {
        const k = userKeys.data;
        if (!k) return null;
        const decryptField = (field) => {
          const ct = k[`${field}_ciphertext`];
          const iv = k[`${field}_iv`];
          const at = k[`${field}_auth_tag`];
          if (ct && iv && at) { try { return decryptSecret({ ciphertext: ct, iv, authTag: at }); } catch { return null; } }
          return k[field] || null;
        };
        return { finnhub_key: decryptField("finnhub_key"), polygon_key: decryptField("polygon_key"), updated_at: k.updated_at };
      })(),
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
        .select(SNAP_SECRET_COLS).eq("user_id", user.id).maybeSingle();
      const delSecret = row ? extractUserSecret(row) : null;
      if (delSecret) {
        await snapReq("DELETE", "/snapTrade/deleteUser", null, {
          userId: row.snaptrade_user_id, userSecret: delSecret,
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
    if (cronUnauthorized(h)) return { status: 401, body: { error: "Unauthorized" } };
    if (!sbAdmin) {
      return { status: 200, body: { ok: true, synced: 0, skipped: "no-supabase" } };
    }

    const { data: users, error: usersErr } = await sbAdmin
      .from("user_snaptrade")
      .select(`user_id, ${SNAP_SECRET_COLS}`);
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
        const uSecret = extractUserSecret(u);
        if (!uSecret) throw new Error(`no secret for user_id=${u.user_id}`);
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
            userSecret: uSecret,
          });
          const auths = Array.isArray(authsRes.body) ? authsRes.body : [];
          const results = await Promise.allSettled(auths.map(a =>
            snapReq("POST", `/authorizations/${a.id}/refresh`, null, {
              userId: u.snaptrade_user_id,
              userSecret: uSecret,
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
          userSecret: uSecret,
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

    // Audit the successful run so the cron-staleness detector and the admin
    // "last sync" display have a real signal. (Previously this only emitted an
    // info() log, so checkCronStaleness — which reads audit_log for
    // action="cron.sync" — always saw Infinity and false-alarmed.)
    audit({ action: "cron.sync", metadata: { synced, failed, refreshed, refreshFailed, total: (users || []).length, plaid: { items: plaidItems, ok: plaidOk, failed: plaidFailed } }, headers: h });

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
    if (cronUnauthorized(h)) return { status: 401, body: { error: "Unauthorized" } };
    if (!sbAdmin) return { status: 200, body: { ok: true, skipped: "no-supabase" } };

    let processed = 0, failed = 0;
    let lastErr = null;
    try {
      const { data: users, error: usersErr } = await sbAdmin
        .from("user_snaptrade")
        .select(`user_id, ${SNAP_SECRET_COLS}`);
      if (usersErr) throw new Error(`user_snaptrade select: ${usersErr.message}`);

      const today = new Date().toISOString().slice(0, 10);

      for (const u of (users || [])) {
        try {
          const uSecret = extractUserSecret(u);
          if (!uSecret) { warn("cron.snapshot.no_secret", { user_id: u.user_id }); continue; }
          const acctRes = await snapReq("GET", "/accounts", null, {
            userId: u.snaptrade_user_id,
            userSecret: uSecret,
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
    if (cronUnauthorized(h)) return { status: 401, body: { error: "Unauthorized" } };
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

  // ── Purification calculate ──────────────────────────────
  // Returns per-dividend purification items for the authenticated user.
  // Pulls SnapTrade dividend activities, cross-references with the
  // purification_ratios table, applies any user overrides stored in
  // user_state, and returns a flat list the UI uses to render the
  // purification ledger.  The purification log (which items have been
  // marked as donated) lives client-side in mizan_purification_log so
  // the status determination stays in the browser layer.
  if (pathname === "/api/purification/calculate") {
    if (!sbAdmin) return { status: 503, body: { error: "Database not configured" } };

    const user = await verifyUser(h);
    if (!user) return { status: 401, body: { error: "Authentication required" } };

    const year = (q.year || String(new Date().getFullYear())).replace(/\D/g, "").slice(0, 4);
    const from = `${year}-01-01`;
    const to   = `${year}-12-31`;

    // Load purification ratios from DB
    const { data: ratioRows } = await sbAdmin
      .from("purification_ratios")
      .select("ticker, impurity_pct, source");
    const ratioMap = {};
    (ratioRows || []).forEach(r => { ratioMap[r.ticker.toUpperCase()] = r; });

    // Load user's per-ticker overrides from user_state
    let overrides = {};
    try {
      const { data: ovRow } = await sbAdmin
        .from("user_state")
        .select("value")
        .eq("user_id", user.id)
        .eq("key", "mizan_purification_overrides")
        .maybeSingle();
      if (ovRow?.value) {
        const v = typeof ovRow.value === "string" ? JSON.parse(ovRow.value) : ovRow.value;
        if (v && typeof v === "object") overrides = v;
      }
    } catch { /* overrides stay empty */ }

    // Fetch SnapTrade dividend activities for the year
    let activities = [];
    try {
      const snap = await getSnapForRequest(h);
      const r = await snapReq("GET", "/activities", null, {
        userId: snap.userId, userSecret: snap.userSecret,
        startDate: from, endDate: to,
      });
      activities = Array.isArray(r.body) ? r.body : (r.body?.activities || []);
    } catch { /* SnapTrade not connected — items will be empty */ }

    const DIVIDEND_TYPES = new Set(["DIVIDEND", "CDIV", "GDIV", "QDIV", "DIV", "DFEE"]);
    const DEFAULT_PCT = 1.5;

    // Parse dividend rows first so we can resolve impurity %s (some async).
    const rows = activities
      .filter(a => DIVIDEND_TYPES.has((a.type || "").toUpperCase()))
      .map(a => {
        const ticker    = ((a.symbol?.symbol || a.symbol || a.currency || "")).toUpperCase();
        const date      = a.trade_date || a.settlement_date || "";
        const divAmount = Math.abs(+(a.amount ?? a.price ?? 0));
        if (!ticker || divAmount === 0) return null;
        return { ticker, date, divAmount, tk: ticker.toUpperCase(), fp: `${ticker}_${date}_${divAmount.toFixed(2)}` };
      })
      .filter(Boolean);

    // For dividend tickers not covered by a user override or the issuer ratio
    // table, ask the screening provider for a real non-permissible-income %.
    // Finnhub can't supply it (returns null), so only spend calls when the
    // active provider actually can — keeps the Finnhub path call-free.
    const screenNonPerm = {};
    if (activeShariaProvider() === "zoya") {
      const uncovered = [...new Set(rows.map(r => r.tk).filter(tk => overrides[tk] == null && !ratioMap[tk]))];
      if (uncovered.length) {
        const screened = await screenBatch(uncovered);
        Object.entries(screened).forEach(([tk, v]) => { if (Number.isFinite(v?.nonPermPct)) screenNonPerm[tk] = +v.nonPermPct; });
      }
    }

    const items = rows
      .map(({ ticker, date, divAmount, tk, fp }) => {
        let impurityPct = DEFAULT_PCT;
        let ratioSource = "default estimate — verify with scholar";
        if (overrides[tk] != null && Number.isFinite(+overrides[tk])) {
          impurityPct = +overrides[tk];
          ratioSource = "user override";
        } else if (ratioMap[tk]) {
          impurityPct = +ratioMap[tk].impurity_pct;
          ratioSource = ratioMap[tk].source;
        } else if (screenNonPerm[tk] != null) {
          impurityPct = screenNonPerm[tk];
          ratioSource = `${activeShariaProvider()} non-permissible income`;
        }

        return {
          fingerprint:      fp,
          ticker,
          date,
          dividendAmount:   divAmount,
          impurityPct,
          purificationOwed: +(divAmount * (impurityPct / 100)).toFixed(4),
          ratioSource,
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date));

    info("purification.calculate.ok", { userId: user.id, year, items: items.length });
    return { status: 200, body: { items, year } };
  }

  // ── Dividend check cron ─────────────────────────────────
  // Pulls tomorrow's dividend calendar from Finnhub, inserts one
  // audit_log row per upcoming ex-date so the UI can surface "upcoming
  // dividends in your watchlist" without re-fetching. Cheap: one
  // Finnhub call per day. Schedule: 11:00 UTC daily.
  if (pathname === "/api/cron/dividend-check") {
    if (cronUnauthorized(h)) return { status: 401, body: { error: "Unauthorized" } };
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

      // Push purification notifications for halal ETFs / known tickers.
      // For each upcoming dividend from a ticker in our purification_ratios
      // table, notify all users who have push subscriptions. Idempotency is
      // enforced via audit_log (action: "purification.notif_sent").
      if (items.length > 0) {
        const { data: ratioRows } = await sbAdmin
          .from("purification_ratios")
          .select("ticker, impurity_pct");
        const knownTickers = new Set((ratioRows || []).map(r => r.ticker.toUpperCase()));
        const ratioLookup = {};
        (ratioRows || []).forEach(r => { ratioLookup[r.ticker.toUpperCase()] = +r.impurity_pct; });

        const purifyItems = items.filter(d => {
          const tk = (d.symbol || d.ticker || "").toUpperCase();
          return knownTickers.has(tk) && d.amount > 0;
        });

        if (purifyItems.length > 0) {
          const { data: subs } = await sbAdmin
            .from("push_subscriptions")
            .select("user_id")
            .limit(200);
          const userIds = [...new Set((subs || []).map(s => s.user_id))];

          for (const userId of userIds) {
            for (const d of purifyItems) {
              const tk  = (d.symbol || d.ticker || "").toUpperCase();
              const pct = ratioLookup[tk] || 1.5;
              const est = (+(d.amount || 0) * pct / 100).toFixed(4);

              const { data: dup } = await sbAdmin.from("audit_log")
                .select("id").eq("user_id", userId).eq("action", "purification.notif_sent")
                .eq("target", tk).contains("metadata", { ex_date: d.date || tomorrow }).limit(1);
              if (dup && dup.length > 0) continue;

              await sbAdmin.from("audit_log").insert({
                user_id: userId, action: "purification.notif_sent", target: tk,
                metadata: { ticker: tk, ex_date: d.date || tomorrow, dividend: d.amount, pct, est },
              }); // best-effort; Supabase resolves with { error }, never rejects

              await sendPushToUser(sbAdmin, userId, {
                title: `Dividend purification — ${tk}`,
                body:  `${tk} dividend ex-date tomorrow · ~$${est} purification suggested`,
                url:   "/?tab=goals&sub=zakat",
              }).catch(() => {});
            }
          }
        }
      }
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
    if (cronUnauthorized(h)) return { status: 401, body: { error: "Unauthorized" } };
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
    const symbolUp = String(symbol || "").toUpperCase();
    const result = await placeAlpacaOrder({ symbol, qty, side, type, limitPrice });
    if (result.sharia_blocked) {
      audit({ userId: user.id, action: "alpaca.order_blocked", target: symbolUp, metadata: { reason: "haram_precheck" }, headers: h });
      return { status: 403, body: { error: result.error } };
    }
    if (!result.ok) {
      warn("alpaca.order.failed", { status: result.status, symbol: symbolUp });
      return { status: result.status, body: result.json || { error: result.error } };
    }
    audit({
      userId: user.id,
      action: "alpaca.order_placed",
      target: symbolUp,
      metadata: { qty, side, type, limitPrice: limitPrice ?? null, orderId: result.orderId },
      headers: h,
    });
    info("alpaca.order.ok", { symbol: symbolUp, qty, side, type });
    return { status: 200, body: result.json };
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

  // POST /api/cron/bot-signals — evaluate enabled strategies and generate/execute signals.
  // Runs every 15 min during market hours (Mon–Fri 9–16 UTC, see vercel.json).
  // Full-auto: signals are executed immediately if sharia gate passes.
  // Semi-auto: signals are created as pending and push notification sent.
  if (pathname === "/api/cron/bot-signals" && (method === "GET" || method === "POST")) {
    if (cronUnauthorized(h)) return { status: 401, body: { error: "Unauthorized" } };
    if (!sbAdmin) return { status: 200, body: { ok: true, skipped: "no-supabase" } };

    info("cron.bot_signals.start");

    // Expire stale pending signals first. (Supabase filter builders are
    // thenable but have no .catch(); destructure { error } instead.)
    const { error: expireErr } = await sbAdmin.from("pending_signals")
      .update({ status: "expired" })
      .eq("status", "pending")
      .lt("expires_at", new Date().toISOString());
    if (expireErr) warn("bot.signals.expire_failed", { err: expireErr.message });

    // Reset daily trade counts if date has changed
    const todayDate = new Date().toISOString().slice(0, 10);
    const { error: resetErr } = await sbAdmin.from("bot_strategies")
      .update({ trades_today: 0, trades_today_date: todayDate })
      .eq("enabled", true)
      .neq("trades_today_date", todayDate);
    if (resetErr) warn("bot.signals.reset_counts_failed", { err: resetErr.message });

    // Get all enabled strategies
    const { data: strategies, error: stratErr } = await sbAdmin
      .from("bot_strategies")
      .select("*, profiles!user_id(full_auto_enabled)")
      .eq("enabled", true);

    if (stratErr || !strategies?.length) {
      info("cron.bot_signals.no_strategies", { count: strategies?.length || 0 });
      return { status: 200, body: { ok: true, processed: 0 } };
    }

    let signalsGenerated = 0, autoExecuted = 0, sharaBlocked = 0;

    for (const strat of strategies) {
      try {
        // Daily cap check
        if (strat.trades_today >= strat.max_trades_per_day) continue;

        // Effective execution LAYER — manual | semi | full. This is the user's
        // per-strategy choice (params.layer); fall back to the DB mode column
        // for strategies created before layers existed. Full-auto execution is
        // gated separately on the DB mode='full' + master switch + per-account
        // opt-in, so a tampered params.layer can never bypass the safety gates.
        const layer = ["manual", "semi", "full"].includes(strat.params?.layer)
          ? strat.params.layer : (strat.mode === "full" ? "full" : "semi");
        const isFullAuto = strat.mode === "full"
          && !!strat.profiles?.full_auto_enabled
          && await accountFullAutoEnabled(strat.user_id, strat.account_id);

        const pos = await botPositionFromSignals(strat.id);

        // ── EXIT ENGINE (runs first) ────────────────────────────────────────
        // If we hold a net-open position, evaluate stop-loss / drawdown / target
        // / horizon against the HELD ticker (the one the screener picked), and
        // never open a second position while one is open. Buys come only from the
        // screener below; SELLs come only from here (no shorting — that's haram).
        if (pos.netQty > 0 && pos.avgEntry && pos.avgEntry > 0) {
          const heldTicker = (pos.ticker || strat.ticker || "").toUpperCase();
          const q = await finnhubQuote(heldTicker);
          if (!q) continue; // can't evaluate exits without a fresh quote — skip safely
          const currentPrice = q.current;
          const gainPct = ((currentPrice - pos.avgEntry) / pos.avgEntry) * 100;

          // Creates a SELL pending_signal, then executes (full-auto) or notifies.
          // Sharia gate stays in the execution path via executeSnapTradeOrder.
          const exitClose = async (reason, pushTitle, pushBody) => {
            const { data: xsig, error: xErr } = await sbAdmin.from("pending_signals").insert({
              user_id: strat.user_id, strategy_id: strat.id, ticker: heldTicker,
              side: "sell", qty: pos.netQty, suggested_price: currentPrice,
              sharia_passed: true, status: "pending",
            }).select().single();
            if (xErr) { warn("bot.exit.insert_failed", { err: xErr.message, strategy_id: strat.id }); return false; }
            signalsGenerated++;
            if (isFullAuto) {
              const creds = await getSnapCredsForUser(strat.user_id);
              const exec = creds
                ? await executeSnapTradeOrder({ ...creds, accountId: strat.account_id, ticker: heldTicker, side: "sell", qty: pos.netQty })
                : { ok: false, status: 400, error: "broker_not_connected" };
              if (exec.ok) {
                await sbAdmin.from("pending_signals").update({ status: "executed", executed_at: new Date().toISOString() }).eq("id", xsig.id);
                autoExecuted++;
                audit({ userId: strat.user_id, action: reason, target: xsig.id, metadata: { ticker: heldTicker, qty: pos.netQty, price: currentPrice, gainPct, layer: "full", broker: "snaptrade", account: strat.account_id }, headers: {} });
              } else {
                await sbAdmin.from("pending_signals").update({ error_msg: String(exec.error || "execution_failed").slice(0, 300) }).eq("id", xsig.id);
                audit({ userId: strat.user_id, action: reason + ".execute_failed", target: xsig.id, metadata: { ticker: heldTicker, qty: pos.netQty, error: exec.error }, headers: {} });
                warn("bot.exit.execute_failed", { strategy_id: strat.id, signal_id: xsig.id, status: exec.status });
              }
            } else {
              audit({ userId: strat.user_id, action: reason, target: xsig.id, metadata: { ticker: heldTicker, qty: pos.netQty, price: currentPrice, gainPct, layer }, headers: {} });
            }
            // Manual layer: no push (you check the panel). Semi/full: notify.
            if (layer !== "manual") await sendPushToUser(sbAdmin, strat.user_id, { title: pushTitle, body: pushBody, url: "/trade" }).catch(() => {});
            return true;
          };

          const ageDays = strat.created_at ? (Date.now() - new Date(strat.created_at).getTime()) / 86400000 : 0;
          const hitStop = gainPct <= -Math.abs(Number(strat.stop_loss_pct) || 0);
          const hitDrawdown = gainPct <= -Math.abs(Number(strat.max_drawdown_pct) || 0);
          const hitHorizon = (Number(strat.time_horizon_days) || 0) > 0 && ageDays > Number(strat.time_horizon_days);
          const hitTarget = (Number(strat.profit_target_pct) || 0) > 0 && gainPct >= Number(strat.profit_target_pct);

          if (hitStop || hitDrawdown) {
            // Non-negotiable: overrides the profit target. Exit and PAUSE.
            await exitClose("bot.strategy.stopped_out",
              `Stop-loss hit on ${heldTicker} — strategy paused`,
              `Down ${gainPct.toFixed(1)}% from entry. Position closed and strategy paused.`);
            await sbAdmin.from("bot_strategies").update({ enabled: false, updated_at: new Date().toISOString() }).eq("id", strat.id);
          } else if (hitHorizon) {
            await exitClose("bot.strategy.horizon_closed",
              `Horizon reached on ${heldTicker} — closed out`,
              `Time horizon of ${strat.time_horizon_days}d reached. Position closed out.`);
            await sbAdmin.from("bot_strategies").update({ enabled: false, updated_at: new Date().toISOString() }).eq("id", strat.id);
          } else if (hitTarget) {
            await exitClose("bot.strategy.target_hit",
              `Target reached on ${heldTicker} — sell?`,
              `Up ${gainPct.toFixed(1)}% (target ${strat.profit_target_pct}%). Locking in profit.`);
          }
          // Whether or not an exit fired, never open a second position while one
          // is held. One name at a time keeps position accounting unambiguous.
          continue;
        }

        // ── ENTRY ENGINE: screen the halal universe and PICK the best name ───
        // This is the "bot picks the ticker" behavior. Score every candidate by
        // day momentum (the free-tier quote is the live proxy for the edge), take
        // the strongest above the buy threshold, and size it from allocated
        // capital. The user never types a symbol, quantity, or price.
        const universe = strategyUniverse(strat);
        if (!universe.length) { sharaBlocked++; continue; }
        const BUY_THRESHOLD = 0.015; // +1.5% day momentum opens a position
        let best = null; // { ticker, price, score }
        for (const cand of universe) {
          const q = await finnhubQuote(cand);
          if (!q || !q.prevClose) continue;
          const score = (q.current - q.prevClose) / q.prevClose;
          if (score >= BUY_THRESHOLD && (!best || score > best.score)) best = { ticker: cand, price: q.current, score };
        }
        if (!best) continue; // nothing in the universe triggered an entry this tick

        const tickerUp = best.ticker;
        const currentPrice = best.price;
        const side = "buy";

        // Position size: position_size_pct of allocated capital when set, else an
        // even split across the daily trade cap. Never exceeds allocated capital.
        const sizePct = Number(strat.params?.position_size_pct) || 0;
        const dollars = sizePct > 0
          ? strat.capital_allocated * (sizePct / 100)
          : strat.capital_allocated / Math.max(1, strat.max_trades_per_day);
        const qty = Math.floor(dollars / currentPrice * 100) / 100;
        if (qty <= 0) continue;

        // Create the pending BUY signal on the picked ticker.
        const { data: signal, error: sigErr } = await sbAdmin.from("pending_signals").insert({
          user_id: strat.user_id,
          strategy_id: strat.id,
          ticker: tickerUp,
          side,
          qty,
          suggested_price: currentPrice,
          sharia_passed: true,
          status: "pending",
        }).select().single();

        if (sigErr) { warn("bot.signal.insert_failed", { err: sigErr.message }); continue; }
        signalsGenerated++;

        // Layer 3 — Full-auto: execute immediately via SnapTrade only when the DB
        // mode='full' AND the profile master switch is on AND THIS account was
        // explicitly opted in. The Sharia gate runs again in executeSnapTradeOrder.
        if (isFullAuto) {
          const creds = await getSnapCredsForUser(strat.user_id);
          const exec = creds
            ? await executeSnapTradeOrder({ ...creds, accountId: strat.account_id, ticker: tickerUp, side, qty })
            : { ok: false, status: 400, error: "broker_not_connected" };
          if (exec.ok) {
            await sbAdmin.from("pending_signals").update({ status: "executed", executed_at: new Date().toISOString() }).eq("id", signal.id);
            await sbAdmin.from("bot_strategies").update({ trades_today: strat.trades_today + 1, trades_today_date: todayDate }).eq("id", strat.id);
            audit({ userId: strat.user_id, action: "bot.signal.auto_executed", target: signal.id, metadata: { ticker: tickerUp, side, qty, price: currentPrice, tradeId: exec.tradeId, layer: "full", broker: "snaptrade", account: strat.account_id }, headers: {} });
            autoExecuted++;
            await sendPushToUser(sbAdmin, strat.user_id, {
              title: `Bot auto-executed: ${side.toUpperCase()} ${qty} ${tickerUp}`,
              body: `Executed at ~$${currentPrice.toFixed(2)} via SnapTrade. Tap to review.`,
              url: "/trade",
            }).catch(() => {});
          } else {
            // Execution failed — leave the signal pending so it can still be
            // approved/retried manually, and record why.
            await sbAdmin.from("pending_signals").update({ error_msg: String(exec.error || "execution_failed").slice(0, 300) }).eq("id", signal.id);
            audit({ userId: strat.user_id, action: "bot.signal.auto_execute_failed", target: signal.id, metadata: { ticker: tickerUp, side, qty, layer: "full", error: exec.error }, headers: {} });
            warn("bot.signal.auto_execute_failed", { strategy_id: strat.id, signal_id: signal.id, status: exec.status });
          }
        } else {
          // Layer 1 (manual) / Layer 2 (semi): the signal waits for your tap.
          // Semi pushes you to approve; manual stays quiet in the panel.
          audit({ userId: strat.user_id, action: "bot.signal.generated", target: signal.id, metadata: { ticker: tickerUp, side, qty, price: currentPrice, layer }, headers: {} });
          if (layer === "semi") await sendPushToUser(sbAdmin, strat.user_id, {
            title: `Bot suggests: ${side.toUpperCase()} ${qty} ${tickerUp}`,
            body: `Tap to review and approve this trade signal.`,
            url: "/trade",
          }).catch(() => {});
        }
      } catch (e) {
        warn("bot.signal.strategy_failed", { strategy_id: strat.id, err: e.message });
      }
    }

    info("cron.bot_signals.done", { signalsGenerated, autoExecuted, sharaBlocked });
    return { status: 200, body: { ok: true, signalsGenerated, autoExecuted, sharaBlocked } };
  }

  return { status: 404, body: { error: "Not found" } };
}
