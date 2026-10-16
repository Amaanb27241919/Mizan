// Deflated Sharpe — the correction for having run 14 strategies and picking
// the best one. Reference values were computed independently with Python's
// statistics.NormalDist, not derived by hand (hand-computed expectations have
// been wrong here before).
import { describe, it, expect } from 'vitest'
import {
  normalCdf, normalInv, returnMoments, probabilisticSharpe,
  expectedMaxSharpe, minTrackRecordLength, assessStrategy, dailyFromCumulativePct,
  assessAll, PERIODS_PER_YEAR, MIN_OBSERVATIONS,
} from '../lib/deflatedSharpe.js'

/** Deterministic pseudo-random normal draws — same series every run. */
function normals(n, { mean = 0, sd = 1, seed = 7 } = {}) {
  let s = seed
  const rand = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648 }
  const out = []
  while (out.length < n) {
    const u1 = Math.max(rand(), 1e-12), u2 = rand()
    out.push(mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2))
  }
  return out
}

describe('normal distribution helpers', () => {
  it('match known values to 8 decimals', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 12)
    expect(normalCdf(1.96)).toBeCloseTo(0.975002105, 8)
    expect(normalCdf(-2.5)).toBeCloseTo(0.0062096653, 9)
    expect(normalInv(0.975)).toBeCloseTo(1.959963985, 8)
    expect(normalInv(0.95)).toBeCloseTo(1.644853627, 8)
    expect(normalInv(0.5)).toBeCloseTo(0, 10)
  })
  it('round-trip', () => {
    for (const p of [0.01, 0.25, 0.5, 0.84, 0.99]) expect(normalCdf(normalInv(p))).toBeCloseTo(p, 10)
  })
  it('refuse impossible input instead of returning Infinity', () => {
    expect(normalInv(0)).toBeNull()
    expect(normalInv(1)).toBeNull()
    expect(normalInv(1.5)).toBeNull()
    expect(normalInv('x')).toBeNull()
    expect(normalCdf(null)).toBeNull()
  })
})

describe('returnMoments', () => {
  it('reads a known series', () => {
    const m = returnMoments([0.01, -0.01, 0.02, -0.02, 0.01])
    expect(m.n).toBe(5)
    expect(m.mean).toBeCloseTo(0.002, 12)
    expect(m.sharpe).toBeCloseTo(m.mean / m.sd, 12)
  })
  it('kurtosis is NON-excess: a normal sample sits near 3, not near 0', () => {
    const m = returnMoments(normals(4000))
    expect(m.kurtosis).toBeGreaterThan(2.5)
    expect(m.kurtosis).toBeLessThan(3.5)
    expect(Math.abs(m.skew)).toBeLessThan(0.2)
  })
  it('refuses a flat line or too little data', () => {
    expect(returnMoments([0.01, 0.01, 0.01])).toBeNull()   // zero variance
    expect(returnMoments([0.01])).toBeNull()
    expect(returnMoments(null)).toBeNull()
  })
})

describe('probabilisticSharpe', () => {
  it('matches the reference value', () => {
    expect(probabilisticSharpe({ sharpe: 0.1, n: 101, skew: 0, kurtosis: 3 })).toBeCloseTo(0.840741328, 8)
  })
  it('a longer sample makes the SAME Sharpe more believable', () => {
    const short = probabilisticSharpe({ sharpe: 0.1, n: 21 })
    const long = probabilisticSharpe({ sharpe: 0.1, n: 252 })
    expect(long).toBeGreaterThan(short)
  })
  it('negative skew and fat tails BOTH lower it — the point of using PSR at all', () => {
    const base = probabilisticSharpe({ sharpe: 0.1, n: 101, skew: 0, kurtosis: 3 })
    expect(probabilisticSharpe({ sharpe: 0.1, n: 101, skew: -1.5, kurtosis: 3 })).toBeLessThan(base)
    expect(probabilisticSharpe({ sharpe: 0.1, n: 101, skew: 0, kurtosis: 9 })).toBeLessThan(base)
  })
  it('a zero Sharpe is a coin flip, and a negative one is worse', () => {
    expect(probabilisticSharpe({ sharpe: 0, n: 101 })).toBeCloseTo(0.5, 10)
    expect(probabilisticSharpe({ sharpe: -0.1, n: 101 })).toBeLessThan(0.5)
  })
  it('refuses nonsense', () => {
    expect(probabilisticSharpe({ sharpe: 0.1, n: 1 })).toBeNull()
    expect(probabilisticSharpe(null)).toBeNull()
  })
})

describe('expectedMaxSharpe — what luck alone produces', () => {
  it('matches the reference for our 14 strategies', () => {
    expect(expectedMaxSharpe(14, 1)).toBeCloseTo(1.738448563, 8)
    expect(expectedMaxSharpe(2, 1)).toBeCloseTo(0.519755344, 8)
  })
  it('rises with the number of trials — more tries, luckier winner', () => {
    expect(expectedMaxSharpe(50, 1)).toBeGreaterThan(expectedMaxSharpe(14, 1))
    expect(expectedMaxSharpe(14, 1)).toBeGreaterThan(expectedMaxSharpe(5, 1))
  })
  it('scales with the spread of the trials', () => {
    expect(expectedMaxSharpe(14, 2)).toBeCloseTo(2 * expectedMaxSharpe(14, 1), 10)
  })
  it('is unknowable with fewer than two trials or no spread', () => {
    expect(expectedMaxSharpe(1, 1)).toBeNull()
    expect(expectedMaxSharpe(14, 0)).toBeNull()
    expect(expectedMaxSharpe(null, null)).toBeNull()
  })
})

describe('minTrackRecordLength', () => {
  it('matches the reference value', () => {
    expect(minTrackRecordLength({ sharpe: 0.1, benchmark: 0.05, skew: 0, kurtosis: 3, confidence: 0.95 }))
      .toBeCloseTo(1088.628469, 4)
  })
  it('a strategy barely above the bar needs far longer than one well above it', () => {
    const barely = minTrackRecordLength({ sharpe: 0.06, benchmark: 0.05 })
    const clear = minTrackRecordLength({ sharpe: 0.20, benchmark: 0.05 })
    expect(barely).toBeGreaterThan(clear)
  })
  it('is null when the strategy is at or below the bar — time alone cannot fix it', () => {
    expect(minTrackRecordLength({ sharpe: 0.05, benchmark: 0.05 })).toBeNull()
    expect(minTrackRecordLength({ sharpe: 0.01, benchmark: 0.05 })).toBeNull()
  })
})

describe('assessStrategy — the finding this module exists for', () => {
  it('14 skill-less strategies over 10 days: the winner is NOT decidable', () => {
    // Every strategy is pure noise. The best of them still shows a flattering
    // annualised Sharpe; DSR must refuse to call it real.
    const books = Array.from({ length: 14 }, (_, i) => normals(10, { mean: 0, sd: 0.02, seed: 11 + i }))
    const sharpes = books.map((r) => returnMoments(r)).filter(Boolean).map((m) => m.sharpe)
    const best = books[sharpes.indexOf(Math.max(...sharpes))]
    const a = assessStrategy({ returns: best, trialSharpes: sharpes, minObservations: 5 })
    expect(a.ready).toBe(true)
    expect(a.trials).toBe(14)
    expect(a.decidable).toBe(false)
    expect(a.dsr).toBeLessThan(0.95)
    // And it tells you how much more evidence would settle it.
    expect(a.shortfallDays === null || a.shortfallDays > 0).toBe(true)
  })

  it('deflating is strictly harsher than PSR — the whole correction', () => {
    const r = normals(120, { mean: 0.002, sd: 0.01, seed: 3 })
    const trials = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3]
    const a = assessStrategy({ returns: r, trialSharpes: trials })
    expect(a.dsr).toBeLessThan(a.psr)
    expect(a.benchmarkSharpe).toBeGreaterThan(0)
  })

  it('a genuinely strong, long record IS decidable', () => {
    const r = normals(400, { mean: 0.0035, sd: 0.01, seed: 5 })
    const a = assessStrategy({ returns: r, trialSharpes: [0.02, 0.05, 0.08, 0.1] })
    expect(a.ready).toBe(true)
    expect(a.decidable).toBe(true)
    expect(a.dsr).toBeGreaterThan(0.95)
    expect(a.sharpeAnnual).toBeCloseTo(a.sharpe * Math.sqrt(PERIODS_PER_YEAR), 10)
  })

  it('withholds a verdict below the observation floor instead of guessing', () => {
    const a = assessStrategy({ returns: normals(8, { seed: 2 }), trialSharpes: [0.1, 0.2] })
    expect(a).toMatchObject({ ready: false, n: 8, needed: MIN_OBSERVATIONS })
  })

  it('with fewer than two trials there is nothing to deflate against', () => {
    const a = assessStrategy({ returns: normals(60, { mean: 0.002, sd: 0.01, seed: 9 }), trialSharpes: [0.1] })
    expect(a.ready).toBe(true)
    expect(a.psr).not.toBeNull()
    expect(a.dsr).toBeNull()
    expect(a.decidable).toBe(false)
  })

  it('survives malformed input', () => {
    expect(assessStrategy(null).ready).toBe(false)
    expect(assessStrategy({ returns: 'x', trialSharpes: 'y' }).ready).toBe(false)
    expect(assessStrategy({ returns: [1, 2], trialSharpes: [null, 'a'] }).ready).toBe(false)
  })
})

describe('dailyFromCumulativePct / assessAll — the lab wiring', () => {
  it('turns a cumulative curve into daily returns', () => {
    const pts = [{ day: '2026-01-02', returnPct: 0 }, { day: '2026-01-03', returnPct: 1 }, { day: '2026-01-04', returnPct: 2.01 }]
    const r = dailyFromCumulativePct(pts)
    expect(r).toHaveLength(2)
    expect(r[0]).toBeCloseTo(0.01, 10)
    expect(r[1]).toBeCloseTo(0.01, 10)
  })
  it('ignores points with no return and malformed input', () => {
    expect(dailyFromCumulativePct([{ day: 'a', returnPct: null }, { day: 'b', returnPct: 1 }])).toEqual([])
    expect(dailyFromCumulativePct(null)).toEqual([])
  })
  it('assesses every strategy against the same trial set', () => {
    const curve = (seed, mean) => {
      const r = normals(60, { mean, sd: 0.01, seed })
      let cum = 1
      return { points: r.map((x, i) => { cum *= 1 + x; return { day: `d${i}`, returnPct: (cum - 1) * 100 } }) }
    }
    const curves = { a: curve(1, 0.003), b: curve(2, 0.001), c: curve(3, -0.001) }
    const all = assessAll(curves)
    expect(Object.keys(all).sort()).toEqual(['a', 'b', 'c'])
    for (const id of ['a', 'b', 'c']) expect(all[id].trials).toBe(3)
    expect(all.a.dsr).toBeGreaterThan(all.c.dsr)
  })
  it('a short strategy gets no vote in the trial set', () => {
    const long = { points: Array.from({ length: 40 }, (_, i) => ({ day: `d${i}`, returnPct: i * 0.1 })) }
    const short = { points: [{ day: 'd0', returnPct: 0 }, { day: 'd1', returnPct: 5 }] }
    const all = assessAll({ long, short })
    expect(all.long.trials).toBe(1)        // only `long` clears the floor
    expect(all.short.ready).toBe(false)
  })
  it('survives malformed input', () => {
    expect(assessAll(null)).toEqual({})
    // A malformed curve object is skipped; a curve with unusable points is
    // reported as not-ready rather than dropped.
    const out = assessAll({ x: null, y: { points: 'nope' } })
    expect(Object.keys(out)).toEqual(['y'])
    expect(out.y.ready).toBe(false)
  })
})
