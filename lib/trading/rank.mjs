/**
 * Rank a universe, size by calmness, and decide what to keep.
 *
 * The spec is one line from a working system the owner showed me:
 *   "Trailing stops are off. Calmer stocks get larger positions.
 *    Holdings are kept while ranked in the top 25."
 * plus its settings line: Hold zone: top 25 | Sizing: volatility |
 * Earnings filter: 3 days | Rebalance: monthly | Screen: spus.
 *
 * Pure. No I/O, no clock, no broker — bars in, decisions out — because this is
 * the part that decides where money goes and it has to be testable without any
 * of that. Fetching bars and placing orders live elsewhere.
 *
 * THE HOLD ZONE IS HYSTERESIS, NOT A RANK CUTOFF. Buying the top 15 and
 * selling anything outside the top 15 would churn every time two names swap
 * places near the boundary — paying spread both ways to own nearly the same
 * book. A wider keep-band than buy-band means a position has to genuinely
 * deteriorate before it is sold. `buyTop` and `holdZone` are deliberately
 * different numbers and the gap between them is the whole point.
 *
 * SIZING IS INVERSE VOLATILITY, which is what "calmer stocks get larger
 * positions" means: weight ∝ 1/σ, normalized. It is a risk-parity
 * approximation, not a conviction weighting — the ranking decides WHAT to own,
 * this decides how much, and the two are kept separate so neither can quietly
 * become the other.
 */

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/** Closing prices, oldest first, from Alpaca-shaped bars ({ c } per bar). */
export function closes(bars) {
  return (Array.isArray(bars) ? bars : [])
    .map((b) => num(b?.c))
    .filter((c) => c !== null && c > 0);
}

/**
 * Total return over the lookback, as a fraction (0.25 = +25%).
 * Returns null when there is not enough history to measure — a name with two
 * bars has no momentum, and treating that as 0 would rank it above genuine
 * decliners rather than excluding it.
 */
export function momentum(bars, opts) {
  const { lookbackDays = 252, minBars = 30 } = opts || {};
  const c = closes(bars);
  if (c.length < minBars) return null;
  const window = c.slice(-Math.max(2, lookbackDays));
  const first = window[0], last = window[window.length - 1];
  if (!(first > 0)) return null;
  return (last - first) / first;
}

/** Daily log-return standard deviation, annualized. null when unmeasurable. */
export function volatility(bars, opts) {
  const { lookbackDays = 60, minBars = 20 } = opts || {};
  const c = closes(bars).slice(-Math.max(2, lookbackDays + 1));
  if (c.length < minBars) return null;
  const rets = [];
  for (let i = 1; i < c.length; i++) rets.push(Math.log(c[i] / c[i - 1]));
  if (rets.length < 2) return null;
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const varSum = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);
  const sd = Math.sqrt(varSum);
  if (!(sd > 0)) return null;      // a flat line is not "zero risk", it is unusable
  return sd * Math.sqrt(252);
}

/**
 * Rank a universe by momentum, strongest first.
 * Names without measurable momentum are EXCLUDED, not ranked last — an
 * unmeasurable name is unknown, and sorting it anywhere asserts something.
 * @returns {Array<{symbol, momentum, volatility}>}
 */
export function rankUniverse(barsBySymbol = {}, opts = {}) {
  const rows = [];
  for (const [symbol, bars] of Object.entries(barsBySymbol || {})) {
    const m = momentum(bars, opts);
    if (m === null) continue;
    rows.push({ symbol, momentum: m, volatility: volatility(bars, opts) });
  }
  return rows.sort((a, b) => b.momentum - a.momentum || a.symbol.localeCompare(b.symbol));
}

/**
 * What to own next period, given what is owned now.
 *
 * @param {object}  o
 * @param {Array}   o.ranked    output of rankUniverse (strongest first)
 * @param {Array}   o.held      symbols currently held
 * @param {number}  o.buyTop    buy from the top N
 * @param {number}  o.holdZone  keep while inside the top M (M >= N)
 * @param {Array}   o.excluded  symbols blocked this period (earnings, screen)
 * @returns {{target:string[], buy:string[], sell:string[], keep:string[]}}
 */
export function rebalancePlan(input) {
  const { ranked = [], held = [], buyTop = 15, holdZone = 25, excluded = [], forceSell = [] } = input || {};
  // Array.isArray, not `|| []`. A default parameter fires only on undefined,
  // and `|| []` only rescues falsy — a string or object sails through to .map
  // and throws. Fifth appearance of this exact trap in this codebase
  // (monthKey, suggestBudgets, spentByCategory, basket.mjs, here): guard the
  // SHAPE, do not default the value.
  const arr = (v) => (Array.isArray(v) ? v : []);
  const block = new Set(arr(excluded).map((s) => String(s).toUpperCase()));
  const order = arr(ranked).map((r) => String(r?.symbol ?? "").toUpperCase()).filter(Boolean);
  const rankOf = new Map(order.map((s, i) => [s, i + 1]));
  const heldUp = [...new Set(arr(held).map((s) => String(s).toUpperCase()))];

  // Keep a holding while it stays inside the WIDER band. A name that has left
  // the universe entirely has no rank, and is sold.
  // forceSell: holdings that FAIL the strategy's Sharia standard
  // (lib/trading/screenGate.mjs). Rank cannot keep a name that is not halal.
  const forced = new Set(arr(forceSell).map((s) => String(s).toUpperCase()));
  const keep = heldUp.filter((s) => {
    if (forced.has(s)) return false;
    const r = rankOf.get(s);
    return r !== undefined && r <= holdZone;
  });
  const sell = heldUp.filter((s) => !keep.includes(s));

  // Fill remaining slots from the top, skipping what is already kept or
  // blocked. Blocked names are passed over, not substituted for by reaching
  // deeper than buyTop — the band is the band.
  const buy = [];
  for (const s of order.slice(0, Math.max(0, buyTop))) {
    if (keep.includes(s) || block.has(s) || forced.has(s)) continue;
    buy.push(s);
  }
  const target = [...keep, ...buy];
  return { target, buy, sell, keep };
}

/**
 * Inverse-volatility weights over `symbols`, summing to 1.
 * A symbol with no measurable volatility is dropped rather than given an
 * arbitrary weight — guessing here silently concentrates the book.
 * Falls back to equal weight only when NOTHING is measurable.
 * @returns {Record<string, number>}
 */
export function inverseVolWeights(ranked = [], symbols = []) {
  const arr = (v) => (Array.isArray(v) ? v : []);
  const volOf = new Map(arr(ranked).map((r) => [String(r?.symbol ?? "").toUpperCase(), r?.volatility]));
  const want = [...new Set(arr(symbols).map((s) => String(s).toUpperCase()).filter(Boolean))];
  const usable = want.filter((s) => { const v = volOf.get(s); return Number.isFinite(v) && v > 0; });

  if (!want.length) return {};
  if (!usable.length) {
    const w = 1 / want.length;
    return Object.fromEntries(want.map((s) => [s, w]));
  }
  const inv = usable.map((s) => 1 / volOf.get(s));
  const total = inv.reduce((a, b) => a + b, 0);
  return Object.fromEntries(usable.map((s, i) => [s, inv[i] / total]));
}
