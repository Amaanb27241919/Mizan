/**
 * MĪZAN — symbol typeahead helpers (pure, no I/O).
 *
 * Backs the Screener's "screen any ticker" lookup: the user types a company
 * name or a partial ticker and gets matching symbols to pick from.
 *
 * Side-effect free (no env reads, no network, no Supabase) so it is unit
 * testable in isolation and so the impersonal-data contract stays easy to
 * verify: every function here is a PURE FUNCTION of its arguments, so no user
 * identity can influence the output. See docs/COMPLIANCE.md.
 *
 * COMPLIANCE NOTE — this is a NAME MATCHER, not a recommender. Results are
 * whatever the data provider returns for the typed string, ordered by how well
 * the text matches, and never by any judgment about the investment. It must
 * stay that way: ordering these by desirability, or attaching a halal verdict
 * to each suggestion so the list reads as a curated set of halal names to buy,
 * would convert an impersonal lookup into a personalized recommendation. The
 * verdict is shown only AFTER the user picks one symbol.
 */

import { SYMBOL_RE } from "./candles.mjs";

// Longest query we'll forward upstream. Company names are short; anything
// longer is a paste or an abuse attempt, not a search.
export const MAX_QUERY_LEN = 40;

// Suggestions shown. Small on purpose — a typeahead is for recognizing the
// name you already had in mind, not for browsing a universe.
export const MAX_SUGGESTIONS = 8;

/**
 * Validate + canonicalize a raw typeahead query.
 * @param {unknown} raw
 * @returns {{ok: true, q: string} | {ok: false, error: string}}
 */
export function normalizeQuery(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return { ok: false, error: "q is required" };
  if (s.length > MAX_QUERY_LEN) return { ok: false, error: "q too long" };
  // Letters, digits, space and the few punctuation marks that legitimately
  // appear in company names (&, ., -, '). Everything else is stripped rather
  // than rejected, so a stray character doesn't blank the dropdown mid-typing.
  const cleaned = s.replace(/[^A-Za-z0-9 &.\-']/g, "").trim();
  if (!cleaned) return { ok: false, error: "q is required" };
  return { ok: true, q: cleaned };
}

// Instrument types we surface. Finnhub returns a long tail of warrants, rights,
// units and preferred lines that are noise in a halal-screening context and
// mostly can't be screened anyway. Empty type is allowed through — Finnhub
// leaves it blank for some legitimate listings.
const ALLOWED_TYPES = new Set([
  "", "Common Stock", "ADR", "ETP", "ETF", "REIT", "Mutual Fund", "Unit",
]);

/**
 * Shape Finnhub's /search payload into the client's suggestion list.
 *
 * Finnhub returns { count, result: [{ description, displaySymbol, symbol, type }] }.
 * We key on `symbol` because that is what /api/screen expects, and drop
 * anything SYMBOL_RE rejects — a suggestion the screener then can't screen is
 * worse than no suggestion. Note SYMBOL_RE deliberately ALLOWS dots: class
 * shares come back as BRK.A / BRK.B and are perfectly screenable.
 *
 * @param {unknown} body Raw Finnhub response
 * @param {{limit?: number}} [opts]
 * @returns {Array<{symbol: string, name: string, type: string}>}
 */
export function normalizeSymbolSearch(body, { limit = MAX_SUGGESTIONS } = {}) {
  const rows = Array.isArray(body?.result) ? body.result : [];
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (out.length >= limit) break;
    const symbol = String(r?.symbol ?? "").trim().toUpperCase();
    const name = String(r?.description ?? "").trim();
    const type = String(r?.type ?? "").trim();
    if (!symbol || !name) continue;
    if (!SYMBOL_RE.test(symbol)) continue;   // exchange-suffixed / malformed
    if (!ALLOWED_TYPES.has(type)) continue;
    if (seen.has(symbol)) continue;
    seen.add(symbol);
    out.push({ symbol, name, type });
  }
  return out;
}
