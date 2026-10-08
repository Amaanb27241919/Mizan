import { describe, it, expect } from 'vitest'
import { mergeVerdicts, symbolsToScreen, isSettledVerdict } from '../lib/shariaVerdict.js'

const good = { status: 'halal', asOf: '2026-10-07', byStandard: { AAOIFI: { pass: true } } }
const throttled = { status: 'unknown', reason: 'finnhub_unavailable:429' }

describe('mergeVerdicts', () => {
  it('a throttled result never overwrites a good cached verdict', () => {
    expect(mergeVerdicts({ STX: good }, { STX: throttled }).STX).toBe(good)
  })
  it('a good result replaces anything; an unknown fills a gap', () => {
    const newer = { ...good, status: 'haram' }
    expect(mergeVerdicts({ STX: good }, { STX: newer }).STX).toBe(newer)
    expect(mergeVerdicts({}, { TER: throttled }).TER).toBe(throttled)
  })
  it('does not mutate the cache and survives junk', () => {
    const prev = { STX: good }
    mergeVerdicts(prev, { TER: good })
    expect(prev).toEqual({ STX: good })
    expect(mergeVerdicts(null, null)).toEqual({})
  })
})

describe('symbolsToScreen', () => {
  it('skips symbols screened today, re-asks stale or unsettled ones', () => {
    const cache = { STX: good, TER: throttled, MU: { ...good, asOf: '2026-10-06' } }
    expect(symbolsToScreen(['stx', 'TER', 'MU', 'NEW', 'NEW'], cache, '2026-10-07')).toEqual(['TER', 'MU', 'NEW'])
  })
  it('survives junk', () => {
    expect(symbolsToScreen(null, null, 'x')).toEqual([])
    expect(isSettledVerdict(null)).toBe(false)
  })
})
