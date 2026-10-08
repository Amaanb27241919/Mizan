/**
 * Pure (no I/O): the small-account rules behind Experiment E (2026-10-08).
 *
 * The owner's live E*TRADE account holds ~$175 and E*TRADE buys whole shares
 * only. The momentum strategies hold 15–25 names priced up to ~$1,750, so
 * they cannot run there as written. E measures, on paper, what is left of the
 * strategy once it obeys those constraints: a few slots, whole shares, and
 * only names one slot can afford. Enabled per strategy by params.whole_shares.
 */

/** The most one slot can pay for a single share: capital ÷ slots. */
export function slotPriceCap(input) {
  const { capital, buyTop } = input || {};
  const c = Number(capital), n = Number(buyTop);
  return c > 0 && n > 0 ? c / n : 0;
}

/**
 * Keep only symbols whose last close is within the cap. Applied BEFORE
 * ranking, so the plan ranks the momentum leaders this account can actually
 * buy rather than skipping unaffordable leaders and leaving slots empty.
 */
export function affordableBars(bars, cap) {
  const out = {};
  if (!bars || typeof bars !== "object" || !(Number(cap) > 0)) return out;
  for (const [sym, series] of Object.entries(bars)) {
    if (!Array.isArray(series) || !series.length) continue;
    const last = Number(series[series.length - 1]?.c);
    if (last > 0 && last <= cap) out[sym] = series;
  }
  return out;
}

/**
 * Dollar allocations → whole-share buy orders, in three passes:
 *  1. one share of every name, in allocation order, while cash allows — so a
 *     3-slot book stays 3 names (flooring first dropped a name whose weight
 *     came to just under one share, and the leftover doubled up the others);
 *  2. the rest of each allocation, floored to whole shares;
 *  3. leftover cash buys single extra shares in allocation order.
 * Never spends past `budget`; a name it cannot afford one share of is
 * dropped, never rounded up.
 */
export function wholeShareOrders(input) {
  const { allocations, priceOf, budget } = input || {};
  const list = Array.isArray(allocations) ? allocations : [];
  const price = (t) => { const p = typeof priceOf === "function" ? Number(priceOf(t)) : 0; return p > 0 ? p : 0; };
  const qty = new Map();
  let left = Math.max(0, Number(budget) || 0);
  for (const a of list) {
    const p = price(a?.ticker);
    if (p && !qty.has(a.ticker) && p <= left + 1e-9) { qty.set(a.ticker, 1); left -= p; }
  }
  for (const a of list) {
    const p = price(a?.ticker);
    if (!p || !qty.has(a.ticker)) continue;
    const want = Math.max(0, (Number(a.notional) || 0) - qty.get(a.ticker) * p);
    const n = Math.floor(Math.min(want, left) / p);
    if (n > 0) { qty.set(a.ticker, qty.get(a.ticker) + n); left -= n * p; }
  }
  for (let added = true; added;) {
    added = false;
    for (const a of list) {
      const p = price(a?.ticker);
      if (p && p <= left + 1e-9) { qty.set(a.ticker, (qty.get(a.ticker) || 0) + 1); left -= p; added = true; }
    }
  }
  const orders = list.map((a) => a?.ticker).filter((t, i, all) => t && all.indexOf(t) === i && qty.get(t) > 0)
    .map((t) => ({ ticker: t, qty: qty.get(t) }));
  return { orders, leftover: Math.round(left * 100) / 100 };
}
