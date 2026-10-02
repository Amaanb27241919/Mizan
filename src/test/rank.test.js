// Ranking, hold-zone hysteresis, and inverse-volatility sizing.
//
// The spec came from a working system: "Trailing stops are off. Calmer stocks
// get larger positions. Holdings are kept while ranked in the top 25", with
// settings Hold zone: top 25 | Sizing: volatility | Rebalance: monthly.
//
// Pure module on purpose — this decides where money goes, so it must be
// testable without a broker, a clock, or a network.
import { describe, it, expect } from 'vitest'
import { momentum, volatility, rankUniverse, rebalancePlan, inverseVolWeights }
  from '../../lib/trading/rank.mjs'

// Deterministic synthetic series: constant drift plus a bounded oscillation.
const series = (start, drift, wobble, n = 120) => {
  let p = start; const out = []
  for (let i = 0; i < n; i++) { p *= 1 + drift + Math.sin(i * 7.1) * wobble; out.push({ c: p }) }
  return out
}

describe('momentum', () => {
  it('is positive for a riser and negative for a faller', () => {
    expect(momentum(series(100, 0.004, 0.002))).toBeGreaterThan(0)
    expect(momentum(series(100, -0.004, 0.002))).toBeLessThan(0)
  })

  it('returns null — not 0 — when there is too little history', () => {
    // 0 would sort an unmeasurable name ABOVE every genuine decliner, which
    // asserts something we do not know. Null excludes it instead.
    expect(momentum([{ c: 10 }, { c: 11 }])).toBeNull()
    expect(momentum([])).toBeNull()
    expect(momentum(null)).toBeNull()
  })
})

describe('volatility', () => {
  it('is larger for a choppier series', () => {
    const calm = volatility(series(100, 0.003, 0.002))
    const wild = volatility(series(100, 0.003, 0.03))
    expect(wild).toBeGreaterThan(calm)
  })

  it('refuses a flat line rather than calling it zero risk', () => {
    // sd === 0 would divide by zero in sizing and hand a dead name 100%.
    expect(volatility(Array.from({ length: 80 }, () => ({ c: 50 })))).toBeNull()
  })
})

describe('rankUniverse', () => {
  it('sorts strongest first and drops unmeasurable names', () => {
    const r = rankUniverse({
      UP: series(100, 0.006, 0.002),
      MID: series(100, 0.002, 0.002),
      DOWN: series(100, -0.004, 0.002),
      THIN: [{ c: 5 }, { c: 6 }],          // not enough history
    })
    expect(r.map((x) => x.symbol)).toEqual(['UP', 'MID', 'DOWN'])
    expect(r.find((x) => x.symbol === 'THIN')).toBeUndefined()
  })

  it('is deterministic when momentum ties', () => {
    const a = series(100, 0.003, 0.002)
    const r = rankUniverse({ ZZZ: a, AAA: a })
    expect(r.map((x) => x.symbol)).toEqual(['AAA', 'ZZZ'])
  })
})

describe('rebalancePlan — the hold zone is hysteresis', () => {
  const ranked = Array.from({ length: 40 }, (_, i) => ({ symbol: `S${i + 1}`, momentum: 1 - i * 0.01, volatility: 0.2 }))

  it('KEEPS a holding that slipped out of the buy band but is inside the hold zone', () => {
    // The whole point. S20 is no longer a buy (top 15) but has not
    // deteriorated enough to sell (top 25). Selling it here is the churn this
    // band exists to prevent — paying spread both ways to own nearly the same
    // book every time two names swap places.
    const p = rebalancePlan({ ranked, held: ['S20'], buyTop: 15, holdZone: 25 })
    expect(p.keep).toContain('S20')
    expect(p.sell).not.toContain('S20')
  })

  it('sells a holding that falls outside the hold zone', () => {
    const p = rebalancePlan({ ranked, held: ['S30'], buyTop: 15, holdZone: 25 })
    expect(p.sell).toContain('S30')
    expect(p.keep).not.toContain('S30')
  })

  it('sells a holding that left the universe entirely', () => {
    const p = rebalancePlan({ ranked, held: ['DELISTED'], buyTop: 15, holdZone: 25 })
    expect(p.sell).toEqual(['DELISTED'])
  })

  it('never buys what it already keeps', () => {
    const p = rebalancePlan({ ranked, held: ['S3'], buyTop: 15, holdZone: 25 })
    expect(p.buy).not.toContain('S3')
    expect(p.keep).toContain('S3')
    expect(new Set(p.target).size).toBe(p.target.length)   // no duplicates
  })

  it('skips an excluded name without reaching deeper than the band', () => {
    // Earnings filter: S2 reports in 3 days. It is passed over — NOT replaced
    // by S16, because the band is the band. Substituting would quietly widen
    // the strategy every time a name is blocked.
    const p = rebalancePlan({ ranked, held: [], buyTop: 15, holdZone: 25, excluded: ['S2'] })
    expect(p.buy).not.toContain('S2')
    expect(p.buy).not.toContain('S16')
    expect(p.buy).toHaveLength(14)
  })

  it('survives garbage rather than throwing', () => {
    for (const bad of [null, undefined, {}, 'nope', 42]) {
      expect(() => rebalancePlan({ ranked: bad, held: bad, excluded: bad })).not.toThrow()
    }
  })
})

describe('inverseVolWeights — calmer gets larger', () => {
  it('gives the calmer name the bigger position', () => {
    const ranked = [{ symbol: 'CALM', volatility: 0.10 }, { symbol: 'WILD', volatility: 0.80 }]
    const w = inverseVolWeights(ranked, ['CALM', 'WILD'])
    expect(w.CALM).toBeGreaterThan(w.WILD)
    // 8x the volatility earns 1/8th the weight.
    expect(w.CALM / w.WILD).toBeCloseTo(8, 1)
  })

  it('always sums to 1', () => {
    const ranked = [
      { symbol: 'A', volatility: 0.11 }, { symbol: 'B', volatility: 0.37 },
      { symbol: 'C', volatility: 0.93 }, { symbol: 'D', volatility: 0.05 },
    ]
    const w = inverseVolWeights(ranked, ['A', 'B', 'C', 'D'])
    expect(Object.values(w).reduce((s, v) => s + v, 0)).toBeCloseTo(1, 10)
  })

  it('drops a name with no measurable volatility instead of guessing', () => {
    // Handing it an arbitrary weight silently concentrates the book.
    const ranked = [{ symbol: 'A', volatility: 0.2 }, { symbol: 'B', volatility: null }]
    const w = inverseVolWeights(ranked, ['A', 'B'])
    expect(w.B).toBeUndefined()
    expect(w.A).toBeCloseTo(1, 10)
  })

  it('falls back to equal weight only when NOTHING is measurable', () => {
    const w = inverseVolWeights([{ symbol: 'A', volatility: null }, { symbol: 'B', volatility: null }], ['A', 'B'])
    expect(w.A).toBeCloseTo(0.5, 10)
    expect(w.B).toBeCloseTo(0.5, 10)
  })
})

// ── Static contract: the rank-rebalance branch is shadow-only ───────────────
// Every other engine branch holds ONE name with a stop and an exit. This one
// commits a whole book and runs with stops OFF, relying on the hold zone to
// exit — which is what the reference system does, and which has no forward
// record here yet. §17 says a forward record is the only evidence. So the
// branch must refuse to run for a live strategy, and that refusal is a
// property worth a test rather than a comment.
import { readFileSync } from 'node:fs'
import path from 'node:path'

describe('rank_rebalance is shadow-only', () => {
  const SRC = readFileSync(path.resolve(__dirname, '../../lib/handlers.mjs'), 'utf8')
  const branch = SRC.slice(
    SRC.indexOf('if (strat.strategy_type === "rank_rebalance")'),
    SRC.indexOf('if (strat.strategy_type === "dca")'),
  )

  it('the branch exists and is reachable', () => {
    expect(branch.length).toBeGreaterThan(500)
  })

  it('refuses to run for a non-paper strategy', () => {
    expect(branch, 'a live rank_rebalance strategy must be refused before any order')
      .toMatch(/if \(!venue\.paper\)/)
    expect(branch).toMatch(/bot\.rank\.live_refused/)
  })

  it('refuses before it places anything, not after', () => {
    // The guard has to come before the first executeStrategyOrder, or it is
    // decoration. Compare positions inside the branch.
    const guard = branch.indexOf('if (!venue.paper)')
    const firstOrder = branch.indexOf('executeStrategyOrder')
    expect(guard).toBeGreaterThan(-1)
    expect(firstOrder).toBeGreaterThan(-1)
    expect(guard, 'the live refusal must precede any order placement').toBeLessThan(firstOrder)
  })

  it('stays behind its gate, and the gate is only open BECAUSE reconciliation exists', () => {
    // This test previously asserted the gate was hard-false. Codex had
    // returned "not safe to ship" on two structural grounds, and the first —
    // a 2xx from Alpaca means ACCEPTED, not FILLED — was the blocking one.
    //
    // It was opened on 2026-10-01 only after that precondition was actually
    // met: every Alpaca execution writes `submitted`, and
    // reconcileSubmittedSignals promotes it from the broker's own filled_qty.
    // Verified against a real fill, not against a fixture.
    //
    // So the assertion is no longer "the gate is shut". It is "the gate may
    // only be open while the thing that justified opening it is still there".
    // Delete reconciliation and this test fails, which is the point.
    expect(branch).toMatch(/if \(!RANK_REBALANCE_ENABLED\) continue;/)
    expect(SRC).toMatch(/const RANK_REBALANCE_ENABLED = true;/)
    // Anchored with the opening paren. Without it, renaming the function to
    // reconcileSubmittedSignalsXX still matched — the mutation survived and
    // the test proved nothing.
    expect(SRC, 'the gate rests on reconciliation existing')
      .toMatch(/async function reconcileSubmittedSignals\(/)
    expect(SRC, 'and on it actually being called')
      .toMatch(/await reconcileSubmittedSignals\(\)/)
    expect(SRC, 'and on paper executions landing as submitted, never executed')
      .toMatch(/\? \{ status: "submitted" \}/)
  })

  it('the second Codex finding is MITIGATED, not solved, and says so', () => {
    // Partial failure mid-loop still leaves a half-rebalanced book with no
    // rollback. What makes that bounded is that rebalancePlan is idempotent —
    // it recomputes the target against what is actually held — so the next
    // run completes the job instead of compounding the gap. Recorded here so
    // nobody later reads the open gate as "all findings were fixed".
    expect(SRC).toMatch(/STILL TRUE, and mitigated rather than solved/)
  })

  it('records a notional buy as a SHARE COUNT, not zero', () => {
    // The bug that made this not merely unsafe but broken: bookFromSignals
    // sums qty, so a notional buy stored as qty 0 vanished from the book —
    // the next rebalance would think it owned nothing and re-buy forever.
    expect(branch).not.toMatch(/qty: o\.qty \?\? 0,/)
    expect(branch).toMatch(/o\.notional \/ priceOf\(o\.sym\)/)
  })

  it('only consumes the rebalance cadence when something was placed', () => {
    expect(branch).toMatch(/placed > 0 \? \{ \.\.\.\(strat\.params/)
  })

  it('records that the earnings filter is not yet applied', () => {
    // The reference config skips names reporting within 3 days. We do not do
    // that yet. Saying so in code beats implying it by omission.
    expect(branch).toMatch(/Not applied yet/i)
  })
})
