import { describe, it, expect } from 'vitest'
import { tradeEligibility, screenPlanInputs, HALAL_FUNDS } from '../../lib/trading/screenGate.mjs'

// Verdict shapes as lib/sharia.mjs produces them. STX on 2026-10-07: passes
// AAOIFI, fails 4 stricter standards, so the cross-standard VOTE said "haram".
const pass = (std = 'AAOIFI') => ({ status: 'halal', byStandard: { [std]: { pass: true } } })
const STX = { status: 'haram', byStandard: { AAOIFI: { pass: true }, FTSE_SHARIAH: { pass: false } } }
const failAaoifi = { status: 'review', byStandard: { AAOIFI: { pass: false } } }
const sector = { status: 'haram', reason: 'Prohibited sector: Banks', byStandard: { AAOIFI: { pass: false } } }
const inconclusive = { status: 'review', byStandard: { AAOIFI: { pass: null } } }
const throttled = { status: 'unknown', reason: 'finnhub_unavailable:429' }
const pending = { status: 'unknown', reason: 'pending' }

describe('tradeEligibility (owner decision 2026-10-07: every strategy uses AAOIFI)', () => {
  it('judges by AAOIFI, NOT the cross-standard vote', () => {
    expect(tradeEligibility(STX, 'STX')).toBe('eligible')
    expect(tradeEligibility(failAaoifi, 'X')).toBe('blocked')
  })
  it('a prohibited sector is always blocked', () => {
    expect(tradeEligibility(sector, 'BANK')).toBe('blocked')
  })
  it('evaluated-but-inconclusive is NOT eligible — unconfirmed is not halal', () => {
    expect(tradeEligibility(inconclusive, 'X')).toBe('blocked')
  })
  it('a failed or pending screen is "unverified" — retry, never buy on it', () => {
    expect(tradeEligibility(throttled, 'X')).toBe('unverified')
    expect(tradeEligibility(pending, 'X')).toBe('unverified')
    expect(tradeEligibility(null, 'X')).toBe('unverified')
  })
  it('Sharia-screened funds are eligible by construction (no company balance sheet to ratio-test)', () => {
    for (const f of ['SPUS', 'SPSK', 'HLAL', 'UMMA', 'SPWO']) {
      expect(HALAL_FUNDS.has(f)).toBe(true)
      expect(tradeEligibility(inconclusive, f)).toBe('eligible')
    }
  })
  it('honours another standard when a strategy names one', () => {
    expect(tradeEligibility(STX, 'STX', { standard: 'FTSE_SHARIAH' })).toBe('blocked')
  })
})

describe('screenPlanInputs', () => {
  const v = { STX, FAIL: failAaoifi, OK: pass(), HELDBAD: failAaoifi, HELDGAP: throttled, NEW: throttled }

  it('excludes ineligible buy candidates and sells holdings that FAIL the standard', () => {
    const r = screenPlanInputs({ candidates: ['STX', 'FAIL', 'OK'], held: ['HELDBAD', 'OK'], verdicts: v })
    expect(r.excludeBuys).toEqual(['FAIL'])
    expect(r.forceSells).toEqual(['HELDBAD'])
    expect(r.waiting).toBe(false)
  })

  it('never sells a holding just because its screen failed to load', () => {
    const r = screenPlanInputs({ candidates: [], held: ['HELDGAP'], verdicts: v })
    expect(r.forceSells).toEqual([])
  })

  it('waits while a buy candidate is unverified, and excludes it once past the cutoff', () => {
    expect(screenPlanInputs({ candidates: ['NEW', 'OK'], held: [], verdicts: v })).toMatchObject({ waiting: true, unverified: ['NEW'] })
    expect(screenPlanInputs({ candidates: ['NEW', 'OK'], held: [], verdicts: v, pastCutoff: true }))
      .toMatchObject({ waiting: false, excludeBuys: ['NEW'], unverified: ['NEW'] })
  })

  it('survives malformed input', () => {
    expect(screenPlanInputs(null)).toMatchObject({ excludeBuys: [], forceSells: [], waiting: false })
  })
})

// Wiring guards: the pure rule above is worthless if a strategy path stops calling it.
import { readFileSync } from 'node:fs'
import path from 'node:path'
describe('every strategy path screens by AAOIFI (handlers.mjs wiring)', () => {
  const SRC = readFileSync(path.resolve(__dirname, '../../lib/handlers.mjs'), 'utf8')
  const fn = (name) => { const i = SRC.indexOf(`async function ${name}(`); return SRC.slice(i, SRC.indexOf('\n}\n', i)) }
  it('rank plans screen their hold zone and held names, and wait on unverified ones', () => {
    const p = fn('prepareRankPlan')
    expect(p).toMatch(/screenPlanInputs\(/)
    expect(p).toMatch(/if \(screen\.waiting\)/)
    expect(p).toMatch(/forceSell/)
  })
  it('the AI research panel and the entry engine use tradeEligibility, not the vote', () => {
    expect(fn('runResearchPanel')).toMatch(/tradeEligibility\(screen, sym/)
    expect(fn('runResearchPanel')).not.toMatch(/verdict = String\(screen\?\.status/)
    expect(SRC).toMatch(/tradeEligibility\(entryScreen, tickerUp/)
  })
  it('the gate re-plans keep forced sells', () => {
    expect(fn('runAiGate')).toMatch(/rebalancePlan\(\{[^}]*forceSell/)
  })
})

describe('verdict cache retention', () => {
  const SRC = readFileSync(path.resolve(__dirname, '../../lib/handlers.mjs'), 'utf8')
  it('the daily cleanup evicts old verdict rows (Data Retention promises TTL eviction)', () => {
    const at = SRC.indexOf('if (pathname === "/api/cron/cleanup")')
    const c = SRC.slice(at, SRC.indexOf('checkDataFeeds(sbAdmin', at))
    expect(c.length).toBeGreaterThan(100)
    expect(c).toMatch(/from\("polygon_cache"\)\s*\.delete\([^)]*\)\.eq\("timespan", SCREEN_CACHE_SPAN\)\.lt\("from_date"/)
  })
})
