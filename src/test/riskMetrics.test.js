import { describe, it, expect } from 'vitest'
import { herfindahl, concentration, groupExposure, maxDrawdown } from '../lib/riskMetrics.js'

const pos = (symbol, value) => ({ symbol, value })

describe('herfindahl', () => {
  it('gives 1/n for n equal weights', () => {
    expect(herfindahl([1, 1, 1, 1])).toBeCloseTo(0.25, 10)
    expect(herfindahl([25, 25, 25, 25, 25])).toBeCloseTo(0.2, 10)
  })

  it('goes to 1 as the book collapses into one name', () => {
    expect(herfindahl([100])).toBeCloseTo(1, 10)
    expect(herfindahl([99, 1])).toBeGreaterThan(0.95)
  })

  it('is null when there is nothing to measure', () => {
    for (const bad of [null, undefined, [], [0, 0], ['x'], 42, {}]) {
      expect(herfindahl(bad), String(bad)).toBeNull()
    }
  })
})

describe('concentration', () => {
  it('reports effective names, which is the number worth reading', () => {
    // 25 equal positions really are 25 bets.
    const even = Array.from({ length: 25 }, (_, i) => pos(`S${i}`, 4000))
    expect(concentration(even).effectiveNames).toBe(25)
  })

  it('shows a lopsided book as far fewer bets than it has positions', () => {
    const lopsided = [pos('A', 90000), ...Array.from({ length: 9 }, (_, i) => pos(`S${i}`, 1111))]
    const c = concentration(lopsided)
    expect(c.count).toBe(10)
    expect(c.effectiveNames).toBeLessThan(2)   // ten positions, one real bet
    expect(c.largest.symbol).toBe('A')
  })

  it('sorts rows and computes the top-K weight', () => {
    const c = concentration([pos('A', 100), pos('B', 300), pos('C', 200)], { topK: 2 })
    expect(c.rows.map(r => r.symbol)).toEqual(['B', 'C', 'A'])
    expect(c.topWeight).toBeCloseTo(500 / 600, 10)
  })

  it('returns an explicitly empty shape, never NaN, on nothing', () => {
    for (const bad of [null, undefined, [], [pos('A', 0)], 'x', 42]) {
      const c = concentration(bad)
      expect(c.count, String(bad)).toBe(0)
      expect(c.effectiveNames).toBeNull()
      expect(c.topWeight).toBeNull()
    }
  })
})

describe('groupExposure — the AI-hardware case', () => {
  // The live book: inverse-vol sizing makes weights look even, which is what
  // hides that most of the names are the same bet.
  const BOOK = [
    pos('NVDA', 4000), pos('AMD', 4000), pos('MU', 4000), pos('AVGO', 4000),
    pos('COHR', 4000), pos('CRDO', 4000),
    pos('TGT', 4000), pos('KO', 4000),
  ]
  const INDUSTRY = {
    NVDA: 'Semiconductors', AMD: 'Semiconductors', MU: 'Semiconductors',
    AVGO: 'Semiconductors', COHR: 'Semiconductors', CRDO: 'Semiconductors',
    TGT: 'Retail', KO: 'Beverages',
  }

  it('surfaces the cluster that even weights hide', () => {
    const g = groupExposure(BOOK, s => INDUSTRY[s])
    expect(g.largest.label).toBe('Semiconductors')
    expect(g.largest.share).toBeCloseTo(6 / 8, 10)     // 75% of the book, one bet
    expect(g.largest.symbols).toHaveLength(6)
    expect(g.coverage).toBe(1)
  })

  it('reports coverage instead of inventing an Other bucket', () => {
    // Half the book has no industry on its cached verdict.
    const g = groupExposure(BOOK, s => (s === 'NVDA' || s === 'AMD' ? INDUSTRY[s] : null))
    expect(g.unknown).toBe(6)
    expect(g.labelled).toBe(2)
    expect(g.coverage).toBeCloseTo(0.25, 10)
    // No bucket named Other/Unknown competing with real ones.
    expect(g.groups.map(x => x.label)).toEqual(['Semiconductors'])
  })

  it('computes shares over the LABELLED value, not the whole book', () => {
    // Otherwise a 100%-of-what-we-know bucket reads as 25% and understates it.
    const g = groupExposure(BOOK, s => (s === 'NVDA' ? 'Semiconductors' : null))
    expect(g.groups[0].share).toBe(1)
    expect(g.coverage).toBeCloseTo(1 / 8, 10)
  })

  it('survives a labeller that throws or returns junk', () => {
    expect(() => groupExposure(BOOK, () => { throw new Error('boom') })).not.toThrow()
    const g = groupExposure(BOOK, () => ({}))
    expect(g.unknown).toBe(8)
    expect(g.groups).toEqual([])
  })

  it('never throws on garbage input', () => {
    for (const bad of [null, undefined, 42, 'x', [null, {}, pos('', 5)]]) {
      expect(() => groupExposure(bad, bad)).not.toThrow()
    }
  })
})

describe('maxDrawdown', () => {
  it('finds the deepest peak-to-trough, not the last dip', () => {
    const dd = maxDrawdown([100, 120, 90, 110, 105])
    expect(dd.depth).toBeCloseTo(0.25, 10)     // 120 -> 90
    expect(dd.measurable).toBe(true)
  })

  it('is 0 for a series that only rises', () => {
    const dd = maxDrawdown([100, 101, 102, 103])
    expect(dd.depth).toBe(0)
    expect(dd.peak).toBeNull()                  // no drawdown to point at
  })

  it('distinguishes NO drawdown from NOT MEASURABLE', () => {
    // A two-day-old account has not had a 0% drawdown; it has had no history.
    const none = maxDrawdown([100, 101])
    expect(none.measurable).toBe(false)
    expect(none.depth).toBeNull()
    expect(maxDrawdown([100, 101, 102]).depth).toBe(0)
  })

  it('carries the dates when given points', () => {
    const dd = maxDrawdown([
      { date: '2026-10-01', value: 100 },
      { date: '2026-10-02', value: 130 },
      { date: '2026-10-03', value: 104 },
    ])
    expect(dd.peak.date).toBe('2026-10-02')
    expect(dd.trough.date).toBe('2026-10-03')
    expect(dd.depth).toBeCloseTo(0.2, 10)
  })

  it('drops non-finite and non-positive points rather than skewing', () => {
    const dd = maxDrawdown([100, null, NaN, 0, -5, 120, 90])
    expect(dd.points).toBe(3)
    expect(dd.depth).toBeCloseTo(0.25, 10)
  })

  it('never throws on garbage', () => {
    for (const bad of [null, undefined, 42, 'x', [{}, null]]) {
      expect(() => maxDrawdown(bad), String(bad)).not.toThrow()
      expect(maxDrawdown(bad).measurable).toBe(false)
    }
  })
})
