/**
 * Pure (no I/O): per-strategy money and filters for rank_rebalance.
 *
 * Several strategies share one Alpaca account, and Alpaca reports only the
 * account. Each strategy therefore has a SLEEVE — its own cash, derived from
 * its own ledger — and may never spend beyond it or beyond the account's real
 * cash. Margin is riba; Alpaca paper accounts will happily lend.
 *
 * Written 2026-10-06 after finding that rank_rebalance passed
 * `capital_allocated` to the basket allocator as fresh money on EVERY
 * rebalance. The allocator treats its budget as a contribution, so the live
 * $95k strategy would have bought ~$95k more on its next rebalance with ~$5k
 * of cash in the account.
 */

const arr = (x) => (Array.isArray(x) ? x : [])
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

/** Signal statuses that moved, or have committed to move, real cash. */
const CASH_STATUSES = new Set(['executed', 'submitted'])

/**
 * Cash the strategy has not spent: capital − buys + sells. Fill reconciliation
 * rewrites qty and suggested_price to the real fill, so executed rows are
 * exact; submitted rows reserve at the reference price.
 * @param {{capital:number, signals:Array<{side:string, qty:any, suggested_price:any, status:string}>}} input
 */
export function sleeveCash(input) {
  const { capital, signals } = input || {}
  let cash = num(capital)
  for (const s of arr(signals)) {
    if (!s || !CASH_STATUSES.has(s.status)) continue
    const value = num(s.qty) * num(s.suggested_price)
    cash += s.side === 'sell' ? value : -value
  }
  return cash
}

/**
 * Dollars a rebalance may deploy into buys: the sleeve plus this rebalance's
 * sell proceeds, capped by the account's real cash plus those proceeds.
 * Unknown account cash means 0 — never trade blind on a shared account.
 */
export function rankDeployBudget(input) {
  const { sleeve, sells, accountCash } = input || {}
  if (accountCash === null || accountCash === undefined || !Number.isFinite(Number(accountCash))) return 0
  const proceeds = arr(sells).reduce((t, s) => t + num(s?.qty) * num(s?.price), 0)
  const want = num(sleeve) + proceeds
  const can = num(accountCash) + proceeds
  return Math.max(0, Math.round(Math.min(want, can) * 100) / 100)
}

/**
 * Universe symbols reporting earnings within `days` calendar days of `asOf`,
 * inclusive. Accepts Finnhub's `{earningsCalendar:[…]}` or the bare array.
 */
export function earningsExclusions(calendar, universe, opts) {
  const days = Math.max(0, Math.floor(num(opts?.days)))
  if (!days) return []
  const rows = Array.isArray(calendar) ? calendar : arr(calendar?.earningsCalendar)
  const inUniverse = new Set(arr(universe).map((s) => String(s).toUpperCase()))
  const start = new Date(`${String(opts?.asOf || '').slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(start.getTime())) return []
  const end = new Date(start.getTime() + days * 86400000)
  const out = new Set()
  for (const r of rows) {
    const sym = String(r?.symbol || '').toUpperCase()
    if (!inUniverse.has(sym)) continue
    const d = new Date(`${String(r?.date || '').slice(0, 10)}T00:00:00Z`)
    if (Number.isNaN(d.getTime())) continue
    if (d >= start && d <= end) out.add(sym)
  }
  return [...out].sort()
}

/**
 * Give the slots a filter left empty to a cash-sweep ticker (SPSK for the
 * reference system), so idle cash still earns a halal return. Stock weights
 * are scaled to their share of the filled slots; the result sums to 1.
 */
export function withCashSweep(weights, opts) {
  const w = weights && typeof weights === 'object' && !Array.isArray(weights) ? weights : {}
  const ticker = opts?.ticker ? String(opts.ticker).toUpperCase() : null
  const buyTop = Math.max(0, Math.floor(num(opts?.buyTop)))
  const filled = Math.max(0, Math.floor(num(opts?.targetCount)))
  if (!ticker || !buyTop || filled >= buyTop) return { ...w }
  const stockShare = filled / buyTop
  const out = Object.fromEntries(Object.entries(w).map(([k, v]) => [k, num(v) * stockShare]))
  out[ticker] = (out[ticker] || 0) + (1 - stockShare)
  return out
}

/**
 * The AI gate on NEW buys. A candidate is blocked only when the panel reached
 * a consensus of SELL — a split, a HOLD or a declined round never blocks.
 * Until every candidate has a review the gate is not ready (the rebalance
 * waits for the next tick); after the cutoff, unreviewed names proceed and are
 * reported, so a model outage cannot freeze the book indefinitely.
 */
export function aiGateDecision(input) {
  const { candidates, reviews, pastCutoff = false } = input || {}
  const byTicker = new Map()
  for (const r of arr(reviews)) {
    if (!r || r.rationale?.kind !== 'ai_panel') continue
    byTicker.set(String(r.ticker || '').toUpperCase(), r.rationale)
  }
  const vetoed = [], passed = [], unreviewed = []
  for (const c of arr(candidates).map((s) => String(s).toUpperCase())) {
    if (!byTicker.has(c)) { unreviewed.push(c); continue }
    const rat = byTicker.get(c)
    const e = rat?.ensemble
    // Mizan's own AAOIFI screen outranks the SPUS universe: a name it rates
    // haram is never bought, models or no models.
    if (rat?.sharia_verdict === 'haram') vetoed.push(c)
    else if (e?.ok && e.consensus === 'SELL') vetoed.push(c)
    else passed.push(c)
  }
  if (pastCutoff) {
    return { vetoed, passed: [...passed, ...unreviewed], unreviewed: [], unreviewedAtCutoff: unreviewed, ready: true }
  }
  return { vetoed, passed, unreviewed, unreviewedAtCutoff: [], ready: unreviewed.length === 0 }
}

/**
 * Market value of a multi-ticker book: each ticker at its OWN price. Tickers
 * without a price are listed in `missing`, never counted as zero silently.
 * @param {Record<string, number>} book  symbol -> shares
 * @param {Record<string, number|string>} prices symbol -> last price
 */
export function valueBook(book, prices) {
  const b = book && typeof book === 'object' && !Array.isArray(book) ? book : {}
  const p = prices && typeof prices === 'object' && !Array.isArray(prices) ? prices : {}
  let value = 0, priced = 0
  const missing = []
  for (const [sym, qty] of Object.entries(b)) {
    const q = num(qty), px = num(p[sym])
    if (!(q > 0)) continue
    if (!(px > 0)) { missing.push(sym); continue }
    value += q * px; priced++
  }
  return { value: Math.round(value * 100) / 100, priced, missing }
}

/**
 * The scoreboard row for one strategy: equity = market value + the strategy's
 * own cash, its return on capital, and SPUS over the SAME window (from the
 * close before its first fill). A strategy with no fills has no return yet —
 * reporting −100% for an unfunded book is the bug this replaced.
 * @param {{capital:number, ledger:Array, marketValue:number, benchStart?:number|null, benchNow?:number|null}} input
 */
export function strategyScore(input) {
  const { capital, ledger, marketValue, benchStart = null, benchNow = null } = input || {}
  const cap = num(capital)
  const rows = arr(ledger).filter((r) => r && CASH_STATUSES.has(r.status))
  const cash = Math.round(sleeveCash({ capital: cap, signals: rows }) * 100) / 100
  const equity = Math.round((num(marketValue) + cash) * 100) / 100
  const fills = rows.filter((r) => r.status === 'executed' && r.executed_at).map((r) => String(r.executed_at)).sort()
  const startedAt = fills[0] || null
  const returnPct = startedAt && cap > 0 ? (equity / cap - 1) * 100 : null
  const bs = Number(benchStart), bn = Number(benchNow)
  const benchReturnPct = startedAt && benchStart !== null && benchNow !== null && bs > 0 && bn > 0 ? (bn / bs - 1) * 100 : null
  return {
    cash, equity, startedAt, returnPct, benchReturnPct,
    alphaPct: returnPct !== null && benchReturnPct !== null ? returnPct - benchReturnPct : null,
  }
}

/**
 * Whole shares a DCA period may buy: the period budget, capped by the cash
 * actually in the account. `cash: null` means the balance could not be read —
 * fall back to the budget so a broken connection still reaches the broker and
 * surfaces as a rejection (and a stuck-strategy alert). 0 means wait: an
 * account that cannot afford a share is waiting for a deposit, not failing.
 */
export function dcaAffordableQty(input) {
  const { budget, price, cash } = input || {};
  const p = Number(price), b = Number(budget);
  if (!(p > 0) || !(b > 0)) return 0;
  const c = cash === null || cash === undefined ? Infinity : Number(cash);
  const spend = Math.min(b, Number.isFinite(c) || c === Infinity ? Math.max(0, c) : 0);
  return Math.floor(spend / p);
}
