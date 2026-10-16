// Bull/bear debate. The property that matters more than any other: a debate
// can only ever TIGHTEN the gate. If this suite ever allows a debate to turn a
// blocked candidate into a permitted one, the module is unsafe to have in an
// order path, however good its reasoning looks.
import { describe, it, expect } from 'vitest'
import { assignRoles, debatePrompt, usableClaims, debateOutcome, applyDebate, SIDES } from '../../lib/ai/debate.mjs'

const claim = (c, over = {}) => ({ claim: c, evidence_id: 'NEWS-1', falsifier: 'the opposite is reported', ...over })
const side = (claims, ok = true) => ({ ok, claims })
const panel = (consensus) => ({ ok: true, consensus })

describe('assignRoles', () => {
  const four = ['anthropic', 'google', 'openrouter', 'mistral']
  it('splits the analysts into two held sides', () => {
    const r = assignRoles(four, 'CRM')
    expect(r.bull.length + r.bear.length).toBe(4)
    expect(r.bull.length).toBeGreaterThan(0)
    expect(r.bear.length).toBeGreaterThan(0)
    expect([...r.bull, ...r.bear].sort()).toEqual([...four].sort())
  })
  it('is deterministic per ticker, so a round can be reproduced', () => {
    expect(assignRoles(four, 'CRM')).toEqual(assignRoles(four, 'CRM'))
  })
  it('rotates across tickers, so no model is the permanent bull', () => {
    const bulls = ['AAPL', 'MSFT', 'CRM', 'ORCL', 'NVDA', 'TXN', 'LOW', 'ABT']
      .map((t) => assignRoles(four, t).bull[0])
    expect(new Set(bulls).size).toBeGreaterThan(1)
  })
  it('accepts provider objects as well as names', () => {
    expect(assignRoles([{ provider: 'a' }, { provider: 'b' }], 'X')).toEqual({ bull: ['a'], bear: ['b'] })
  })
  it('refuses to stage a debate with fewer than two analysts', () => {
    expect(assignRoles(['only'], 'CRM')).toBeNull()
    expect(assignRoles([], 'CRM')).toBeNull()
    expect(assignRoles(null, 'CRM')).toBeNull()
  })
})

describe('debatePrompt', () => {
  it('asks each side for falsifiers and forbids re-litigating the Sharia verdict', () => {
    const p = debatePrompt({ side: 'bear', ticker: 'crm' })
    expect(p).toMatch(/Argue the case AGAINST buying CRM now/)
    expect(p).toMatch(/prove it WRONG/)
    expect(p).toMatch(/never yours to re-litigate/)
    expect(p).toMatch(/conceding is a valid outcome/)
  })
  it('puts the opposing claims in front of the second side', () => {
    const p = debatePrompt({ side: 'bull', ticker: 'CRM', opposingClaims: [claim('margins are falling')] })
    expect(p).toMatch(/The other side has argued/)
    expect(p).toMatch(/1\. margins are falling/)
    expect(p).toMatch(/Address each point directly/)
  })
  it('refuses an unknown side', () => {
    expect(debatePrompt({ side: 'neutral', ticker: 'CRM' })).toBeNull()
    expect(debatePrompt(null)).toBeNull()
  })
  it('exports the two sides in record order', () => {
    expect(SIDES).toEqual(['bull', 'bear'])
  })
})

describe('usableClaims — rhetoric is discarded', () => {
  it('keeps only claims that cite evidence AND name a falsifier', () => {
    const u = usableClaims(side([
      claim('cited and falsifiable'),
      { claim: 'no evidence', falsifier: 'x' },
      { claim: 'no falsifier', evidence_id: 'NEWS-2' },
      { evidence_id: 'NEWS-3', falsifier: 'y' },
    ]))
    expect(u).toHaveLength(1)
    expect(u[0].claim).toBe('cited and falsifiable')
  })
  it('survives malformed input', () => {
    expect(usableClaims(null)).toEqual([])
    expect(usableClaims({ claims: 'nope' })).toEqual([])
    expect(usableClaims({ claims: [null, 3] })).toEqual([])
  })
})

describe('debateOutcome', () => {
  it('blocks when the bear names a risk the bull never answers', () => {
    const o = debateOutcome({
      bull: side([claim('revenue is accelerating')]),
      bear: side([claim('the guidance cut is unpriced')]),
      ensemble: panel('BUY'),
    })
    expect(o).toMatchObject({ ok: true, verdict: 'blocked', tightened: true })
    expect(o.unanswered).toEqual(['the guidance cut is unpriced'])
    expect(o.reason).toMatch(/1 risk the bull did not answer/)
  })

  it('stands down when the bull answers every risk', () => {
    const o = debateOutcome({
      bull: side([claim('answered')]),
      bear: side([claim('the guidance cut', { addressed: true })]),
      ensemble: panel('BUY'),
    })
    expect(o.verdict).toBe('undecided')
    expect(o.tightened).toBe(false)
    expect(o.reason).toMatch(/answered every risk/)
  })

  it('a side that failed is NOT a veto — a timeout must not block a trade', () => {
    const failed = debateOutcome({ bull: side([claim('x')], false), bear: side([claim('y')]), ensemble: panel('BUY') })
    expect(failed).toMatchObject({ ok: false, verdict: 'undecided', tightened: false })
    expect(debateOutcome({ bull: side([claim('x')]), bear: side([], true), ensemble: panel('BUY') }).verdict).toBe('undecided')
  })

  it('a bear case with no checkable risk changes nothing', () => {
    const o = debateOutcome({
      bull: side([claim('good')]),
      bear: side([{ claim: 'it feels expensive' }]),   // no evidence, no falsifier
      ensemble: panel('BUY'),
    })
    expect(o.verdict).toBe('undecided')
    expect(o.bearClaims).toBe(0)
  })

  it('stays quiet when the panel was not going to buy anyway', () => {
    for (const e of [panel('SELL'), { ok: false }]) {
      const o = debateOutcome({ bull: side([claim('a')]), bear: side([claim('b')]), ensemble: e })
      expect(o.verdict).toBe('undecided')
      expect(o.reason).toMatch(/not going to buy regardless/)
    }
  })

  it('survives malformed input', () => {
    expect(debateOutcome(null).verdict).toBe('undecided')
    expect(debateOutcome({ bull: 'x', bear: 'y' }).verdict).toBe('undecided')
  })
})

describe('applyDebate — THE SAFETY PROPERTY', () => {
  it('can veto a permitted candidate', () => {
    const blocked = { verdict: 'blocked', reason: 'the bear named 2 risks the bull did not answer' }
    expect(applyDebate(true, blocked)).toMatchObject({ allowed: false, vetoed: true })
    expect(applyDebate(true, blocked).reason).toMatch(/bear named 2 risks/)
  })

  it('can NEVER open a gate the ensemble closed — every outcome, every shape', () => {
    const outcomes = [
      { verdict: 'proceed' }, { verdict: 'blocked' }, { verdict: 'undecided' },
      { verdict: 'proceed', tightened: false }, { ok: true, verdict: 'proceed' },
      null, undefined, {}, { verdict: 'anything-else' }, 'proceed', 42,
    ]
    for (const o of outcomes) {
      expect(applyDebate(false, o).allowed).toBe(false)
      expect(applyDebate(undefined, o).allowed).toBe(false)
      expect(applyDebate(null, o).allowed).toBe(false)
      expect(applyDebate('true', o).allowed).toBe(false)   // only a real `true` permits
    }
  })

  it('leaves a permitted candidate permitted when the debate is undecided', () => {
    expect(applyDebate(true, { verdict: 'undecided', reason: 'the bull answered every risk' }))
      .toMatchObject({ allowed: true, vetoed: false })
    expect(applyDebate(true, null).allowed).toBe(true)
  })

  it('end to end: the debate only ever subtracts', () => {
    const cases = [
      [true, panel('BUY'), [claim('risk', { addressed: false })], false],  // vetoed
      [true, panel('BUY'), [claim('risk', { addressed: true })], true],    // survives
      [false, panel('BUY'), [claim('risk')], false],                       // stays closed
      [false, panel('SELL'), [], false],                                   // stays closed
    ]
    for (const [allowed, ensemble, bearClaims, expected] of cases) {
      const o = debateOutcome({ bull: side([claim('bull case')]), bear: side(bearClaims), ensemble })
      expect(applyDebate(allowed, o).allowed).toBe(expected)
    }
  })
})
