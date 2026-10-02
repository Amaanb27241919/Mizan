import { describe, it, expect } from 'vitest'
import {
  ACTIONS, NON_DIRECTIONAL, extractJson, validateModelSignal, validateRound,
} from '../../lib/ai/signalSchema.mjs'

const good = (over = {}) => ({
  action: 'BUY', confidence: 0.77, horizon_days: 45,
  expected_return_pct: 8.4, downside_pct: 6.2,
  thesis: ['memory pricing turning'], bear_case: ['cycle rolls over'],
  catalysts: ['earnings 12 Nov'], invalidation_conditions: ['DRAM spot falls'],
  risk_flags: ['high volatility'], evidence_ids: ['FUND-22'],
  ...over,
})

describe('extractJson — tolerant about packaging', () => {
  it('takes a plain object', () => {
    expect(extractJson({ action: 'BUY' })).toEqual({ action: 'BUY' })
  })

  it('unwraps a markdown fence, which models emit constantly', () => {
    expect(extractJson('```json\n{"action":"HOLD"}\n```')).toEqual({ action: 'HOLD' })
    expect(extractJson('```\n{"action":"HOLD"}\n```')).toEqual({ action: 'HOLD' })
  })

  it('finds an object embedded in prose', () => {
    expect(extractJson('Here is my view:\n{"action":"SELL"}\nHope that helps.'))
      .toEqual({ action: 'SELL' })
  })

  it('takes the FIRST balanced object, never splices two together', () => {
    // Scanning to the last brace would merge two objects into nonsense.
    expect(extractJson('{"action":"BUY"} and also {"action":"SELL"}'))
      .toEqual({ action: 'BUY' })
  })

  it('handles braces inside strings without losing its place', () => {
    expect(extractJson('{"action":"BUY","thesis":["a } brace"]}'))
      .toEqual({ action: 'BUY', thesis: ['a } brace'] })
  })

  it('returns null rather than guessing', () => {
    for (const bad of ['', '   ', 'I think you should buy it', null, undefined, 42, [1, 2], '{broken']) {
      expect(extractJson(bad), String(bad)).toBeNull()
    }
  })

  it('refuses a bare array, which is not a verdict', () => {
    expect(extractJson('[{"action":"BUY"}]')).toBeNull()
  })
})

describe('validateModelSignal — reject, never repair', () => {
  it('accepts a well-formed directional verdict', () => {
    const r = validateModelSignal(good(), { provider: 'openai', model: 'gpt-x' })
    expect(r.ok).toBe(true)
    expect(r.signal).toMatchObject({ action: 'BUY', confidence: 0.77, directional: true, provider: 'openai' })
  })

  it('REJECTS confidence of 77 rather than rescaling it to 0.77', () => {
    // The single most tempting repair, and the most dangerous: rescaling is a
    // guess at intent, and a guess that lands in a trading decision turns a
    // weak signal into a strong one.
    const r = validateModelSignal(good({ confidence: 77 }))
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/outside 0–1/)
    expect(r.errors.join(' ')).toMatch(/not rescaled/)
  })

  it('rejects an action it does not recognise, including near-misses', () => {
    for (const a of ['STRONG_BUY', 'Buy it', 'LONG', 'buy now', '']) {
      expect(validateModelSignal(good({ action: a })).ok, a).toBe(false)
    }
  })

  it('accepts lowercase and padded actions — packaging, not meaning', () => {
    expect(validateModelSignal(good({ action: '  buy ' })).signal.action).toBe('BUY')
  })

  it('requires a directional call to carry its own downside', () => {
    // A BUY without a downside has not finished the thought and cannot be
    // weighed against the others.
    expect(validateModelSignal(good({ downside_pct: null })).ok).toBe(false)
    expect(validateModelSignal(good({ expected_return_pct: null })).ok).toBe(false)
    expect(validateModelSignal(good({ horizon_days: 0 })).ok).toBe(false)
  })

  it('requires a BEAR CASE for any directional call', () => {
    // A BUY with no bear case is a model that did not look for one.
    const r = validateModelSignal(good({ bear_case: [] }))
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/bear_case/)
  })

  it('treats ABSTAIN as a first-class answer with no risk fields needed', () => {
    const r = validateModelSignal({ action: 'ABSTAIN', confidence: 0.1 })
    expect(r.ok).toBe(true)
    expect(r.signal.directional).toBe(false)
    expect(NON_DIRECTIONAL).toContain(r.signal.action)
  })

  it('accepts INSUFFICIENT_DATA the same way', () => {
    expect(validateModelSignal({ action: 'INSUFFICIENT_DATA', confidence: 0 }).ok).toBe(true)
  })

  it('rejects prose, which is never the system of record', () => {
    const r = validateModelSignal('I would buy AMD here, maybe 3% of the book.')
    expect(r.ok).toBe(false)
    expect(r.code).toBe('unparseable')
  })

  it('drops invented extra fields rather than storing them', () => {
    const r = validateModelSignal(good({ secret_sauce: 'trust me', position_size_pct: 99 }))
    expect(r.ok).toBe(true)
    expect(r.signal.secret_sauce).toBeUndefined()
    expect(r.signal.position_size_pct).toBeUndefined()
  })

  it('never throws, on anything', () => {
    for (const bad of [null, undefined, 42, [], () => {}, { action: {} }, { confidence: {} }]) {
      expect(() => validateModelSignal(bad)).not.toThrow()
      expect(validateModelSignal(bad).ok, String(bad)).toBe(false)
    }
  })

  it('rejects a boolean confidence, which Number() would coerce to 1', () => {
    expect(validateModelSignal(good({ confidence: true })).ok).toBe(false)
  })
})

describe('validateRound', () => {
  const resp = (provider, raw) => ({ provider, model: `${provider}-x`, raw })

  it('drops invalid verdicts and REPORTS the drop', () => {
    // A round where three of four failed schema is not a three-model
    // consensus — it is a broken round wearing one.
    const r = validateRound([
      resp('openai', good()),
      resp('google', good({ confidence: 77 })),
      resp('xai', 'just some prose'),
      resp('anthropic', good({ action: 'HOLD' })),
    ])
    expect(r.valid).toHaveLength(2)
    expect(r.rejected).toHaveLength(2)
    expect(r.total).toBe(4)
    expect(r.complete).toBe(false)
    expect(r.rejected.map(x => x.provider).sort()).toEqual(['google', 'xai'])
  })

  it('counts directional separately from abstentions', () => {
    const r = validateRound([
      resp('openai', good()),
      resp('google', { action: 'ABSTAIN', confidence: 0.2 }),
    ])
    expect(r.directional).toBe(1)
    expect(r.abstained).toBe(1)
    expect(r.complete).toBe(true)
  })

  it('an empty round is never "complete"', () => {
    expect(validateRound([]).complete).toBe(false)
    expect(validateRound(null).complete).toBe(false)
  })

  it('never throws on garbage', () => {
    expect(() => validateRound([null, undefined, 42])).not.toThrow()
    expect(validateRound([null]).rejected).toHaveLength(1)
  })
})

describe('the action vocabulary', () => {
  it('includes both ways of declining', () => {
    expect(ACTIONS).toEqual(expect.arrayContaining(['BUY', 'HOLD', 'SELL', 'ABSTAIN', 'INSUFFICIENT_DATA']))
  })
})
