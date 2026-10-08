import { describe, it, expect } from 'vitest'
import { combine, actionable } from '../../lib/ai/ensemble.mjs'

const sig = (provider, action, over = {}) => ({
  provider, model: `${provider}-m`, action,
  directional: !['ABSTAIN', 'INSUFFICIENT_DATA'].includes(action),
  confidence: 0.7, horizon_days: 30, expected_return_pct: 6, downside_pct: 4,
  risk_flags: [], ...over,
})

describe('combine — equal weight, by design', () => {
  it('agrees when both models agree', () => {
    const r = combine([sig('anthropic', 'BUY'), sig('google', 'BUY')])
    expect(r.ok).toBe(true)
    expect(r.consensus).toBe('BUY')
    expect(r.unanimous).toBe(true)
    expect(r.agreement).toBe(1)
    expect(r.score).toBe(1)
  })

  it('does NOT weight by self-reported confidence', () => {
    // A model's confidence is not calibrated against any other model's, so
    // weighting by it silently hands the loudest model the most influence.
    const loudSell = combine([sig('a', 'SELL', { confidence: 0.99 }), sig('b', 'BUY', { confidence: 0.05 })])
    // One each way nets to 0 -> HOLD, regardless of how loud the SELL was.
    expect(loudSell.score).toBe(0)
    expect(loudSell.consensus).toBe('HOLD')
  })

  it('reports an opposed panel as OPPOSED, not as a tidy HOLD', () => {
    // A BUY against a SELL is a contradiction; a BUY against a HOLD is a
    // difference of conviction. Summarising them identically erases the
    // distinction exactly when it matters.
    const r = combine([sig('a', 'BUY'), sig('b', 'SELL')])
    expect(r.opposed).toBe(true)
    expect(r.split).toBe(true)
    expect(r.unanimous).toBe(false)

    const mild = combine([sig('a', 'BUY'), sig('b', 'HOLD')])
    expect(mild.opposed).toBe(false)
    expect(mild.split).toBe(true)
  })

  it('treats an abstention as no view, not as disagreement', () => {
    // Two BUYs and an abstention is a unanimous panel of two, not a split of
    // three — the abstainer had nothing to disagree with.
    const r = combine([sig('a', 'BUY'), sig('b', 'BUY'), sig('c', 'ABSTAIN')])
    expect(r.unanimous).toBe(true)
    expect(r.votes).toBe(2)
    expect(r.abstentions).toBe(1)
  })
})

describe('combine — the honest default is to decline', () => {
  it('refuses to call ONE model a committee', () => {
    // The central dishonesty this structure exists to avoid.
    const r = combine([sig('anthropic', 'BUY')])
    expect(r.ok).toBe(false)
    expect(r.code).toBe('insufficient_votes')
    expect(r.votes).toBe(1)
    expect(r.required).toBe(2)
  })

  it('refuses when everyone abstained', () => {
    const r = combine([sig('a', 'ABSTAIN'), sig('b', 'INSUFFICIENT_DATA')])
    expect(r.ok).toBe(false)
    expect(r.code).toBe('no_directional_votes')
    expect(r.abstentions).toBe(2)
  })

  it('still reports per-model detail when it declines, so the round is auditable', () => {
    // A declined round must not be a blank row — the panel's reasoning is the
    // forward record even when it reached no view.
    const r = combine([sig('a', 'ABSTAIN', { risk_flags: ['no fundamentals'] })])
    expect(r.ok).toBe(false)
    expect(r.per_model).toHaveLength(1)
    expect(r.per_model[0].risk_flags).toEqual(['no fundamentals'])
  })

  it('never throws on garbage', () => {
    for (const bad of [null, undefined, 'x', 42, [null, {}, 'nope']]) {
      expect(() => combine(bad)).not.toThrow()
      expect(combine(bad).ok, String(bad)).toBe(false)
    }
  })
})

describe('combine — the spread travels with the number (§23)', () => {
  it('preserves every model verdict verbatim', () => {
    const r = combine([
      sig('anthropic', 'BUY', { confidence: 0.8, risk_flags: ['vol'] }),
      sig('google', 'HOLD', { confidence: 0.4 }),
    ])
    expect(r.per_model).toHaveLength(2)
    expect(r.per_model.find(m => m.provider === 'anthropic')).toMatchObject({ action: 'BUY', confidence: 0.8, risk_flags: ['vol'] })
    expect(r.per_model.find(m => m.provider === 'google')).toMatchObject({ action: 'HOLD', confidence: 0.4 })
  })

  it('counts every action, including the abstentions', () => {
    const r = combine([sig('a', 'BUY'), sig('b', 'BUY'), sig('c', 'ABSTAIN')])
    expect(r.by_action).toEqual({ BUY: 2, ABSTAIN: 1 })
  })

  it('takes the SHORTEST horizon among agreeing models', () => {
    // The first invalidation is the one that matters; averaging would quietly
    // extend the window past where the panel's reasoning expires.
    const r = combine([sig('a', 'BUY', { horizon_days: 90 }), sig('b', 'BUY', { horizon_days: 30 })])
    expect(r.horizon_days).toBe(30)
  })

  it('reports mean confidence only among those who voted the consensus', () => {
    const r = combine([sig('a', 'BUY', { confidence: 0.9 }), sig('b', 'BUY', { confidence: 0.7 }), sig('c', 'ABSTAIN', { confidence: 0.1 })])
    expect(r.mean_confidence).toBeCloseTo(0.8, 6)
  })
})

describe('actionable — the bar, written before there is pressure to lower it', () => {
  const unanimousBuy = combine([sig('a', 'BUY'), sig('b', 'BUY')])

  it('passes a unanimous directional panel', () => {
    expect(actionable(unanimousBuy)).toEqual({ ok: true, action: 'BUY' })
  })

  it('refuses an opposed panel outright', () => {
    expect(actionable(combine([sig('a', 'BUY'), sig('b', 'SELL')])).code).toBe('opposed')
  })

  it('refuses a split panel by default', () => {
    expect(actionable(combine([sig('a', 'BUY'), sig('b', 'HOLD')])).code).toBe('not_unanimous')
  })

  it('refuses a HOLD — agreement is not a direction', () => {
    expect(actionable(combine([sig('a', 'HOLD'), sig('b', 'HOLD')])).code).toBe('no_direction')
  })

  it('refuses anything that never reached consensus', () => {
    expect(actionable(combine([sig('a', 'BUY')])).ok).toBe(false)
    expect(actionable(null).ok).toBe(false)
    expect(actionable({ ok: false }).ok).toBe(false)
  })

  it('is SEPARATE from combine, so reporting and deciding never collapse', () => {
    // combine states what the panel thinks; actionable decides whether to act.
    // Nothing calls actionable today — the panel runs in SHADOW and cannot
    // reach a broker.
    expect(unanimousBuy.ok).toBe(true)
    expect(typeof actionable).toBe('function')
  })
})

// ── Static contract: the panel can only ever observe ────────────────────────
import { readFileSync } from 'node:fs'
import path from 'node:path'

describe('research panel wiring', () => {
  const SRC = readFileSync(path.resolve(__dirname, '../../lib/handlers.mjs'), 'utf8')
  const FN = SRC.slice(SRC.indexOf('async function runResearchPanel'),
                       SRC.indexOf('// Bounds for the stop-arming pass.'))

  it('is opt-in TWICE — a mode AND an explicit param, in both ways in', () => {
    // Neither alone is enough, so no existing strategy can start calling
    // models because of a config typo. Two doors since 2026-10-06: SHADOW +
    // research_panel (records only), PAPER + ai_gate (may block a paper buy).
    expect(FN).toMatch(/research_panel === true && mode === MODES\.SHADOW/)
    expect(FN).toMatch(/ai_gate === true && mode === MODES\.PAPER/)
    expect(FN).toMatch(/if \(!shadowPanel && !paperGate\)/)
  })

  it('never runs for a LIVE-money strategy', () => {
    // The doors are SHADOW and PAPER only. resolveMode never returns PAPER
    // for a SnapTrade strategy (executionMode.test.js), so live money cannot
    // acquire AI verdicts that steer it.
    expect(FN).not.toMatch(/MODES\.LIVE_(AUTO|CONFIRM)/)
    expect(FN).toMatch(/ai\.panel\.refused_mode/)
  })

  it('refuses to call one model a committee', () => {
    expect(FN).toMatch(/panel\.length < 2/)
    expect(FN).toMatch(/too_few_providers/)
  })

  it('screens for halal BEFORE analysing, and skips what it cannot screen', () => {
    // §8 ordering. A symbol that cannot be screened is never analysed on an
    // assumption.
    expect(FN).toMatch(/verdict !== "halal"/)
    const screenAt = FN.indexOf('screenSymbol(sym)')
    const panelAt = FN.indexOf('runPanel(panel')
    expect(screenAt).toBeGreaterThan(-1)
    expect(screenAt, 'screening must precede the model call').toBeLessThan(panelAt)
  })

  it('writes shadow rows with qty 0 — nothing is ever sized from a round', () => {
    expect(FN).toMatch(/status: "shadow"/)
    expect(FN).toMatch(/qty: 0,/)
  })

  it('stores the packet hash, so every verdict provably saw one evidence set', () => {
    expect(FN).toMatch(/packet_hash: built\.packet\.hash/)
  })

  it('preserves the per-model spread and the failures', () => {
    expect(FN).toMatch(/ensemble: verdictSet/)
    expect(FN).toMatch(/failures: round\.failures\.map/)
  })

  it('is bounded in tickers AND wall clock', () => {
    expect(SRC).toMatch(/PANEL_TICKER_CAP\s*=\s*\d+/)
    expect(SRC).toMatch(/PANEL_MS_BUDGET\s*=/)
    expect(FN).toMatch(/Date\.now\(\) > deadline/)
  })

  it('runs one round per ticker per day', () => {
    expect(FN).toMatch(/\.eq\("status", "shadow"\)/)
    expect(FN).toMatch(/gte\("created_at"/)
  })
})

describe('research panel tick budget', () => {
  const SRC = readFileSync(path.resolve(__dirname, '../../lib/handlers.mjs'), 'utf8')
  it('never starts a panel late in a cron tick, and never runs past the tick deadline', () => {
    // Every strategy shares one ~300s serverless invocation. Two panels at
    // 120s each plus rebalances could be killed mid-order (found 2026-10-06,
    // before the AI-gated strategy first ran).
    const calls = SRC.match(/await runResearchPanel\(strat,[^\n]*/g) || []
    expect(calls.length).toBeGreaterThanOrEqual(2)
    for (const c of calls) expect(c).toMatch(/deadlineAt: claimNowMs \+ PANEL_TICK_DEADLINE_MS/)
    expect(SRC).toMatch(/Math\.min\(Date\.now\(\) \+ PANEL_MS_BUDGET, deadlineAt\)/)
  })
})

describe('pre-market AI gate review', () => {
  const SRC = readFileSync(path.resolve(__dirname, '../../lib/handlers.mjs'), 'utf8')
  const fnOf = (name) => SRC.slice(SRC.indexOf(`async function ${name}`), SRC.indexOf('\n}\n', SRC.indexOf(`async function ${name}`)))
  const PRE = fnOf('premarketGateReviews')
  const GATE = fnOf('runAiGate')

  it('never places, inserts or approves an order — review only', () => {
    // Outside regular hours a market order is QUEUED to the open at a price
    // nobody saw. The pre-market pass may only write the panel's own
    // shadow opinions (inside runResearchPanel).
    for (const body of [PRE, GATE]) {
      expect(body).not.toMatch(/executeStrategyOrder|placeAlpacaOrder|executeSnapTradeOrder/)
      expect(body).not.toMatch(/\.insert\(|\.update\(/)
    }
  })

  it('plans every due PAPER strategy (warms Sharia screens), reviews only AI-gated ones', () => {
    expect(PRE).toMatch(/if \(resolveMode\(strat\) !== MODES\.PAPER\) continue;/)
    expect(PRE).toMatch(/if \(strat\.params\?\.ai_gate !== true\) \{ out\.ready\+\+; continue; \}/)
    expect(PRE).toMatch(/if \(!rankDue\(strat\)\) continue;/)
    expect(PRE).toMatch(/pastCutoff: false/)
  })

  it('is reached only from the market-closed path, inside the review window', () => {
    expect(SRC).toMatch(/if \(inPremarketReviewWindow\(\)\) \{\s*try \{ premarket = await premarketGateReviews\(\); \}/)
  })
})

describe('panel failure records', () => {
  const SRC = readFileSync(path.resolve(__dirname, '../../lib/handlers.mjs'), 'utf8')
  it('keep the provider\'s error MESSAGE, not just its code', () => {
    // A stored "schema_invalid" could not say which field was wrong, so a
    // whole day of DeepSeek rejections was undiagnosable (2026-10-07).
    expect(SRC).toMatch(/failures: round\.failures\.map\(\(f\) => \(\{[^}]*detail: String\(f\.detail/)
  })
})
