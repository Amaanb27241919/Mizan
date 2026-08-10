// Dividend detection for the purification cron.
//
// Regression guard for 2026-08-10: /api/cron/dividend-check asked Finnhub for
// the market-wide dividend calendar, an endpoint not on our plan that answers
// `200 {}` rather than an error. Every run therefore found zero dividends and
// reported "ok" — audit_log held zero `dividend_upcoming` and zero
// `purification.notif_sent` rows for the entire life of the feature. The cron
// now reads the user's own synced SnapTrade activities; these two pure helpers
// are what decides which of those rows is a purifiable dividend and for which
// ticker, so they are the part worth pinning down.
import { describe, it, expect } from 'vitest'
import { isDividendActivity, snapTicker } from '../../lib/handlers.mjs'

describe('isDividendActivity', () => {
  it('accepts the broker-native cash-dividend codes', () => {
    for (const code of ['CDIV', 'GDIV', 'QDIV', 'DIV']) {
      expect(isDividendActivity(code)).toBe(true)
    }
  })

  it('accepts SnapTrade\'s canonical DIVIDEND type regardless of case', () => {
    expect(isDividendActivity('DIVIDEND')).toBe(true)
    expect(isDividendActivity('dividend')).toBe(true)
    expect(isDividendActivity(' Dividend ')).toBe(true)
  })

  it('accepts broker phrasings that embed the word', () => {
    expect(isDividendActivity('QUALIFIED DIVIDEND')).toBe(true)
    expect(isDividendActivity('DIVIDEND REINVESTMENT')).toBe(true)
  })

  it('rejects dividend FEES — money out is not purifiable income', () => {
    expect(isDividendActivity('DFEE')).toBe(false)
    expect(isDividendActivity('ADR DFEE')).toBe(false)
  })

  it('rejects interest: riba is a different ruling, not a purifiable dividend', () => {
    expect(isDividendActivity('INT')).toBe(false)
    expect(isDividendActivity('INTEREST INCOME')).toBe(false)
  })

  it('rejects trades, transfers and empty input', () => {
    for (const t of ['BUY', 'SELL', 'DEPOSIT', 'WITHDRAWAL', 'FEE', '', null, undefined]) {
      expect(isDividendActivity(t)).toBe(false)
    }
  })
})

describe('snapTicker', () => {
  it('reads a bare string symbol', () => {
    expect(snapTicker('SPUS')).toBe('SPUS')
  })

  it('normalizes case and surrounding whitespace so ratio lookups match', () => {
    expect(snapTicker(' spus ')).toBe('SPUS')
  })

  it('unwraps the one-level nested shape', () => {
    expect(snapTicker({ symbol: 'HLAL' })).toBe('HLAL')
  })

  it('unwraps the two-level nested shape SnapTrade returns for many brokers', () => {
    expect(snapTicker({ symbol: { symbol: 'UMMA', raw_symbol: 'UMMA' } })).toBe('UMMA')
  })

  it('falls back to raw_symbol, then ticker', () => {
    expect(snapTicker({ raw_symbol: 'SPSK' })).toBe('SPSK')
    expect(snapTicker({ ticker: 'SPTE' })).toBe('SPTE')
  })

  it('returns "" for anything unusable rather than a misleading partial', () => {
    // A cash dividend with no symbol must not resolve to some other ticker's
    // impurity ratio — "" can never match a purification_ratios key.
    for (const v of [null, undefined, {}, { symbol: {} }, 42]) {
      expect(snapTicker(v)).toBe('')
    }
  })
})
