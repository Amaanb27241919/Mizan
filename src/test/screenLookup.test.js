// Verdicts returned for symbols the user does NOT hold.
//
// Context (2026-08-10): the Screener could only screen tickers already in the
// portfolio — `tickers` came from `holdings`, and the watchlist was never
// screened — so there was no way to ask "is NVDA halal?" about something you
// don't own. /api/screen always accepted an arbitrary symbol, so the Screener
// gained an ad-hoc lookup that calls straight through to screenSymbol().
//
// That new path exposed a latent bug. screenSymbol() short-circuited every
// known crypto ticker to status "halal" with EVERY standard marked pass. The
// client masked it for HELD crypto by forcing "review" (MizanApp.jsx), but
// that override keys on the connector-reported asset type, which a lookup has
// no access to — so "DOGE" would have rendered as Halal, all standards green.
// Auto-blessing a token the ratio engine never evaluated is the same class of
// failure as the July nisab bug: a confidently-wrong religious claim.
import { describe, it, expect } from 'vitest'
import { screenSymbol } from '../../lib/sharia.mjs'

// Every branch asserted here returns before any network call, so these run
// offline and without a FINNHUB_KEY.
const CRYPTO = ['BTC', 'ETH', 'SOL', 'DOGE', 'ADA', 'DOT', 'LINK', 'AVAX', 'MATIC', 'XRP', 'LTC', 'BCH']

describe('screenSymbol — crypto is never auto-classified', () => {
  it('returns review, not halal, for every known token', async () => {
    for (const tk of CRYPTO) {
      const v = await screenSymbol(tk)
      expect(v.status, `${tk} must not be auto-blessed`).toBe('review')
    }
  })

  it('marks no standard as passing — the ratio engine never evaluated one', async () => {
    const v = await screenSymbol('BTC')
    const passes = Object.values(v.byStandard || {}).map(s => s.pass)
    expect(passes.length).toBeGreaterThan(0)
    expect(passes.every(p => p !== true)).toBe(true)
  })

  it('says why, so the UI never shows a bare verdict with no reasoning', async () => {
    const v = await screenSymbol('ETH')
    expect(v.reason).toMatch(/scholar/i)
    expect(v.assetType).toBe('crypto')
  })

  it('normalizes case and whitespace before matching', async () => {
    const v = await screenSymbol('  btc  ')
    expect(v.tk).toBe('BTC')
    expect(v.status).toBe('review')
  })
})

describe('screenSymbol — unusable input', () => {
  it('returns unknown for an empty symbol rather than guessing', async () => {
    for (const bad of ['', '   ', null, undefined]) {
      const v = await screenSymbol(bad)
      expect(v.status).toBe('unknown')
    }
  })

  // The lookup UI treats "unknown" as an error state rather than rendering it
  // as a neutral badge — an "Unscreened" chip reads as an answer when it isn't.
  it('never reports unknown as a pass', async () => {
    const v = await screenSymbol('')
    expect(v.status).not.toBe('halal')
    expect(v.byStandard).toBeUndefined()
  })
})
