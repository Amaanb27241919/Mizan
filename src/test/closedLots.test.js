import { describe, it, expect } from 'vitest'
import { matchClosedLots, closedLotsCsv, isLongTerm, DEFAULT_RATES, ZAKAT_RATE } from '../../lib/trading/closedLots.mjs'

// Shape copied from a real Alpaca paper FILL activity (2026-10-02): every
// numeric is a STRING and qty is the increment for that fill, not cum_qty.
const fill = (symbol, side, qty, price, t) => ({
  activity_type: 'FILL', symbol, side, qty: String(qty), price: String(price), transaction_time: t,
})

describe('matchClosedLots', () => {
  it('matches a sell against the earliest buy (FIFO) and computes the gain', () => {
    const lots = matchClosedLots([
      fill('ADI', 'buy', 10, 100, '2026-01-02T14:00:00Z'),
      fill('ADI', 'buy', 10, 120, '2026-02-02T14:00:00Z'),
      fill('ADI', 'sell', 15, 130, '2026-03-02T14:00:00Z'),
    ])
    expect(lots).toHaveLength(2)
    expect(lots[0]).toMatchObject({ symbol: 'ADI', qty: 10, cost: 1000, proceeds: 1300, gain: 300 })
    expect(lots[1]).toMatchObject({ symbol: 'ADI', qty: 5, cost: 600, proceeds: 650, gain: 50 })
  })

  it('sums partial fills — the real feed splits one order into several rows', () => {
    const lots = matchClosedLots([
      fill('FLEX', 'buy', 1.619562374, 114.71, '2026-10-02T13:33:22Z'),
      fill('FLEX', 'buy', 1, 114.71, '2026-10-02T13:33:23Z'),
      fill('FLEX', 'sell', 2.619562374, 120, '2026-10-09T13:33:22Z'),
    ])
    const qty = lots.reduce((t, l) => t + l.qty, 0)
    expect(qty).toBeCloseTo(2.619562374, 9)
    expect(lots.reduce((t, l) => t + l.gain, 0)).toBeCloseTo(2.619562374 * (120 - 114.71), 6)
  })

  it('does not trust feed order (Alpaca returns newest first)', () => {
    const lots = matchClosedLots([
      fill('ADI', 'sell', 10, 130, '2026-03-02T14:00:00Z'),
      fill('ADI', 'buy', 10, 100, '2026-01-02T14:00:00Z'),
    ])
    expect(lots[0].gain).toBe(300)
  })

  it('records a loss as a negative gain, and its estimated tax as zero', () => {
    const [l] = matchClosedLots([
      fill('TGT', 'buy', 2, 150, '2026-01-02T14:00:00Z'),
      fill('TGT', 'sell', 2, 140, '2026-01-09T14:00:00Z'),
    ])
    expect(l.gain).toBe(-20)
    expect(l.est_tax).toBe(0)
  })

  it('splits short and long term at one year, and taxes each at its own rate', () => {
    const [short] = matchClosedLots([
      fill('A', 'buy', 1, 100, '2025-01-02T14:00:00Z'), fill('A', 'sell', 1, 200, '2026-01-02T14:00:00Z'),
    ])
    const [long] = matchClosedLots([
      fill('A', 'buy', 1, 100, '2025-01-02T14:00:00Z'), fill('A', 'sell', 1, 200, '2026-01-03T14:00:00Z'),
    ])
    expect(short.term).toBe('short')
    expect(long.term).toBe('long')
    expect(short.est_tax).toBeCloseTo(100 * DEFAULT_RATES.short, 6)
    expect(long.est_tax).toBeCloseTo(100 * DEFAULT_RATES.long, 6)
  })

  it('uses caller-supplied rates', () => {
    const [l] = matchClosedLots([
      fill('A', 'buy', 1, 100, '2026-01-02T14:00:00Z'), fill('A', 'sell', 1, 200, '2026-02-02T14:00:00Z'),
    ], { rates: { short: 0.32, long: 0.15 } })
    expect(l.est_tax).toBeCloseTo(32, 6)
  })

  it('estimates zakat as 2.5% of proceeds — wealth, not the gain', () => {
    const [l] = matchClosedLots([
      fill('A', 'buy', 1, 100, '2026-01-02T14:00:00Z'), fill('A', 'sell', 1, 200, '2026-02-02T14:00:00Z'),
    ])
    expect(l.zakat_est).toBeCloseTo(200 * ZAKAT_RATE, 6)
  })

  it('leaves unsold shares out — only closed lots belong on a realized sheet', () => {
    expect(matchClosedLots([fill('ADI', 'buy', 10, 100, '2026-01-02T14:00:00Z')])).toEqual([])
  })

  it('flags a sell with no matching buy instead of inventing a cost basis', () => {
    const [l] = matchClosedLots([fill('X', 'sell', 3, 50, '2026-01-02T14:00:00Z')])
    expect(l).toMatchObject({ symbol: 'X', qty: 3, cost: null, gain: null, unmatched: true })
  })

  it('ignores junk rows and survives malformed input', () => {
    expect(matchClosedLots(null)).toEqual([])
    expect(matchClosedLots({ error: 'x' })).toEqual([])
    expect(matchClosedLots([null, { symbol: 'A', side: 'buy', qty: 'NaN', price: '1' }])).toEqual([])
  })
})

describe('isLongTerm', () => {
  it('requires MORE than one year, the IRS rule', () => {
    expect(isLongTerm('2025-03-01', '2026-03-01')).toBe(false)
    expect(isLongTerm('2025-03-01', '2026-03-02')).toBe(true)
    expect(isLongTerm('2024-02-29', '2025-03-01')).toBe(true)
  })
})

describe('closedLotsCsv', () => {
  it('writes a header, one row per lot, a total, and the assumptions it used', () => {
    const lots = matchClosedLots([
      fill('ADI', 'buy', 10, 100, '2026-01-02T14:00:00Z'), fill('ADI', 'sell', 10, 130, '2026-03-02T14:00:00Z'),
    ])
    const csv = closedLotsCsv(lots)
    const lines = csv.trim().split('\n')
    expect(lines[0]).toMatch(/^symbol,qty,buy_date,sell_date/)
    expect(lines[1]).toMatch(/^ADI,10,2026-01-02,2026-03-02/)
    expect(csv).toMatch(/TOTAL/)
    expect(csv).toMatch(/22%/)
    expect(csv).toMatch(/scholar/i)
  })

  it('still produces a usable sheet when nothing has been sold yet', () => {
    const csv = closedLotsCsv([])
    expect(csv.split('\n')[0]).toMatch(/^symbol,/)
    expect(csv).toMatch(/No closed trades yet/)
  })
})
