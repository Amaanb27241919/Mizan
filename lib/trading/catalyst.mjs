/**
 * Pure (no I/O, no clock): the rules behind the experiments of 2026-10-14,
 * built to fill the gaps in the owner's original brief —
 *   "momentum driven by news or volume", "consistent green days, even if it's
 *   a 1% increase daily", "be able to do premarket trading".
 *
 *   freshNewsSymbols  which names have company news in the last N hours
 *   dayPnlPct         a one-name swing strategy's P&L for TODAY, % of capital
 *   dayGoalAction     the green-day rule: lock the day at +goal, stop it at −limit
 *   premarketPick     the strongest pre-market gapper that clears every gate
 *   premarketLimit    the limit price for an extended-hours buy
 *   fixedWeights      a fixed-weight basket over the names that passed the screen
 *
 * An unknown stays unknown: a name with no fresh price, no prior close or no
 * news is never treated as qualifying.
 */
const arr = (v) => (Array.isArray(v) ? v : [])
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const round2 = (x) => Math.round(x * 100) / 100

/**
 * Alpaca news (/v1beta1/news → { news: [{ symbols, created_at }] }) → the set
 * of symbols with at least one article newer than `hours`.
 */
export function freshNewsSymbols(raw, opts) {
  const { now = Date.now(), hours = 24 } = opts || {}
  const since = Number(now) - Math.max(0, Number(hours) || 0) * 3600000
  const out = new Set()
  for (const n of arr(raw?.news)) {
    const at = Date.parse(n?.created_at || n?.updated_at || '')
    if (!Number.isFinite(at) || at < since || at > Number(now) + 3600000) continue
    for (const s of arr(n?.symbols)) if (typeof s === 'string' && s) out.add(s.toUpperCase())
  }
  return out
}

/**
 * Today's P&L for a one-name strategy, as % of its capital. The open
 * position is measured from the PRIOR close, or from its entry price when it
 * was opened today; `realizedToday` is P&L already booked by today's sales.
 * null when the capital or a needed price is unknown.
 */
export function dayPnlPct(input) {
  const { capital, netQty = 0, price = null, prevClose = null, avgEntry = null, openedToday = false, realizedToday = 0 } = input || {}
  const cap = num(capital)
  if (!(cap > 0)) return null
  const q = num(netQty) || 0
  let unrealized = 0
  if (q > 0) {
    const px = num(price), ref = openedToday ? num(avgEntry) : num(prevClose)
    if (!(px > 0) || !(ref > 0)) return null
    unrealized = q * (px - ref)
  }
  return round2(((num(realizedToday) || 0) + unrealized) / cap * 100)
}

/** 'goal' at or above +goal, 'limit' at or below −limit, else null. */
export function dayGoalAction(pct, opts) {
  const { goal = null, limit = null } = opts || {}
  const p = num(pct), g = num(goal), l = num(limit)
  if (p === null) return null
  if (g !== null && g > 0 && p >= g) return 'goal'
  if (l !== null && l > 0 && p <= -l) return 'limit'
  return null
}

/**
 * The pre-market pick. For each candidate: a fresh pre-market price, the
 * prior close, and (when required) fresh news. The strongest gap at or above
 * `minGapPct` that one whole share of `budget` can buy wins.
 *   latest     { SYM: { price, at } }   at = ms of the trade
 *   prevClose  { SYM: close }
 *   freshSince ms; a trade older than this is not a pre-market price
 */
export function premarketPick(input) {
  const { universe, latest, prevClose, news = null, requireNews = false, minGapPct = 1.5, budget = 0, freshSince = 0 } = input || {}
  let best = null
  for (const raw of arr(universe)) {
    const sym = String(raw || '').toUpperCase()
    if (!sym) continue
    const t = latest && typeof latest === 'object' ? latest[sym] : null
    const px = num(t?.price), at = num(t?.at), pc = num(prevClose?.[sym])
    if (!(px > 0) || !(pc > 0) || !(at >= Number(freshSince))) continue
    if (requireNews && !(news instanceof Set && news.has(sym))) continue
    const gap = (px / pc - 1) * 100
    if (gap < Number(minGapPct)) continue
    if (Math.floor(Number(budget) / premarketLimit(px)) < 1) continue
    if (!best || gap > best.gapPct) best = { symbol: sym, price: px, gapPct: round2(gap) }
  }
  return best
}

/** Limit for an extended-hours buy: a little above the last trade, in cents. */
export function premarketLimit(price, slipPct = 0.5) {
  const p = num(price)
  if (!(p > 0)) return null
  return round2(p * (1 + (num(slipPct) || 0) / 100))
}

/**
 * A fixed-weight basket (Experiment G): the configured weights over the names
 * still in the plan, renormalized to sum to 1. A name with no weight is left
 * out rather than given an arbitrary one.
 */
export function fixedWeights(weights, symbols) {
  const w = weights && typeof weights === 'object' && !Array.isArray(weights) ? weights : {}
  const want = [...new Set(arr(symbols).map((s) => String(s).toUpperCase()).filter(Boolean))]
  const usable = want.filter((s) => (num(w[s]) || 0) > 0)
  const total = usable.reduce((t, s) => t + num(w[s]), 0)
  if (!(total > 0)) return {}
  return Object.fromEntries(usable.map((s) => [s, num(w[s]) / total]))
}
