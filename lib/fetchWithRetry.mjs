/**
 * MĪZAN — fetch with retry + backoff.
 *
 * Wraps the native fetch() with:
 *   - exponential backoff on 5xx + network errors
 *   - 429-aware sleep that honors the Retry-After header (capped at 30s)
 *   - structured warn/error logging for every retry + final failure
 *
 * Does NOT replace SnapTrade's https.request-based snapReq() — that path
 * is HMAC-signed and has a different shape. Use this helper for new
 * upstream calls (Alpaca, Finnhub dividend calendar, etc).
 */

import { warn, error as logError } from "./logger.mjs";

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Strip the query string (which may carry API keys, e.g. ?token=…) before a URL
// is written to logs. Keeps the endpoint visible for debugging without leaking secrets.
function safeUrl(u) {
  try { const p = new URL(u); return p.origin + p.pathname; }
  catch { return String(u).split("?")[0]; }
}

export async function fetchWithRetry(url, options = {}, { maxRetries = 3, baseDelayMs = 500 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get("Retry-After") || "60") * 1000;
        const delay = Math.min(retryAfter, 30_000);
        warn("fetch_retry", { url: safeUrl(url), attempt, status: 429, delayMs: delay });
        await sleep(delay);
        continue;
      }
      if (res.status >= 500 && attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 200;
        warn("fetch_retry", { url: safeUrl(url), attempt, status: res.status, delayMs: Math.round(delay) });
        await sleep(delay);
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) await sleep(baseDelayMs * Math.pow(2, attempt) + Math.random() * 200);
    }
  }
  logError("fetch_failed", { url: safeUrl(url), attempts: maxRetries + 1, err: lastError?.message });
  throw lastError || new Error(`fetchWithRetry exhausted: ${safeUrl(url)}`);
}
