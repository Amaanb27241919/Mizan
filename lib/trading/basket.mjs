/**
 * The deterministic portfolio algorithm — how a fixed-weight basket splits one
 * contribution across its members.
 *
 * This is the BASELINE the Trade Lab proposal's §35 asks for before any AI
 * portfolio manager exists. Its whole job is to be boring and reproducible, so
 * that when a research committee is eventually pointed at the same capital
 * there is something honest to measure it against. No model, no scoring, no
 * judgment — weights in, dollars out.
 *
 * REBALANCE BY CONTRIBUTION, NEVER BY SELLING. Each period the allocator asks
 * where the money would have to go to bring the basket toward its targets, and
 * puts the new contribution there. It never proposes a sell. Selling to
 * rebalance realizes gains, triggers tax, and for a long-term halal
 * accumulation strategy there is no reason to do it — drift corrects itself as
 * contributions accumulate.
 *
 * WHY THIS REPLACES "BUY THE MOST UNDERWEIGHT ONE". The existing whole-share
 * path picks the single most-underweight member it can afford a whole share of.
 * That was the only thing possible without fractional trading, and it has two
 * failure modes at small contributions: with $50/week against a ~$55 share the
 * basket buys one member some weeks and NOTHING at all in others, and a member
 * that is never individually affordable is never bought. Notional orders remove
 * both — every member gets its exact share of every contribution.
 *
 * The invariant worth trusting: the returned allocations sum to the budget, to
 * the cent. A basket that quietly spends a different amount than it was given
 * is the bug this module exists to make impossible.
 */

/** Alpaca rejects notional orders below one dollar. */
export const MIN_NOTIONAL = 1;

const r2 = (n) => Math.round(n * 100) / 100;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * Split `budget` across `legs` to move the basket toward its target weights.
 *
 * @param {object}  o
 * @param {Array}   o.legs    [{ ticker, weight, price, value }] — `value` is the
 *                            position's CURRENT market value, 0 if unheld.
 * @param {number}  o.budget  dollars to deploy this period.
 * @param {number} [o.minNotional]
 * @returns {{ok:boolean, allocations:Array<{ticker:string,notional:number}>,
 *            deployed:number, skipped:Array, reason?:string}}
 */
export function computeBasketAllocation({ legs = [], budget = 0, minNotional = MIN_NOTIONAL } = {}) {
  const B = r2(num(budget));
  const valid = (Array.isArray(legs) ? legs : []).filter(
    (l) => l && l.ticker && num(l.weight) > 0 && num(l.price) > 0,
  );
  if (!valid.length) return { ok: false, allocations: [], deployed: 0, skipped: [], reason: "no_valid_legs" };
  if (!(B >= minNotional)) return { ok: false, allocations: [], deployed: 0, skipped: [], reason: "budget_below_minimum" };

  const wSum = valid.reduce((s, l) => s + num(l.weight), 0);
  const held = valid.reduce((s, l) => s + num(l.value), 0);
  const future = held + B;

  // How far below its target each leg sits once this contribution lands. A leg
  // already at or above target needs nothing, which is what steers the money to
  // the laggards instead of spreading it evenly and preserving the drift.
  const need = valid.map((l) => Math.max(0, (num(l.weight) / wSum) * future - num(l.value)));
  const needSum = need.reduce((s, n) => s + n, 0);

  // Every leg at or above target (a member ran up, or the basket is new and
  // empty of value). Fall back to raw target weights — still deterministic.
  const share = needSum > 0 ? need.map((n) => n / needSum) : valid.map((l) => num(l.weight) / wSum);

  let alloc = valid.map((l, i) => ({ ticker: l.ticker, notional: r2(share[i] * B) }));

  // Drop anything under the broker's floor and re-split among the survivors,
  // largest first — otherwise the order is rejected and that slice is silently
  // never invested.
  const skipped = alloc.filter((a) => a.notional < minNotional && a.notional > 0)
                       .map((a) => ({ ticker: a.ticker, notional: a.notional, reason: "below_min_notional" }));
  let keep = alloc.filter((a) => a.notional >= minNotional);
  if (!keep.length) {
    // Budget can't cover even one leg at target weight: put it all in the
    // single most-underweight leg rather than skipping the period entirely.
    const i = share.indexOf(Math.max(...share));
    keep = [{ ticker: valid[i].ticker, notional: B }];
    return { ok: true, allocations: keep, deployed: B, skipped: skipped.filter((s) => s.ticker !== valid[i].ticker) };
  }
  if (skipped.length) {
    const kSum = keep.reduce((s, a) => s + a.notional, 0) || 1;
    keep = keep.map((a) => ({ ticker: a.ticker, notional: r2((a.notional / kSum) * B) }));
  }

  // Cent-level closure. Rounding each leg independently can leave the total a
  // cent or two off the budget; push the remainder onto the largest allocation
  // so the sum is exact rather than approximately right.
  const total = r2(keep.reduce((s, a) => s + a.notional, 0));
  const drift = r2(B - total);
  if (drift !== 0) {
    let bi = 0;
    keep.forEach((a, i) => { if (a.notional > keep[bi].notional) bi = i; });
    keep[bi] = { ...keep[bi], notional: r2(keep[bi].notional + drift) };
  }

  return { ok: true, allocations: keep, deployed: r2(keep.reduce((s, a) => s + a.notional, 0)), skipped };
}
