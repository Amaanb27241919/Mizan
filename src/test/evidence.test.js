import { describe, it, expect } from 'vitest'
import {
  normalizeFundamentals, normalizeMarketExtras, normalizeNews, FUNDAMENTAL_UNITS,
} from '../../lib/ai/evidence.mjs'

// Shape and values taken from a real Finnhub response for COHR, 2026-10-02.
const FINNHUB = {
  metric: {
    peTTM: 69.8782, psTTM: 7.9026, pbQuarterly: 7.0779,
    revenueGrowthTTMYoy: 22.51, epsGrowthTTMYoy: 1617.2,
    grossMarginTTM: 37.5, netProfitMarginTTM: 11.31, roeTTM: 8.37,
    'totalDebt/totalEquityQuarterly': 0.2955,
    currentRatioQuarterly: 2.4267, beta: 2.172559,
    '52WeekHigh': 440, '52WeekLow': 105.02,
    '3MonthAverageTradingVolume': 6.12729,
    // 110+ other metrics the model never needs
    cashFlowPerShareTTM: 3.2, dividendYieldIndicatedAnnual: 0, pretaxMarginTTM: 12.1,
  },
}

describe('normalizeFundamentals — a subset, deliberately', () => {
  it('keeps the metrics that matter and drops the rest', () => {
    // 126 metrics in, a handful out. A model handed a wall of weakly-related
    // ratios pattern-matches on whatever looks dramatic.
    const f = normalizeFundamentals(FINNHUB)
    expect(f.pe_ttm).toBeCloseTo(69.88, 2)
    expect(f.revenue_growth_yoy_pct).toBeCloseTo(22.51, 2)
    expect(f.debt_to_equity_ratio).toBeCloseTo(0.2955, 4)
    expect(f.cashFlowPerShareTTM).toBeUndefined()
    expect(f.pretaxMarginTTM).toBeUndefined()
    expect(Object.keys(f).length).toBeLessThan(15)
  })

  it('names every field with its UNIT, because Finnhub mixes them', () => {
    // debt/equity is a RATIO (0.2955), margins are PERCENT. A model reading
    // 0.2955 as a percentage concludes the company has almost no debt.
    const f = normalizeFundamentals(FINNHUB)
    expect(Object.keys(f).filter(k => k.endsWith('_pct')).length).toBeGreaterThan(2)
    expect('debt_to_equity_ratio' in f).toBe(true)
    expect(FUNDAMENTAL_UNITS.debt_to_equity_ratio).toMatch(/0\.30 = 30%/)
  })

  it('drops a nonsense P/E rather than presenting it as a valuation', () => {
    // Negative or absurd P/E is an earnings artefact, not information.
    expect(normalizeFundamentals({ metric: { ...FINNHUB.metric, peTTM: -12 } }).pe_ttm).toBeUndefined()
    expect(normalizeFundamentals({ metric: { ...FINNHUB.metric, peTTM: 99999 } }).pe_ttm).toBeUndefined()
    expect(normalizeFundamentals({ metric: { ...FINNHUB.metric, peTTM: 0 } }).pe_ttm).toBeUndefined()
  })

  it('returns NULL, not an object of nulls, when nothing is usable', () => {
    // The packet lists a null section in `missing`, which tells the model the
    // data was never fetched. An object of nulls would instead look like a
    // company with no measurable fundamentals.
    expect(normalizeFundamentals({ metric: {} })).toBeNull()
    expect(normalizeFundamentals({ metric: { peTTM: null, beta: '' } })).toBeNull()
    expect(normalizeFundamentals(null)).toBeNull()
    expect(normalizeFundamentals('x')).toBeNull()
    expect(normalizeFundamentals(42)).toBeNull()
  })

  it('accepts the metric block directly or wrapped', () => {
    expect(normalizeFundamentals(FINNHUB.metric).beta).toBeCloseTo(2.1726, 3)
  })

  it('never lets a boolean become a number', () => {
    expect(normalizeFundamentals({ metric: { beta: true } })).toBeNull()
  })
})

describe('normalizeMarketExtras — volume units are a trap', () => {
  it('converts 3-month average volume from MILLIONS to shares', () => {
    // Finnhub reports 6.12729 meaning ~6.1 million shares. Passed through raw,
    // a model sees a company trading six shares a day.
    const x = normalizeMarketExtras(FINNHUB)
    expect(x.avg_volume_3m).toBe(6_127_290)
  })

  it('carries the 52-week range', () => {
    const x = normalizeMarketExtras(FINNHUB)
    expect(x.week52_high).toBe(440)
    expect(x.week52_low).toBeCloseTo(105.02, 2)
  })

  it('returns null when it has nothing', () => {
    expect(normalizeMarketExtras({ metric: {} })).toBeNull()
    expect(normalizeMarketExtras(null)).toBeNull()
  })
})

describe('normalizeNews — provenance and staleness', () => {
  const NOW = Date.parse('2026-10-02T18:00:00Z')
  const art = (over = {}) => ({
    headline: 'Coherent beats on optical demand',
    source: 'benzinga',
    created_at: '2026-10-02T17:00:00Z',
    url: 'https://example.test/a',
    symbols: ['COHR'],
    ...over,
  })

  it('keeps only articles tagged with the subject symbol', () => {
    const r = normalizeNews({ news: [art(), art({ symbols: ['MU'] })] }, 'COHR', { now: NOW })
    expect(r).toHaveLength(1)
    expect(r[0].headline).toMatch(/Coherent/)
  })

  it('preserves the OTHER symbols, so relevance is the model\'s to judge', () => {
    // An article tagged with eight symbols is usually about one of them.
    // Presenting it as news "about" each overstates it.
    const r = normalizeNews({ news: [art({ symbols: ['COHR', 'MU', 'NVDA'] })] }, 'COHR', { now: NOW })
    expect(r[0].also_mentions).toEqual(['MU', 'NVDA'])
  })

  it('FLAGS a broad roundup rather than dropping or promoting it', () => {
    // Still weak evidence. Dropping it silently would be its own distortion.
    const wide = art({ symbols: ['COHR', 'A', 'B', 'C', 'D', 'E'] })
    const r = normalizeNews({ news: [wide] }, 'COHR', { now: NOW })
    expect(r[0].broad).toBe(true)
    const narrow = normalizeNews({ news: [art()] }, 'COHR', { now: NOW })
    expect(narrow[0].broad).toBe(false)
  })

  it('drops stale items — a 3-week headline beside a live price reads as current', () => {
    const old = art({ created_at: '2026-09-01T12:00:00Z' })
    expect(normalizeNews({ news: [old] }, 'COHR', { now: NOW })).toBeNull()
    expect(normalizeNews({ news: [old] }, 'COHR', { now: NOW, maxAgeDays: 60 })).toHaveLength(1)
  })

  it('keeps an undated item rather than guessing it is stale', () => {
    const r = normalizeNews({ news: [art({ created_at: null })] }, 'COHR', { now: NOW })
    expect(r).toHaveLength(1)
    expect(r[0].published_at).toBeNull()
  })

  it('orders newest first', () => {
    const r = normalizeNews({ news: [
      art({ headline: 'older', created_at: '2026-09-30T12:00:00Z' }),
      art({ headline: 'newer', created_at: '2026-10-02T12:00:00Z' }),
    ] }, 'COHR', { now: NOW })
    expect(r.map(x => x.headline)).toEqual(['newer', 'older'])
  })

  it('caps the list', () => {
    const many = Array.from({ length: 40 }, (_, i) => art({ headline: `h${i}` }))
    expect(normalizeNews({ news: many }, 'COHR', { now: NOW }).length).toBeLessThanOrEqual(8)
  })

  it('returns null rather than an empty array', () => {
    // Null makes the packet list `news` in `missing`; [] would read as
    // "we looked and there is genuinely no news", which is a different claim.
    expect(normalizeNews({ news: [] }, 'COHR', { now: NOW })).toBeNull()
    expect(normalizeNews({ news: [art({ symbols: ['MU'] })] }, 'COHR', { now: NOW })).toBeNull()
  })

  it('never throws on garbage', () => {
    for (const bad of [null, undefined, 42, 'x', { news: 'nope' }, { news: [null, {}] }]) {
      expect(() => normalizeNews(bad, 'COHR', { now: NOW })).not.toThrow()
    }
    expect(normalizeNews({ news: [art()] }, '', { now: NOW })).toBeNull()
  })
})
