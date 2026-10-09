/**
 * Pure (no I/O): Market Packet sections built from data the research panel
 * ALREADY holds — the ranking's daily bars, the Sharia screen, the earnings
 * calendar. Found 2026-10-09: every panel round since 2026-10-07 went out with
 * "NOT AVAILABLE: benchmark, events, identity, returns" because the panel
 * never passed them to buildMarketPacket, and the models were (correctly)
 * answering INSUFFICIENT_DATA for want of evidence that was sitting in memory.
 *
 * Each builder returns null when it genuinely has nothing — the packet then
 * lists the section under NOT AVAILABLE, which is the honest outcome. A
 * builder never invents a number to fill a section.
 */
const arr = (v) => (Array.isArray(v) ? v : []);
const closes = (series) => arr(series).map((b) => Number(b?.c)).filter((c) => Number.isFinite(c) && c > 0);
const pct = (now, then) => (then > 0 ? Math.round(((now / then) - 1) * 10000) / 100 : null);
const LOOKBACK = { d1: 1, d5: 5, m1: 21, m3: 63, m6: 126, m12: 252 };

/** Trailing returns in percent from daily bars (adjusted). Null with fewer than 2 closes. */
export function returnsFromBars(series) {
  const c = closes(series);
  if (c.length < 2) return null;
  const last = c[c.length - 1];
  const out = {};
  for (const [k, n] of Object.entries(LOOKBACK)) out[k] = c.length > n ? pct(last, c[c.length - 1 - n]) : null;
  return out;
}

/** Moving averages and the deepest peak-to-trough fall over the last year. */
export function technicalFromBars(series, extra) {
  const c = closes(series);
  if (c.length < 20) return null;
  const sma = (n) => (c.length >= n ? Math.round((c.slice(-n).reduce((a, b) => a + b, 0) / n) * 100) / 100 : null);
  let peak = -Infinity, dd = 0;
  for (const x of c.slice(-252)) { peak = Math.max(peak, x); dd = Math.min(dd, x / peak - 1); }
  const e = extra && typeof extra === "object" ? extra : {};
  return { sma20: sma(20), sma50: sma(50), sma200: sma(200), max_drawdown_pct: Math.round(dd * 10000) / 100,
    momentum_252d_pct: Number.isFinite(e.momentum_252d_pct) ? e.momentum_252d_pct : null,
    volatility_annual_pct: Number.isFinite(e.volatility_annual_pct) ? e.volatility_annual_pct : null };
}

/** The symbol's 12-month return against the benchmark's over the same bars. */
export function benchmarkFromBars(series, benchSeries, benchSymbol = "SPUS") {
  const s = closes(series), b = closes(benchSeries);
  if (b.length <= 252) return null;
  const bm12 = pct(b[b.length - 1], b[b.length - 253]);
  const sm12 = s.length > 252 ? pct(s[s.length - 1], s[s.length - 253]) : null;
  return { symbol: benchSymbol, return_m12_pct: bm12, relative_m12_pct: sm12 !== null && bm12 !== null ? Math.round((sm12 - bm12) * 100) / 100 : null };
}

/** What the screen already knows about the company. Null when it knows nothing. */
export function identityFromScreen(screen) {
  const s = screen && typeof screen === "object" ? screen : null;
  const sector = s && typeof s.industry === "string" && s.industry.trim() ? s.industry.trim() : null;
  const name = s && typeof s.name === "string" && s.name.trim() ? s.name.trim() : null;
  if (!sector && !name) return null;
  return { name, sector, exchange: null, asset_class: "us_equity", country: null };
}

/**
 * The next earnings date inside the calendar window. `calendar` null means the
 * calendar could not be fetched → null (missing). An empty window is a FACT
 * ("none in the next N days"), not a gap, so it is stated.
 */
export function eventsFromCalendar(calendar, symbol, asOf, windowDays = 30) {
  if (!Array.isArray(calendar)) return null;
  const sym = String(symbol || "").toUpperCase();
  const today = String(asOf || "").slice(0, 10);
  if (!sym) return null;
  const hit = calendar.filter((r) => r && typeof r === "object" && String(r.symbol || "").toUpperCase() === sym && String(r.date || "") >= today)
    .map((r) => String(r.date)).sort()[0] || null;
  if (!hit) return { next_earnings_date: null, earnings_window_days: windowDays, note: `no earnings in the next ${windowDays} days` };
  const days = Math.round((Date.parse(`${hit}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000);
  return { next_earnings_date: hit, days_to_earnings: days, earnings_window_days: windowDays };
}
