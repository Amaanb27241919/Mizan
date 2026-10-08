/**
 * Pure (no I/O): a strategy's DAILY return against SPUS, rebuilt from its own
 * ledger and daily closes. Powers the small charts on the Trade Lab desk.
 *
 * Same accounting as strategyScore (sleeve.mjs), applied day by day:
 *   cash(d)     = capital − buys + sells, for rows dated on or before d
 *                 (executed AND submitted, as strategyScore counts them)
 *   holdings(d) = executed buys − executed sells, on or before d
 *   equity(d)   = cash(d) + Σ holdings(d) × close(d)
 * SPUS is measured from the close BEFORE the first fill, as strategyScore does,
 * so the last point of this curve and the number printed beside it agree.
 *
 * Honest absence: a day on which any held name has no close yet is OMITTED,
 * never valued at zero — a hole plotted as $0 is a crash that never happened.
 * Bars are split/dividend adjusted (adjustment=all) while fills are raw, so a
 * split inside the window would distort the line; none is expected over a
 * paper test of weeks, and the endpoint says so.
 */
const arr = (v) => (Array.isArray(v) ? v : [])
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const CASH = new Set(['executed', 'submitted'])
const round2 = (x) => Math.round(x * 100) / 100

/** closes: { SYM: { 'YYYY-MM-DD': close } }; the latest close on or before `day`. */
export function closeOn(closes, sym, day) {
  const s = closes && typeof closes === 'object' ? closes[sym] : null
  if (!s || typeof s !== 'object') return null
  let best = null, bestDay = ''
  for (const [d, c] of Object.entries(s)) {
    if (d <= day && d > bestDay && Number(c) > 0) { best = Number(c); bestDay = d }
  }
  return best
}

/**
 * input: { capital, ledger:[{side,qty,suggested_price,status,ticker,day}],
 *          closes, benchSymbol='SPUS', days:['YYYY-MM-DD' ascending] }
 * `day` on each ledger row is its New York trading date (the caller derives it
 * from executed_at, else created_at).
 * → { startedOn, points:[{day, returnPct, benchPct}] } — points include a
 *   0/0 baseline on the trading day before the first fill.
 */
export function strategyCurve(input) {
  const { capital, ledger, closes, benchSymbol = 'SPUS', days } = input || {}
  const cap = num(capital)
  const rows = arr(ledger).filter((r) => r && CASH.has(r.status) && typeof r.day === 'string')
  const fills = rows.filter((r) => r.status === 'executed').map((r) => r.day).sort()
  const startedOn = fills[0] || null
  if (!startedOn || !(cap > 0)) return { startedOn, points: [] }

  const cal = arr(days).filter((d) => typeof d === 'string').sort()
  const before = cal.filter((d) => d < startedOn)
  const baseDay = before[before.length - 1] || null
  const benchStart = baseDay ? closeOn(closes, benchSymbol, baseDay) : null

  const points = []
  if (baseDay) points.push({ day: baseDay, returnPct: 0, benchPct: benchStart ? 0 : null })
  for (const day of cal.filter((d) => d >= startedOn)) {
    let cash = cap
    const held = {}
    for (const r of rows) {
      if (r.day > day) continue
      const value = num(r.qty) * num(r.suggested_price)
      cash += r.side === 'sell' ? value : -value
      if (r.status !== 'executed') continue
      const t = String(r.ticker || '').toUpperCase()
      if (!t) continue
      held[t] = (held[t] || 0) + (r.side === 'sell' ? -num(r.qty) : num(r.qty))
    }
    let value = 0, priced = true
    for (const [t, q] of Object.entries(held)) {
      if (q <= 0.000001) continue
      const c = closeOn(closes, t, day)
      if (c === null) { priced = false; break }
      value += q * c
    }
    if (!priced) continue
    const b = benchStart ? closeOn(closes, benchSymbol, day) : null
    points.push({
      day,
      returnPct: round2(((value + cash) / cap - 1) * 100),
      benchPct: b && benchStart ? round2((b / benchStart - 1) * 100) : null,
    })
  }
  return { startedOn, points }
}
