import { describe, it, expect } from 'vitest'
import {
  STANDARDS, MARK, markFor, complianceRow, complianceMatrix,
} from '../lib/complianceMatrix.js'

/** A verdict shaped exactly like lib/sharia.mjs returns. */
const verdict = (byStandard, over = {}) => ({
  tk: 'X', status: 'halal', byStandard, ...over,
})
const all = (pass) => Object.fromEntries(STANDARDS.map(s => [s, { pass, fails: [], ratios: {} }]))

// The real CRWD shape from 2026-10-02: passes the market-cap standards,
// fails the asset-denominated ones on Cash/Assets 47.2%.
const CRWD = verdict({
  AAOIFI: { pass: true, fails: [] },
  DOWJONES: { pass: true, fails: [] },
  SP_SHARIAH: { pass: true, fails: [] },
  FTSE_SHARIAH: { pass: false, fails: [{ rule: 'Cash/Assets', detail: '47.2%' }] },
  MSCI_ISLAMIC: { pass: false, fails: [{ rule: 'Cash/Assets', detail: '47.2%' }] },
  SC_MALAYSIA: { pass: false, fails: [{ rule: 'Cash/Assets', detail: '47.2%' }] },
  IFSB: { pass: false, fails: [{ rule: 'Cash/Assets', detail: '47.2%' }] },
}, { status: 'haram' })   // majority-of-seven calls it haram

// What a RATE-LIMITED screen looks like: every standard null, reason says why.
const THROTTLED = verdict(Object.fromEntries(
  STANDARDS.map(s => [s, { pass: null, fails: [], ratios: {},
    reason: s.startsWith('FTSE') || s.startsWith('MSCI') ? 'No totalAssets data' : 'No marketCap data' }]),
), { status: 'review' })

describe('markFor — no data is NOT a failed screen', () => {
  it('distinguishes NO_DATA from a genuine review', () => {
    // The confusion that nearly rebuilt a live portfolio: on a rate-limited
    // Finnhub every standard returns pass:null with "No marketCap data",
    // which reads as 175 of 214 names failing a screen they never ran.
    expect(markFor(THROTTLED, 'AAOIFI')).toBe(MARK.NO_DATA)
    const inconclusive = verdict({ AAOIFI: { pass: null, fails: [], reason: 'segment revenue unavailable' } })
    expect(markFor(inconclusive, 'AAOIFI')).toBe(MARK.REVIEW)
  })

  it('reads a real pass and a real fail', () => {
    expect(markFor(CRWD, 'AAOIFI')).toBe(MARK.PASS)
    expect(markFor(CRWD, 'FTSE_SHARIAH')).toBe(MARK.FAIL)
  })

  it('treats a prohibited SECTOR as categorical across every standard', () => {
    const sector = verdict(all(true), { status: 'haram', reason: 'Prohibited sector: Banking' })
    for (const s of STANDARDS) expect(markFor(sector, s), s).toBe(MARK.FAIL)
  })

  it('is NO_DATA for a missing verdict, never a pass', () => {
    for (const bad of [null, undefined, {}, 42, 'x']) {
      expect(markFor(bad, 'AAOIFI'), String(bad)).toBe(MARK.NO_DATA)
    }
    expect(markFor(verdict({}), 'AAOIFI')).toBe(MARK.NO_DATA)
  })
})

describe('complianceRow — surfacing the disagreement', () => {
  it('flags the real CRWD case: AAOIFI passes, the majority fails', () => {
    const r = complianceRow('CRWD', CRWD, { governing: 'AAOIFI' })
    expect(r.governingMark).toBe(MARK.PASS)
    expect(r.fails).toBe(4)
    expect(r.passes).toBe(3)
    expect(r.divergent).toBe(true)      // the thing worth a screen
  })

  it('does NOT flag a unanimous pass', () => {
    const r = complianceRow('COHR', verdict(all(true)))
    expect(r.divergent).toBe(false)
    expect(r.passes).toBe(7)
  })

  it('does NOT flag a unanimous fail', () => {
    const r = complianceRow('X', verdict(all(false)))
    expect(r.governingMark).toBe(MARK.FAIL)
    expect(r.divergent).toBe(false)
  })

  it('flags the OPPOSITE divergence too — governing fails while others pass', () => {
    const r = complianceRow('X', verdict({
      ...all(true), AAOIFI: { pass: false, fails: [{ rule: 'Debt', detail: '40%' }] },
    }))
    expect(r.governingMark).toBe(MARK.FAIL)
    expect(r.divergent).toBe(true)
  })

  it('is NOT comparable, and never divergent, on missing data', () => {
    const r = complianceRow('X', THROTTLED)
    expect(r.unscreened).toBe(true)
    expect(r.comparable).toBe(false)
    expect(r.divergent).toBe(false)     // never inferred from absence
    expect(r.evaluated).toBe(0)
  })

  it('honours a different governing standard', () => {
    const r = complianceRow('CRWD', CRWD, { governing: 'FTSE_SHARIAH' })
    expect(r.governingMark).toBe(MARK.FAIL)
    expect(r.divergent).toBe(false)     // FTSE fails and 3 others fail too
  })
})

describe('complianceMatrix — the book', () => {
  const holdings = [
    { symbol: 'CRWD', value: 5000 },
    { symbol: 'COHR', value: 9000 },
    { symbol: 'ZZZZ', value: 100 },     // never screened
  ]
  const verdicts = { CRWD, COHR: verdict(all(true)) }

  it('sorts the largest positions first', () => {
    // A divergence in a 7% position matters more than one in a 0.3% position.
    const m = complianceMatrix(holdings, verdicts)
    expect(m.rows.map(r => r.symbol)).toEqual(['COHR', 'CRWD', 'ZZZZ'])
  })

  it('reports unscreened separately from failing', () => {
    const m = complianceMatrix(holdings, verdicts)
    expect(m.total).toBe(3)
    expect(m.screened).toBe(2)
    expect(m.unscreened).toBe(1)
    expect(m.failingGoverning).toEqual([])   // ZZZZ is unknown, NOT failing
  })

  it('names the divergent holdings', () => {
    expect(complianceMatrix(holdings, verdicts).divergent).toEqual(['CRWD'])
  })

  it('defaults to AAOIFI, the owner-chosen governing standard', () => {
    expect(complianceMatrix(holdings, verdicts).governing).toBe('AAOIFI')
  })

  it('accepts bare ticker strings as well as objects', () => {
    const m = complianceMatrix(['CRWD', 'COHR'], verdicts)
    expect(m.total).toBe(2)
  })

  it('never throws on garbage', () => {
    for (const bad of [null, undefined, 42, 'x', [null, '', {}]]) {
      expect(() => complianceMatrix(bad, bad)).not.toThrow()
    }
    expect(complianceMatrix(null, null).total).toBe(0)
  })
})
