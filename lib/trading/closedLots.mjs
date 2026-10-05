/**
 * Pure (no I/O): turn broker fills into a realized-trade sheet — one row per
 * closed lot, with gain, holding term, an estimated tax and a Zakat estimate.
 *
 * Fills are matched FIFO, the IRS default when no lot is specified. Input is
 * Alpaca's FILL activity shape: every numeric is a STRING, `qty` is the size of
 * THAT fill (one order arrives as several partial_fill rows), and the feed is
 * newest-first, so nothing here trusts order.
 *
 * Two framing rules the output states rather than hides:
 *   - Tax is an ESTIMATE at rates the caller supplies (defaults below). Mizan
 *     does not know the user's bracket, state tax, or wash-sale history.
 *   - Zakat is not levied per sale. It is 2.5% of zakatable wealth held a lunar
 *     year above nisab. The column is 2.5% of PROCEEDS — what the sale adds to
 *     that wealth if still held at the user's Zakat date — never 2.5% of the gain.
 */

export const DEFAULT_RATES = Object.freeze({ short: 0.22, long: 0.15 })
export const ZAKAT_RATE = 0.025
const EPS = 1e-9

const arr = (x) => (Array.isArray(x) ? x : [])
const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v))
const day = (t) => String(t || '').slice(0, 10)
const round2 = (n) => Math.round(n * 100) / 100

/**
 * Held MORE than one year (IRS): long-term only if sold after the anniversary.
 * @param {string} buyDate  ISO date or timestamp
 * @param {string} sellDate ISO date or timestamp
 */
export function isLongTerm(buyDate, sellDate) {
  const b = new Date(`${day(buyDate)}T00:00:00Z`)
  const s = new Date(`${day(sellDate)}T00:00:00Z`)
  if (Number.isNaN(b.getTime()) || Number.isNaN(s.getTime())) return false
  // Day 0 of the next month = the last day of this one, so a Feb 29 purchase
  // anniversaries on Feb 28 and a Mar 1 sale is long-term.
  const y = b.getUTCFullYear() + 1, m = b.getUTCMonth()
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  const anniversary = new Date(Date.UTC(y, m, Math.min(b.getUTCDate(), lastDay)))
  return s.getTime() > anniversary.getTime()
}

function cleanFills(fills) {
  return arr(fills)
    .filter((f) => f && (f.side === 'buy' || f.side === 'sell') && f.symbol)
    .map((f) => ({ symbol: String(f.symbol).toUpperCase(), side: f.side, qty: num(f.qty), price: num(f.price), t: String(f.transaction_time || '') }))
    .filter((f) => f.qty > 0 && f.price >= 0 && Number.isFinite(f.qty) && Number.isFinite(f.price))
    .sort((a, b) => a.t.localeCompare(b.t))
}

function lotRow(symbol, qty, buy, sellPrice, sellT, rates) {
  const cost = qty * buy.price
  const proceeds = qty * sellPrice
  const gain = proceeds - cost
  const term = isLongTerm(buy.t, sellT) ? 'long' : 'short'
  return {
    symbol, qty, buy_date: day(buy.t), sell_date: day(sellT),
    buy_price: buy.price, sell_price: sellPrice,
    cost, proceeds, gain, term,
    days_held: Math.round((new Date(day(sellT)) - new Date(day(buy.t))) / 86400000),
    est_tax: gain > 0 ? gain * rates[term] : 0,
    zakat_est: proceeds * ZAKAT_RATE,
    unmatched: false,
  }
}

/**
 * @param {Array<object>} fills Alpaca FILL activities
 * @param {{rates?: {short:number, long:number}}} [opts]
 * @returns {Array<object>} closed lots, oldest sale first
 */
export function matchClosedLots(fills, opts) {
  const rates = { ...DEFAULT_RATES, ...(opts?.rates || {}) }
  const open = new Map() // symbol -> FIFO queue of { qty, price, t }
  const out = []
  for (const f of cleanFills(fills)) {
    const queue = open.get(f.symbol) || []
    if (f.side === 'buy') {
      open.set(f.symbol, [...queue, { qty: f.qty, price: f.price, t: f.t }])
      continue
    }
    let remaining = f.qty
    const next = [...queue]
    while (remaining > EPS && next.length) {
      const head = next[0]
      const take = Math.min(head.qty, remaining)
      out.push(lotRow(f.symbol, take, head, f.price, f.t, rates))
      remaining -= take
      if (head.qty - take > EPS) next[0] = { ...head, qty: head.qty - take }
      else next.shift()
    }
    open.set(f.symbol, next)
    if (remaining > EPS) {
      // A sell with no recorded buy (bought before the feed window, or outside
      // Mizan). Inventing a basis would put a made-up gain on a tax sheet.
      out.push({
        symbol: f.symbol, qty: remaining, buy_date: '', sell_date: day(f.t),
        buy_price: null, sell_price: f.price, cost: null, proceeds: remaining * f.price,
        gain: null, term: '', days_held: null, est_tax: null, zakat_est: remaining * f.price * ZAKAT_RATE,
        unmatched: true,
      })
    }
  }
  return out
}

const COLS = ['symbol', 'qty', 'buy_date', 'sell_date', 'days_held', 'term', 'buy_price', 'sell_price', 'cost', 'proceeds', 'gain', 'est_tax', 'zakat_est', 'note']

function cell(v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  const s = String(v)
  // Spreadsheet formula injection guard for text cells.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/**
 * @param {Array<object>} lots output of matchClosedLots
 * @param {{rates?: {short:number, long:number}}} [opts]
 * @returns {string} CSV that opens directly in Excel
 */
export function closedLotsCsv(lots, opts) {
  const rates = { ...DEFAULT_RATES, ...(opts?.rates || {}) }
  const rows = arr(lots).filter(Boolean)
  const line = (r) => COLS.map((c) => cell(r[c])).join(',')
  const out = [COLS.join(',')]
  for (const l of rows) {
    out.push(line({
      ...l,
      qty: Number(l.qty?.toFixed?.(9) ?? l.qty),
      cost: l.cost == null ? null : round2(l.cost),
      proceeds: round2(l.proceeds),
      gain: l.gain == null ? null : round2(l.gain),
      est_tax: l.est_tax == null ? null : round2(l.est_tax),
      zakat_est: round2(l.zakat_est),
      note: l.unmatched ? 'no matching buy on record — cost basis unknown' : '',
    }))
  }
  if (!rows.length) out.push(line({ symbol: 'No closed trades yet', note: 'Rows appear after the first sale' }))
  const sum = (k) => round2(rows.reduce((t, r) => t + (Number(r[k]) || 0), 0))
  out.push(line({ symbol: 'TOTAL', cost: sum('cost'), proceeds: sum('proceeds'), gain: sum('gain'), est_tax: sum('est_tax'), zakat_est: sum('zakat_est') }))
  out.push('')
  out.push(cell(`Assumptions: lots matched first-in-first-out. Estimated tax uses ${Math.round(rates.short * 100)}% short-term and ${Math.round(rates.long * 100)}% long-term federal rates (long-term = held more than one year); your bracket, state tax and wash-sale rules are not applied. Losses show no tax.`))
  out.push(cell(`Zakat estimate: 2.5% of sale proceeds, owed only if that wealth is still held at your Zakat date and you are above nisab. Zakat is not charged per trade. Consult a qualified scholar for your situation.`))
  return `${out.join('\r\n')}\r\n`
}
