/**
 * MĪZAN — market candle helpers (pure, no I/O).
 *
 * Validation + normalization for the price-chart data layer. Kept side-effect
 * free (no env reads, no network, no Supabase) so it is unit-testable in
 * isolation and so the impersonal-data contract is easy to reason about:
 * every function here is a PURE FUNCTION of its arguments — no user identity
 * can influence the output. See docs/COMPLIANCE.md.
 *
 * The chart is fed by Polygon aggregate bars (already proxied + 24h-cached in
 * lib/handlers.mjs). Finnhub's free tier does not expose /stock/candle, so
 * Polygon — which the backtester already uses — is the OHLC source.
 */

// Chart resolution → Polygon (multiplier, timespan). The chart's timeframe
// selector chooses a resolution + date window; the server maps it here.
export const CANDLE_RESOLUTIONS = {
  "1":  { multiplier: 1,  timespan: "minute" },
  "5":  { multiplier: 5,  timespan: "minute" },
  "15": { multiplier: 15, timespan: "minute" },
  "30": { multiplier: 30, timespan: "minute" },
  "60": { multiplier: 1,  timespan: "hour"   },
  "D":  { multiplier: 1,  timespan: "day"    },
  "W":  { multiplier: 1,  timespan: "week"   },
  "M":  { multiplier: 1,  timespan: "month"  },
};

// Ticker shape accepted by the market routes. Deliberately conservative:
// 1–10 chars, starts with a letter, allows dots/hyphens for class shares
// (BRK.B) and some ADRs. Rejects anything that could be a path/query-injection
// vector before it reaches the upstream URL.
export const SYMBOL_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Bound the requested window. Polygon free tier gives ~2yr; allow a little
// headroom for the 5Y timeframe on paid keys, but never an unbounded span.
export const MAX_RANGE_DAYS = 6 * 366;

/**
 * Validate + normalize a candle request. Returns either { error } or a fully
 * resolved, bounded request: { symbol, resolution, from, to, multiplier, timespan }.
 * Pure — depends only on `q` (and today's date for defaulting the window).
 *
 * @param {{ symbol?: string, resolution?: string, from?: string, to?: string }} q
 * @param {Date} [now] injectable clock for deterministic tests
 */
export function validateCandleQuery(q = {}, now = new Date()) {
  const symbol = String(q.symbol || "").toUpperCase();
  if (!SYMBOL_RE.test(symbol)) return { error: "invalid symbol" };

  const resolution = String(q.resolution || "D");
  const res = CANDLE_RESOLUTIONS[resolution];
  if (!res) return { error: "invalid resolution" };

  const to = DATE_RE.test(q.to || "") ? q.to : now.toISOString().slice(0, 10);
  let from = DATE_RE.test(q.from || "") ? q.from : null;
  if (!from) {
    const d = new Date(to + "T00:00:00Z");
    d.setUTCFullYear(d.getUTCFullYear() - 1);
    from = d.toISOString().slice(0, 10);
  }
  if (from > to) return { error: "from must be on or before to" };
  const spanDays = (Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86_400_000;
  if (!Number.isFinite(spanDays) || spanDays > MAX_RANGE_DAYS) return { error: "range too large" };

  return { symbol, resolution, from, to, multiplier: res.multiplier, timespan: res.timespan };
}

/**
 * Cache-column value for a (multiplier, timespan) pair. Daily/weekly/monthly
 * bars (multiplier 1) reuse the plain timespan so they share the backtester's
 * existing polygon_cache rows; sub-day multipliers get a distinct key so a
 * 5-minute fetch can never collide with a 1-minute one.
 */
export function cacheTimespan(multiplier, timespan) {
  return multiplier === 1 ? timespan : `${multiplier}${timespan}`;
}

/**
 * Normalize Polygon aggregate results → lightweight-charts candles.
 * Polygon `t` is epoch ms; lightweight-charts wants epoch SECONDS. Drops any
 * malformed bar rather than emitting NaN into the chart.
 *
 * @param {Array<{t:number,o:number,h:number,l:number,c:number,v:number}>} bars
 * @returns {Array<{time:number,open:number,high:number,low:number,close:number,volume:number}>}
 */
export function normalizeBars(bars = []) {
  if (!Array.isArray(bars)) return [];
  return bars
    .filter(b => b && Number.isFinite(b.t) && Number.isFinite(b.c) &&
      Number.isFinite(b.o) && Number.isFinite(b.h) && Number.isFinite(b.l))
    .map(b => ({
      time: Math.floor(b.t / 1000),
      open: b.o, high: b.h, low: b.l, close: b.c,
      volume: Number.isFinite(b.v) ? b.v : 0,
    }));
}
