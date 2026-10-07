/**
 * Pure (no I/O): the single-position swing strategy's bookkeeping, and its
 * broker-side bracket exits.
 *
 * Written 2026-10-06 for swing experiment D. The legacy helper averaged EVERY
 * buy the strategy had ever made, so after a round trip the open position's
 * gain was computed against a blended old price — and the +5% / −3% exits
 * fired at the wrong prices. It also gave no opening time, so the time limit
 * was measured from the strategy's creation instead.
 */

const arr = (x) => (Array.isArray(x) ? x : [])
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const EPS = 1e-9
const cents = (n) => String(Math.round(n * 100) / 100)

/**
 * The OPEN position from executed signals: running average cost that resets
 * when the position goes flat, and the time it was opened.
 * @param {Array<{side:string, qty:any, suggested_price:any, executed_at?:string, ticker?:string, paper?:boolean}>} rows
 */
export function openPosition(rows) {
  const list = arr(rows).filter((r) => r && (r.side === 'buy' || r.side === 'sell') && num(r.qty) > 0)
    .sort((a, b) => String(a.executed_at || '').localeCompare(String(b.executed_at || '')))
  let qty = 0, cost = 0, openedAt = null, ticker = null
  for (const r of list) {
    const q = num(r.qty), px = num(r.suggested_price)
    if (r.side === 'buy') {
      if (qty <= EPS) { openedAt = r.executed_at || null; cost = 0; qty = 0 }
      qty += q; cost += q * px
      if (r.ticker) ticker = String(r.ticker).toUpperCase()
    } else {
      const avg = qty > EPS ? cost / qty : 0
      const sold = Math.min(q, qty)
      qty -= sold; cost -= avg * sold
      if (qty <= EPS) { qty = 0; cost = 0; openedAt = null }
    }
  }
  const netQty = Math.round(qty * 1e6) / 1e6
  return {
    netQty,
    avgEntry: netQty > 0 ? cost / qty : null,
    openedAt: netQty > 0 ? openedAt : null,
    ticker: netQty > 0 ? ticker : null,
    executedCount: list.length,
    paper: list.some((r) => r.paper === true),
  }
}

/**
 * Bracket legs for a whole-share market entry: take-profit `takeProfitPct`
 * above and stop `stopPct` below the reference entry price. Refuses rather
 * than reshaping — an entry without its protection is not the order asked for.
 */
export function bracketLegsFor(input) {
  const { entryPrice, qty, takeProfitPct, stopPct } = input || {}
  const px = num(entryPrice), q = num(qty), tp = num(takeProfitPct), sl = num(stopPct)
  if (!(px > 0)) return { ok: false, code: 'no_price' }
  if (!(q > 0) || Math.abs(q - Math.round(q)) > EPS) return { ok: false, code: 'fractional' }
  if (!(tp > 0) || tp >= 1000) return { ok: false, code: 'bad_take_profit' }
  if (!(sl > 0) || sl >= 100) return { ok: false, code: 'bad_stop' }
  const limit = Math.round(px * (1 + tp / 100) * 100) / 100
  const stop = Math.round(px * (1 - sl / 100) * 100) / 100
  if (!(stop > 0) || !(limit > px) || !(stop < px)) return { ok: false, code: 'bad_prices' }
  return { ok: true, order_class: 'bracket', take_profit: { limit_price: cents(limit) }, stop_loss: { stop_price: cents(stop) } }
}

const OPEN_STATUSES = new Set(['new', 'accepted', 'held', 'pending_new', 'partially_filled', 'accepted_for_bidding', 'pending_replace'])

/**
 * Read a bracket parent order (GET /v2/orders/{id}?nested=true).
 *   filled          a leg that fully sold the position, or null
 *   openLegIds      legs still resting at the broker (cancel these before any
 *                   other exit, or the shares are sold twice)
 *   brokerOwnsExits true while protection rests at the broker — polling must
 *                   then leave the stop and the target alone
 */
export function bracketExitState(order) {
  const legs = arr(order?.legs)
  let filled = null
  const openLegIds = []
  for (const l of legs) {
    if (!l || !l.id) continue
    const status = String(l.status || '').toLowerCase()
    if (status === 'filled' && num(l.filled_qty) > 0 && !filled) {
      const type = String(l.type || '').toLowerCase()
      filled = {
        legId: l.id,
        kind: type === 'limit' ? 'take_profit' : 'stop',
        qty: num(l.filled_qty),
        price: num(l.filled_avg_price),
        at: l.filled_at || null,
      }
    } else if (OPEN_STATUSES.has(status)) {
      openLegIds.push(l.id)
    }
  }
  return { filled, openLegIds, brokerOwnsExits: !filled && openLegIds.length > 0 }
}
