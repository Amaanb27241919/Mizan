import { describe, it, expect } from 'vitest'
import { committeeStats } from '../lib/committee.js'

// Shaped like /api/ai/research rows (2026-10-07).
const row = (per, failures = [], e = {}) => ({ id: Math.random().toString(36), ensemble: { per_model: per, ...e }, failures })
const P = [{ provider: 'anthropic' }, { provider: 'google' }, { provider: 'openrouter' }]

describe('committeeStats — how each analyst and the panel actually performed', () => {
  const rows = [
    row([{ provider: 'anthropic', action: 'HOLD' }, { provider: 'google', action: 'HOLD' }, { provider: 'openrouter', action: 'HOLD' }], [], { ok: true, unanimous: true }),
    row([{ provider: 'google', action: 'BUY' }, { provider: 'openrouter', action: 'SELL' }], [{ provider: 'anthropic', code: 'http_400' }], { ok: true, opposed: true }),
    row([{ provider: 'google', action: 'HOLD' }], [{ provider: 'anthropic', code: 'http_400' }, { provider: 'openrouter', code: 'schema_invalid' }], { ok: false, code: 'insufficient_votes' }),
    { id: 's', screen_only: true, ensemble: { ok: false, code: 'not_screened_halal' }, failures: [] },
  ]
  const s = committeeStats(rows, P)
  it('counts reviews apart from screen-only skips', () => {
    expect(s.reviewed).toBe(3)
    expect(s.screened).toBe(1)
  })
  it('per analyst: answered, failed, and why', () => {
    expect(s.perProvider.anthropic).toEqual({ answered: 1, failed: 2, codes: ['http_400'] })
    expect(s.perProvider.openrouter).toEqual({ answered: 2, failed: 1, codes: ['schema_invalid'] })
    expect(s.perProvider.google).toEqual({ answered: 3, failed: 0, codes: [] })
  })
  it('the panel: agreed, opposed, or no view', () => {
    expect(s.agreed).toBe(1)
    expect(s.opposed).toBe(1)
    expect(s.noView).toBe(1)
  })
  it('survives junk', () => {
    expect(committeeStats(null, null)).toMatchObject({ reviewed: 0, screened: 0, perProvider: {} })
  })
})
