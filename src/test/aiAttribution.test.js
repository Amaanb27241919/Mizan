import { describe, it, expect } from 'vitest'
import { resolveVerdict, scoreModel, compareModels, MIN_SAMPLE } from '../../lib/ai/attribution.mjs'

const v = (over = {}) => ({
  action: 'BUY', confidence: 0.8, expectedReturnPct: 10, horizonDays: 30,
  priceAtDecision: 100, priceNow: 110,
  benchmarkAtDecision: 50, benchmarkNow: 51,   // benchmark +2%
  daysElapsed: 30,
  ...over,
})

describe('an open verdict carries NO score', () => {
  it('refuses to score before the horizon elapses', () => {
    // The easiest way to manufacture a track record is to harvest whichever
    // open positions currently look good.
    const r = resolveVerdict(v({ daysElapsed: 3 }))
    expect(r.state).toBe('open')
    expect(r.correct).toBeUndefined()
    expect(r.brier).toBeUndefined()
    expect(r.excess_pct).toBeUndefined()
  })

  it('scores once the horizon is reached', () => {
    expect(resolveVerdict(v({ daysElapsed: 30 })).state).toBe('resolved')
    expect(resolveVerdict(v({ daysElapsed: 45 })).state).toBe('resolved')
  })

  it('open verdicts never reach an aggregate', () => {
    const open = Array.from({ length: 50 }, () => resolveVerdict(v({ daysElapsed: 1 })))
    const s = scoreModel(open)
    expect(s.n_resolved).toBe(0)
    expect(s.win_rate).toBeNull()
  })
})

describe('excess, not raw — the benchmark is the bar', () => {
  it('counts a BUY that LAGGED the benchmark as WRONG', () => {
    // +5% while SPUS did +8% is a bad call. Raw return measures the market.
    const r = resolveVerdict(v({ priceNow: 105, benchmarkAtDecision: 50, benchmarkNow: 54 }))
    expect(r.return_pct).toBeCloseTo(5, 6)
    expect(r.benchmark_return_pct).toBeCloseTo(8, 6)
    expect(r.excess_pct).toBeCloseTo(-3, 6)
    expect(r.correct).toBe(false)
  })

  it('counts a BUY that beat the benchmark as right', () => {
    const r = resolveVerdict(v())            // +10% vs +2%
    expect(r.excess_pct).toBeCloseTo(8, 6)
    expect(r.correct).toBe(true)
  })

  it('inverts the sign for a SELL', () => {
    // A SELL is right when the name UNDERperforms.
    const good = resolveVerdict(v({ action: 'SELL', priceNow: 90 }))
    expect(good.correct).toBe(true)
    expect(good.signed_excess_pct).toBeGreaterThan(0)
    const bad = resolveVerdict(v({ action: 'SELL', priceNow: 130 }))
    expect(bad.correct).toBe(false)
  })

  it('falls back to raw return when no benchmark is available', () => {
    const r = resolveVerdict(v({ benchmarkAtDecision: null, benchmarkNow: null }))
    expect(r.excess_pct).toBeNull()
    expect(r.correct).toBe(true)      // +10% raw
  })
})

describe('HOLD is falsifiable, within a band', () => {
  it('is right when price stayed inside the band', () => {
    expect(resolveVerdict(v({ action: 'HOLD', priceNow: 103, holdBandPct: 5 })).correct).toBe(true)
  })
  it('is wrong when price moved past it, in EITHER direction', () => {
    expect(resolveVerdict(v({ action: 'HOLD', priceNow: 120, holdBandPct: 5 })).correct).toBe(false)
    expect(resolveVerdict(v({ action: 'HOLD', priceNow: 80, holdBandPct: 5 })).correct).toBe(false)
  })
})

describe('an abstention is not a wrong answer', () => {
  it('is resolved but NOT scored', () => {
    // Declining before a crash is a good call; declining before a rally is a
    // missed one. Neither is a directional error.
    for (const a of ['ABSTAIN', 'INSUFFICIENT_DATA']) {
      const r = resolveVerdict(v({ action: a }))
      expect(r.state).toBe('resolved')
      expect(r.scored).toBe(false)
      expect(r.correct).toBeUndefined()
      expect(r.excess_pct).toBeCloseTo(8, 6)   // what it passed up, recorded
    }
  })

  it('never enters the win rate', () => {
    const rows = [
      ...Array.from({ length: 20 }, () => resolveVerdict(v())),                    // 20 correct
      ...Array.from({ length: 30 }, () => resolveVerdict(v({ action: 'ABSTAIN' }))),
    ]
    const s = scoreModel(rows)
    expect(s.n_scored).toBe(20)
    expect(s.n_abstained).toBe(30)
    expect(s.win_rate).toBe(1)                 // 20/20, abstentions excluded
    expect(s.abstention_rate).toBeCloseTo(30 / 50, 6)
  })
})

describe('direction alone is not enough', () => {
  it('reports a model that is OFTEN right and BADLY wrong as negative-edge', () => {
    // 6 wins at +1 and 4 losses at -5: a 60% win rate and a losing strategy.
    const rows = [
      ...Array.from({ length: 12 }, () => resolveVerdict(v({ priceNow: 103, benchmarkNow: 51 }))),  // +1 excess
      ...Array.from({ length: 8 }, () => resolveVerdict(v({ priceNow: 97, benchmarkNow: 51 }))),    // -5 excess
    ]
    const s = scoreModel(rows)
    expect(s.win_rate).toBeCloseTo(0.6, 6)
    expect(s.mean_excess_pct).toBeLessThan(0)
    expect(s.edge_positive).toBe(false)        // the number that matters
  })

  it('separates the size of wins from the size of losses', () => {
    const rows = [
      ...Array.from({ length: 10 }, () => resolveVerdict(v({ priceNow: 120, benchmarkNow: 51 }))),
      ...Array.from({ length: 10 }, () => resolveVerdict(v({ priceNow: 95, benchmarkNow: 51 }))),
    ]
    const s = scoreModel(rows)
    expect(s.mean_win_excess_pct).toBeGreaterThan(0)
    expect(s.mean_loss_excess_pct).toBeLessThan(0)
  })

  it('measures how far a call fell short of its own forecast', () => {
    // Directionally right, promised +10, delivered +1. A win rate hides this.
    const r = resolveVerdict(v({ priceNow: 103, benchmarkNow: 51, expectedReturnPct: 10 }))
    expect(r.correct).toBe(true)
    expect(r.expectation_error_pct).toBeCloseTo(1 - 10, 6)
  })
})

describe('calibration is separate from accuracy', () => {
  it('punishes confident wrongness more than hedged wrongness', () => {
    const cocky = resolveVerdict(v({ confidence: 0.95, priceNow: 90, benchmarkNow: 51 }))
    const hedged = resolveVerdict(v({ confidence: 0.55, priceNow: 90, benchmarkNow: 51 }))
    expect(cocky.correct).toBe(false)
    expect(cocky.brier).toBeGreaterThan(hedged.brier)
  })

  it('rewards confident rightness', () => {
    const r = resolveVerdict(v({ confidence: 0.95 }))
    expect(r.correct).toBe(true)
    expect(r.brier).toBeLessThan(0.05)
  })

  it('compares against the always-say-0.5 baseline', () => {
    const s = scoreModel(Array.from({ length: 20 }, () => resolveVerdict(v({ confidence: 0.5 }))))
    expect(s.brier).toBeCloseTo(0.25, 6)
    expect(s.brier_baseline).toBe(0.25)
  })
})

describe('a small sample is reported as a small sample', () => {
  it('refuses a win rate below the floor, and says why', () => {
    const s = scoreModel(Array.from({ length: 5 }, () => resolveVerdict(v())))
    expect(s.win_rate).toBeNull()
    expect(s.sample_sufficient).toBe(false)
    expect(s.note).toMatch(/5 of 20 scored verdicts/)
    expect(s.note).toMatch(/too few/)
  })

  it('still reports magnitude below the floor, where a ratio would mislead', () => {
    const s = scoreModel(Array.from({ length: 5 }, () => resolveVerdict(v())))
    expect(s.mean_excess_pct).toBeCloseTo(8, 6)
  })

  it('states a win rate once there is enough', () => {
    const s = scoreModel(Array.from({ length: MIN_SAMPLE }, () => resolveVerdict(v())))
    expect(s.sample_sufficient).toBe(true)
    expect(s.win_rate).toBe(1)
  })
})

describe('compareModels — the question is the benchmark, not the leaderboard', () => {
  const win = () => resolveVerdict(v())
  const lose = () => resolveVerdict(v({ priceNow: 95, benchmarkNow: 51 }))

  it('says TOO EARLY rather than ranking a short record', () => {
    const r = compareModels([
      { provider: 'anthropic', resolved: [win(), win()] },
      { provider: 'google', resolved: [lose()] },
    ])
    expect(r.verdict).toBe('too_early')
    expect(r.all_sufficient).toBe(false)
  })

  it('reports NO EDGE when nobody beats the benchmark — the valuable outcome', () => {
    const r = compareModels([
      { provider: 'anthropic', resolved: Array.from({ length: 20 }, lose) },
      { provider: 'google', resolved: Array.from({ length: 20 }, lose) },
    ])
    expect(r.verdict).toBe('no_edge_observed')
    expect(r.any_beat_benchmark).toBe(false)
  })

  it('reports an edge when one is actually observed', () => {
    const r = compareModels([
      { provider: 'anthropic', resolved: Array.from({ length: 20 }, win) },
      { provider: 'google', resolved: Array.from({ length: 20 }, lose) },
    ])
    expect(r.verdict).toBe('some_edge_observed')
    expect(r.any_beat_benchmark).toBe(true)
  })

  it('handles no data at all', () => {
    expect(compareModels([]).verdict).toBe('no_data')
    expect(compareModels(null).verdict).toBe('no_data')
  })
})

describe('never throws', () => {
  it('on any garbage', () => {
    for (const bad of [null, undefined, 42, 'x', [], {}]) {
      expect(() => resolveVerdict(bad)).not.toThrow()
      expect(() => scoreModel(bad)).not.toThrow()
      expect(() => compareModels(bad)).not.toThrow()
    }
    expect(resolveVerdict({ action: 'BUY' }).state).toBe('invalid')
    expect(resolveVerdict({ action: 'BUY', priceAtDecision: 0, priceNow: 1 }).code).toBe('no_prices')
  })
})
