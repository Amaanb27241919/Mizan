// Holdings overlay — pure data prep for the price chart's ACCOUNT_SERVICING layer.
//
// COMPLIANCE (see docs/COMPLIANCE.md): this turns the user's OWN executed
// SnapTrade transactions into neutral chart markers. It is a statement of fact
// about their account — display only. It contains NO judgment, NO gain/loss
// framing, NO "consider" language, and NO suggestion. Kept pure (no I/O, no
// React) so the boundary is easy to audit and unit-test.

// Resolve SnapTrade's three symbol shapes (string | {symbol} | {symbol:{raw_symbol}}).
// Mirrors normSym in MizanApp so the overlay matches the holding row's ticker.
export function normSym(s) {
  if (!s) return "";
  if (typeof s === "string") return s.toUpperCase();
  let cur = s, depth = 0;
  while (cur && typeof cur === "object" && depth < 4) {
    const v = cur.symbol ?? cur.raw_symbol ?? cur.ticker;
    if (typeof v === "string") return v.toUpperCase();
    if (typeof v === "object") { cur = v; depth++; continue; }
    break;
  }
  return (cur?.symbol ?? cur?.raw_symbol ?? cur?.ticker ?? "").toString().toUpperCase();
}

const MAX_MARKERS = 50;

/**
 * Executed BUY/SELL transactions for one symbol, shaped for lightweight-charts
 * markers. Returns [{ time (epoch seconds), side: 'BUY'|'SELL', units, price }],
 * most recent last, capped to the latest MAX_MARKERS.
 *
 * @param {Array} activities SnapTrade transaction history (snapActivities)
 * @param {string} symbol    ticker to filter to
 */
export function tradesForSymbol(activities, symbol) {
  const want = String(symbol || "").toUpperCase();
  if (!want || !Array.isArray(activities)) return [];
  const out = [];
  for (const a of activities) {
    const side = String(a?.type || "").toUpperCase();
    if (side !== "BUY" && side !== "SELL") continue;
    if (normSym(a?.symbol) !== want) continue;
    const dateStr = a?.trade_date || a?.settlement_date;
    const ms = dateStr ? Date.parse(String(dateStr).slice(0, 10) + "T00:00:00Z") : NaN;
    if (!Number.isFinite(ms)) continue;
    const units = Math.abs(Number(a?.units) || 0) || null;
    const price = Number(a?.price) || null;
    out.push({ time: Math.floor(ms / 1000), side, units, price });
  }
  out.sort((x, y) => x.time - y.time);
  return out.length > MAX_MARKERS ? out.slice(out.length - MAX_MARKERS) : out;
}
