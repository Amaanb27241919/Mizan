// Upstream data-feed health detection.
//
// Regression guard for 2026-07-28: Stooq hard-404'd its gold/silver CSVs, the
// Zakat nisab silently fell back to constants 27-41% below live spot, and
// nothing surfaced it — the outage was found by accident. feedVerdict() is the
// pure core of the detector that now watches for exactly that.
import { describe, it, expect } from 'vitest'
import { feedVerdict, DATA_FEEDS } from '../../lib/anomaly.mjs'

const metals = DATA_FEEDS.find(f => f.key === 'metals.spot')

const healthyBody = {
  ok: true,
  source: 'yahoo-futures',
  nisab_gold_usd: 11632.41,
  nisab_silver_usd: 1149.08,
}

describe('feedVerdict', () => {
  it('passes a healthy 200 payload and reports the winning provider', () => {
    const v = feedVerdict(metals, { status: 200, body: healthyBody })
    expect(v.healthy).toBe(true)
    expect(v.reason).toBeNull()
    expect(v.source).toBe('yahoo-futures')
  })

  it('fails a non-200 response', () => {
    const v = feedVerdict(metals, { status: 503, body: null })
    expect(v.healthy).toBe(false)
    expect(v.reason).toBe('HTTP 503')
  })

  it('fails when the probe itself throws (network/DNS)', () => {
    const v = feedVerdict(metals, { status: 0, body: null, error: 'ECONNREFUSED' })
    expect(v.healthy).toBe(false)
    expect(v.reason).toMatch(/ECONNREFUSED/)
  })

  // The exact shape the dead Stooq feed returned — a 200 with ok:false.
  it('fails a 200 that carries ok:false, surfacing the endpoint reason', () => {
    const v = feedVerdict(metals, {
      status: 200,
      body: { ok: false, source: 'fallback', reason: 'fetch_failed', error: 'stooq xauusd 404' },
    })
    expect(v.healthy).toBe(false)
    expect(v.reason).toContain('stooq xauusd 404')
  })

  it('fails when thresholds are missing, zero or negative even with ok:true', () => {
    expect(feedVerdict(metals, { status: 200, body: { ok: true } }).healthy).toBe(false)
    expect(feedVerdict(metals, { status: 200, body: { ...healthyBody, nisab_gold_usd: 0 } }).healthy).toBe(false)
    expect(feedVerdict(metals, { status: 200, body: { ...healthyBody, nisab_silver_usd: -1 } }).healthy).toBe(false)
  })

  it('fails safely on a null body instead of throwing', () => {
    const v = feedVerdict(metals, { status: 200, body: null })
    expect(v.healthy).toBe(false)
  })

  it('never reports healthy from a predicate that throws', () => {
    const bad = { key: 'x', label: 'x', healthy: () => { throw new Error('boom') } }
    const v = feedVerdict(bad, { status: 200, body: {} })
    expect(v.healthy).toBe(false)
    expect(v.reason).toMatch(/boom/)
  })

  it('truncates a runaway reason string', () => {
    const v = feedVerdict(metals, { status: 200, body: { ok: false, error: 'x'.repeat(1000) } })
    expect(v.reason.length).toBeLessThanOrEqual(300)
  })
})

describe('DATA_FEEDS config', () => {
  it('every feed declares the fields the detector and alert need', () => {
    for (const f of DATA_FEEDS) {
      expect(typeof f.key).toBe('string')
      expect(typeof f.label).toBe('string')
      expect(f.path.startsWith('/')).toBe(true)
      expect(typeof f.healthy).toBe('function')
      expect(typeof f.impact).toBe('string')
      expect(['high', 'warn', 'low']).toContain(f.severity)
    }
  })

  it('watches the metals feed that caused the incident', () => {
    expect(metals).toBeTruthy()
    expect(metals.path).toBe('/api/metals/spot')
  })
})
