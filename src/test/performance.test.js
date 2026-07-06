import { describe, it, expect } from 'vitest'
import {
  xirr,
  buildCashflows,
  moneyWeightedReturn,
  unrealizedFromHoldings,
  realizedFromActivities,
  dailyReturns,
  flowsByDate,
  maxDrawdown,
  annualizedVolatility,
  annualizedReturn,
  sharpeRatio,
  riskMetrics,
} from '../lib/performance.js'

describe('xirr', () => {
  it('returns ~10%/yr for 1000 in, 1100 out one year later', () => {
    // 2024 is a leap year (366 days) so annualized is a touch under 10%.
    const r = xirr([
      { date: '2024-01-01', amount: -1000 },
      { date: '2025-01-01', amount: 1100 },
    ])
    expect(r).toBeCloseTo(0.0998, 2)
  })

  it('matches the classic Excel XIRR fixture (~37.34%)', () => {
    const r = xirr([
      { date: '2008-01-01', amount: -10000 },
      { date: '2008-03-01', amount: 2750 },
      { date: '2008-10-30', amount: 4250 },
      { date: '2009-02-15', amount: 3250 },
      { date: '2009-04-01', amount: 2750 },
    ])
    expect(r).toBeCloseTo(0.3734, 3)
  })

  it('handles a loss (−10%)', () => {
    const r = xirr([
      { date: '2024-01-01', amount: -1000 },
      { date: '2025-01-01', amount: 900 },
    ])
    expect(r).toBeCloseTo(-0.0998, 2)
  })

  it('returns null without both an inflow and an outflow', () => {
    expect(xirr([{ date: '2024-01-01', amount: -1000 }, { date: '2025-01-01', amount: -500 }])).toBeNull()
    expect(xirr([{ date: '2024-01-01', amount: 1000 }])).toBeNull()
    expect(xirr([])).toBeNull()
  })
})

describe('buildCashflows', () => {
  it('makes deposits negative, withdrawals positive, and appends terminal value', () => {
    const cfs = buildCashflows(
      [
        { type: 'DEPOSIT', amount: 1000, trade_date: '2024-01-01' },
        { type: 'WITHDRAWAL', amount: 200, trade_date: '2024-06-01' },
        { type: 'DIVIDEND', amount: 50, trade_date: '2024-03-01' }, // internal → ignored
      ],
      1200,
      new Date('2025-01-01'),
    )
    expect(cfs).toContainEqual({ date: '2024-01-01', amount: -1000 })
    expect(cfs).toContainEqual({ date: '2024-06-01', amount: 200 })
    expect(cfs.some((c) => c.amount === 1200)).toBe(true)
    expect(cfs.some((c) => c.amount === 50 || c.amount === -50)).toBe(false)
  })
})

describe('moneyWeightedReturn', () => {
  it('computes a positive annualized rate for a growing account', () => {
    const acts = [
      { type: 'DEPOSIT', amount: 10000, trade_date: '2024-01-01' },
      { type: 'DEPOSIT', amount: 5000, trade_date: '2024-07-01' },
    ]
    const { rate, hasFlows } = moneyWeightedReturn(acts, 16500, new Date('2025-01-01'))
    expect(hasFlows).toBe(true)
    expect(rate).toBeGreaterThan(0)
    expect(rate).toBeLessThan(0.5)
  })

  it('flags when there are no contributions', () => {
    expect(moneyWeightedReturn([], 1000).hasFlows).toBe(false)
  })
})

describe('unrealizedFromHoldings', () => {
  it('sums market value, cost, and unrealized gain', () => {
    const { marketValue, cost, unrealized } = unrealizedFromHoldings([
      { sh: 10, px: 100, ac: 80 },
      { sh: 5, px: 50, ac: 60 },
    ])
    expect(marketValue).toBe(10 * 100 + 5 * 50)
    expect(cost).toBe(10 * 80 + 5 * 60)
    expect(unrealized).toBe(marketValue - cost)
  })

  it('ignores zero/negative share rows', () => {
    expect(unrealizedFromHoldings([{ sh: 0, px: 100, ac: 80 }]).marketValue).toBe(0)
  })
})

describe('realizedFromActivities', () => {
  it('computes proceeds − units×avgCost for sells and counts missing basis', () => {
    const acts = [
      { type: 'SELL', symbol: 'AAPL', amount: 1500, units: 10, trade_date: '2024-05-01' },
      { type: 'SELL', symbol: 'TSLA', amount: 900, units: 5, trade_date: '2024-06-01' }, // no basis
      { type: 'BUY', symbol: 'AAPL', amount: 1000, units: 10, trade_date: '2024-01-01' },
    ]
    const { realized, missingBasis } = realizedFromActivities(acts, { AAPL: 100 }, (s) => String(s).toUpperCase())
    expect(realized).toBe(1500 - 10 * 100) // 500
    expect(missingBasis).toBe(1)
  })
})

describe('risk metrics', () => {
  it('flowsByDate nets deposits and withdrawals per day', () => {
    const f = flowsByDate([
      { type: 'DEPOSIT', amount: 500, trade_date: '2024-01-02' },
      { type: 'WITHDRAWAL', amount: 200, trade_date: '2024-01-02' },
    ])
    expect(f['2024-01-02']).toBe(300)
  })

  it('dailyReturns are flow-adjusted so a deposit is not counted as a gain', () => {
    const dr = dailyReturns(
      [{ date: '2024-01-01', total: 1000 }, { date: '2024-01-02', total: 1500 }],
      { '2024-01-02': 500 },
    )
    expect(dr[0]).toBeCloseTo(0, 9)
  })

  it('maxDrawdown captures the largest peak-to-trough drop', () => {
    expect(maxDrawdown([0.01, 0.02, -0.5, 0.1, 0.05])).toBeCloseTo(0.5, 2)
    expect(maxDrawdown([])).toBe(0)
  })

  it('annualized volatility and return scale by the trading calendar', () => {
    const rets = [0.01, -0.01, 0.02, -0.02, 0.015]
    expect(annualizedVolatility(rets)).toBeGreaterThan(0)
    expect(annualizedReturn(rets)).toBeCloseTo((rets.reduce((s, x) => s + x, 0) / rets.length) * 252, 6)
  })

  it('sharpeRatio is null when volatility is zero', () => {
    expect(sharpeRatio([0.01, 0.01, 0.01])).toBeNull()
  })

  it('riskMetrics gates on a minimum number of daily points', () => {
    const short = riskMetrics([{ date: '2024-01-01', total: 1000 }, { date: '2024-01-02', total: 1010 }], [], { minPoints: 20 })
    expect(short.ready).toBe(false)
    expect(short.needed).toBe(20)

    const history = Array.from({ length: 30 }, (_, i) => ({
      date: `2024-02-${String(i + 1).padStart(2, '0')}`,
      total: 1000 * (1 + 0.001 * i),
    }))
    const full = riskMetrics(history, [], { minPoints: 20 })
    expect(full.ready).toBe(true)
    expect(full.points).toBeGreaterThanOrEqual(20)
    expect(full.maxDrawdown).toBeGreaterThanOrEqual(0)
  })
})
