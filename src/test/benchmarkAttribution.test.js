import { describe, it, expect } from 'vitest'
import { dayKey, alignSeries, pctReturn, maxDrawdown, attribution, confidenceLabel } from '../lib/benchmarkAttribution.js'

// Midday UTC = the morning of the same New York trading day, so each date in
// these tests means its own session under dayKey's market-time keying.
const D = (iso) => new Date(iso + 'T12:00:00Z').getTime()
const pts = (pairs) => pairs.map(([d, v]) => ({ t: D(d), v }))

describe('alignSeries', () => {
  it('compares only days BOTH series have', () => {
    // The whole reason this module exists. A strategy funded on Thursday vs
    // SPUS year-to-date is arithmetically fine and completely meaningless.
    const s = pts([['2026-10-01', 100], ['2026-10-02', 101]])
    const b = pts([['2026-09-01', 50], ['2026-10-01', 60], ['2026-10-02', 61], ['2026-10-03', 62]])
    const a = alignSeries(s, b)
    expect(a.days).toEqual(['2026-10-01', '2026-10-02'])
    expect(a.strategy).toEqual([100, 101])
    expect(a.benchmark).toEqual([60, 61])
    expect(a.dropped.benchmark).toBe(2)   // Sept 1 and Oct 3 had no counterpart
    expect(a.dropped.strategy).toBe(0)
  })

  it('keeps the index alignment exact, never off by one', () => {
    const s = pts([['2026-10-01', 1], ['2026-10-03', 3]])
    const b = pts([['2026-10-01', 10], ['2026-10-02', 20], ['2026-10-03', 30]])
    const a = alignSeries(s, b)
    expect(a.strategy).toEqual([1, 3])
    expect(a.benchmark).toEqual([10, 30])   // NOT [10, 20]
  })

  it('takes the last value within a day, so intraday ends at its close', () => {
    const s = [{ t: D('2026-10-01') + 1000, v: 100 }, { t: D('2026-10-01') + 9e6, v: 104 }]
    const b = pts([['2026-10-01', 50]])
    expect(alignSeries(s, b).strategy).toEqual([104])
  })

  it('returns an empty alignment rather than throwing on garbage', () => {
    for (const bad of [null, undefined, 'x', 42, {}]) {
      expect(alignSeries(bad, bad).days).toEqual([])
    }
    expect(alignSeries([{ t: null, v: 1 }], [{ t: D('2026-10-01'), v: 2 }]).days).toEqual([])
  })

  it('sorts oldest first even when the input is not sorted', () => {
    const s = pts([['2026-10-03', 3], ['2026-10-01', 1]])
    const b = pts([['2026-10-01', 10], ['2026-10-03', 30]])
    expect(alignSeries(s, b).days).toEqual(['2026-10-01', '2026-10-03'])
  })
})

describe('pctReturn', () => {
  it('measures first to last', () => {
    expect(pctReturn([100, 110])).toBeCloseTo(10, 10)
    expect(pctReturn([100, 90])).toBeCloseTo(-10, 10)
  })

  it('refuses rather than dividing by zero', () => {
    expect(pctReturn([0, 10])).toBeNull()
    expect(pctReturn([100])).toBeNull()
    expect(pctReturn([])).toBeNull()
    expect(pctReturn(null)).toBeNull()
  })
})

describe('maxDrawdown', () => {
  it('finds the worst peak-to-trough fall as a negative percent', () => {
    expect(maxDrawdown([100, 120, 90, 110])).toBeCloseTo(-25, 10)   // 120 -> 90
  })

  it('is 0, not null, for a series that only rises', () => {
    // Zero means "never fell". Null would mean "cannot say", and a dashboard
    // has to tell those apart.
    expect(maxDrawdown([100, 110, 120])).toBe(0)
  })
})

describe('attribution', () => {
  const s = pts([['2026-10-01', 100000], ['2026-10-02', 100604]])
  const b = pts([['2026-10-01', 59.72],  ['2026-10-02', 60.60]])

  it('states alpha in percentage POINTS, including when negative', () => {
    // Day one of the real strategy: +0.60% against SPUS +1.47%. The dashboard
    // must show the shortfall, not bury it behind a win rate.
    const a = attribution(s, b)
    expect(a.strategyReturn).toBeCloseTo(0.604, 2)
    expect(a.benchmarkReturn).toBeCloseTo(1.474, 2)
    expect(a.alpha).toBeLessThan(0)
    expect(a.alpha).toBeCloseTo(-0.87, 1)
    expect(a.comparable).toBe(true)
  })

  it('refuses to compare a single aligned day', () => {
    const one = attribution(pts([['2026-10-02', 100]]), pts([['2026-10-02', 50]]))
    expect(one.comparable).toBe(false)
    expect(one.alpha).toBeNull()
    expect(one.days).toBe(1)
  })

  it('reports the window it actually measured', () => {
    const a = attribution(s, pts([['2026-09-01', 55], ['2026-10-01', 59.72], ['2026-10-02', 60.60]]))
    expect(a.window.from).toBe('2026-10-01')
    expect(a.window.to).toBe('2026-10-02')
    expect(a.window.dropped.benchmark).toBe(1)
  })

  it('carries drawdown for both sides', () => {
    // Beating a benchmark on twice its drawdown is not beating it.
    const a = attribution(
      pts([['2026-10-01', 100], ['2026-10-02', 70], ['2026-10-03', 120]]),
      pts([['2026-10-01', 100], ['2026-10-02', 99], ['2026-10-03', 110]]),
    )
    expect(a.strategyDrawdown).toBeCloseTo(-30, 10)
    expect(a.benchmarkDrawdown).toBeCloseTo(-1, 10)
    expect(a.alpha).toBeGreaterThan(0)   // beat it, and the drawdown says how
  })

  it('never throws on garbage', () => {
    for (const bad of [null, undefined, 'x', {}]) {
      const a = attribution(bad, bad)
      expect(a.comparable).toBe(false)
      expect(a.alpha).toBeNull()
    }
  })
})

describe('confidenceLabel', () => {
  it('calls a short record noise, not a result', () => {
    expect(confidenceLabel(1).level).toBe('none')
    expect(confidenceLabel(2).level).toBe('noise')
    expect(confidenceLabel(10).level).toBe('noise')
    expect(confidenceLabel(10).note).toMatch(/noise, not evidence/i)
  })

  it('never claims proof, even at the longest horizon', () => {
    const long = confidenceLabel(500)
    expect(long.level).toBe('meaningful')
    expect(long.note).toMatch(/not proof/i)
  })

  it('handles garbage as the shortest possible record', () => {
    expect(confidenceLabel(null).level).toBe('none')
    expect(confidenceLabel('x').level).toBe('none')
  })
})

// Real stamps from 2026-10-06. Alpaca daily EQUITY points are stamped 00:00Z
// (= 20:00 ET the evening of that trading day); SPUS daily BARS are stamped
// 04:00Z (= 00:00 ET of their own day). Keyed by UTC date, Monday's equity
// close landed on Tuesday and was compared with Tuesday's SPUS bar.
describe('day alignment in market time (America/New_York)', () => {
  const T = (iso) => Date.parse(iso)

  it('keys an equity close and its SPUS bar to the SAME trading day', () => {
    expect(dayKey(T('2026-10-03T00:00:00Z'))).toBe('2026-10-02') // Friday close
    expect(dayKey(T('2026-10-02T04:00:00Z'))).toBe('2026-10-02') // Friday SPUS bar
    expect(dayKey(T('2026-10-06T00:00:00Z'))).toBe('2026-10-05') // Monday close
  })

  it('aligns the real 2026-10-06 series day for day', () => {
    const equity = [
      { t: T('2026-10-02T00:00:00Z'), v: 100000 },
      { t: T('2026-10-03T00:00:00Z'), v: 100721.89 },
      { t: T('2026-10-06T00:00:00Z'), v: 101191.65 },
    ]
    const spus = [
      { t: T('2026-10-01T04:00:00Z'), v: 59.72 },
      { t: T('2026-10-02T04:00:00Z'), v: 60.33 },
      { t: T('2026-10-05T04:00:00Z'), v: 60.81 },
      { t: T('2026-10-06T04:00:00Z'), v: 61.15 },
    ]
    const a = alignSeries(equity, spus)
    expect(a.days).toEqual(['2026-10-01', '2026-10-02', '2026-10-05'])
    expect(a.benchmark).toEqual([59.72, 60.33, 60.81])
  })

  it('starts the window when the account first moved, not during idle weeks of cash', () => {
    const flat = (d) => ({ t: T(`2026-09-${d}T00:00:00Z`), v: 100000 })
    const equity = [flat(10), flat(17), flat(24), { t: T('2026-10-02T00:00:00Z'), v: 100000 },
      { t: T('2026-10-03T00:00:00Z'), v: 101000 }]
    const spus = [
      { t: T('2026-09-09T04:00:00Z'), v: 50 }, { t: T('2026-09-16T04:00:00Z'), v: 52 },
      { t: T('2026-09-23T04:00:00Z'), v: 55 }, { t: T('2026-10-01T04:00:00Z'), v: 59 },
      { t: T('2026-10-02T04:00:00Z'), v: 60 },
    ]
    const r = attribution(equity, spus)
    expect(r.window.from).toBe('2026-10-01')        // the last idle close, right before trading
    // pctReturn reports PERCENT (1 = 1%).
    expect(r.strategyReturn).toBeCloseTo(1, 9)
    expect(r.benchmarkReturn).toBeCloseTo((60 / 59 - 1) * 100, 9)
  })
})
