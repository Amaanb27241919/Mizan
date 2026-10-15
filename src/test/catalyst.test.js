import { describe, it, expect } from 'vitest'
import { freshNewsSymbols, dayPnlPct, dayGoalAction, premarketPick, premarketLimit, fixedWeights } from '../../lib/trading/catalyst.mjs'

const NOW = Date.parse('2026-10-15T12:00:00Z')
const hoursAgo = (h) => new Date(NOW - h * 3600000).toISOString()

describe('freshNewsSymbols', () => {
  it('keeps names with an article inside the window, uppercased', () => {
    const raw = { news: [
      { symbols: ['crm', 'ORCL'], created_at: hoursAgo(2) },
      { symbols: ['MU'], created_at: hoursAgo(30) },
      { symbols: ['AAPL'], created_at: 'not a date' },
    ] }
    expect([...freshNewsSymbols(raw, { now: NOW, hours: 24 })].sort()).toEqual(['CRM', 'ORCL'])
  })
  it('survives malformed input', () => {
    expect(freshNewsSymbols(null).size).toBe(0)
    expect(freshNewsSymbols({ news: [null, { symbols: 'x', created_at: hoursAgo(1) }] }, { now: NOW }).size).toBe(0)
  })
})

describe('dayPnlPct — the green-day rule measures TODAY only', () => {
  it('a position held overnight is measured from the prior close', () => {
    expect(dayPnlPct({ capital: 10000, netQty: 40, price: 102.5, prevClose: 100, avgEntry: 90, openedToday: false })).toBe(1)
  })
  it('a position opened today is measured from its entry, plus what today already booked', () => {
    expect(dayPnlPct({ capital: 10000, netQty: 10, price: 98, avgEntry: 100, openedToday: true, realizedToday: 150 })).toBe(1.3)
  })
  it('flat: only what was booked today', () => {
    expect(dayPnlPct({ capital: 10000, netQty: 0, realizedToday: -220 })).toBe(-2.2)
  })
  it('null when a needed price or the capital is unknown', () => {
    expect(dayPnlPct({ capital: 10000, netQty: 5, price: 100, prevClose: null })).toBeNull()
    expect(dayPnlPct({ capital: 0, netQty: 0 })).toBeNull()
    expect(dayPnlPct(null)).toBeNull()
  })
})

describe('dayGoalAction', () => {
  it('locks the day at the goal and stops it at the limit', () => {
    expect(dayGoalAction(1, { goal: 1, limit: 2 })).toBe('goal')
    expect(dayGoalAction(-2.01, { goal: 1, limit: 2 })).toBe('limit')
    expect(dayGoalAction(0.5, { goal: 1, limit: 2 })).toBeNull()
  })
  it('does nothing on an unknown P&L or when unset', () => {
    expect(dayGoalAction(null, { goal: 1, limit: 2 })).toBeNull()
    expect(dayGoalAction(5, {})).toBeNull()
  })
})

describe('premarketPick', () => {
  const base = {
    universe: ['CRM', 'ORCL', 'MU', 'AVGO'],
    latest: { CRM: { price: 103, at: NOW }, ORCL: { price: 105, at: NOW }, MU: { price: 110, at: NOW - 20 * 3600000 }, AVGO: { price: 2000, at: NOW } },
    prevClose: { CRM: 100, ORCL: 100, MU: 100, AVGO: 1900 },
    minGapPct: 1.5, budget: 1000, freshSince: NOW - 3600000,
  }
  it('takes the strongest fresh gap one share of the budget can buy', () => {
    expect(premarketPick(base)).toEqual({ symbol: 'ORCL', price: 105, gapPct: 5 })
  })
  it('a stale trade is not a pre-market price; an unaffordable name is skipped', () => {
    const p = premarketPick({ ...base, universe: ['MU', 'AVGO'] })
    expect(p).toBeNull()
  })
  it('requires fresh news when asked, and fails closed without the news set', () => {
    expect(premarketPick({ ...base, requireNews: true, news: new Set(['CRM']) })).toMatchObject({ symbol: 'CRM' })
    expect(premarketPick({ ...base, requireNews: true, news: null })).toBeNull()
  })
  it('below the gap threshold, nothing', () => {
    expect(premarketPick({ ...base, minGapPct: 6 })).toBeNull()
  })
})

describe('premarketLimit', () => {
  it('a little above the last trade, in cents', () => {
    expect(premarketLimit(100)).toBe(100.5)
    expect(premarketLimit(33.33, 1)).toBe(33.66)
    expect(premarketLimit(0)).toBeNull()
  })
})

describe('fixedWeights — the halal dividend basket', () => {
  it('renormalizes the configured weights over the names still in the plan', () => {
    const w = fixedWeights({ TXN: 7.1, PG: 6.7, KO: 6.5 }, ['TXN', 'PG'])
    expect(w.TXN).toBeCloseTo(7.1 / 13.8, 10)
    expect(w.PG).toBeCloseTo(6.7 / 13.8, 10)
    expect(Object.values(w).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10)
  })
  it('a name with no weight is left out; nothing usable is empty', () => {
    expect(Object.keys(fixedWeights({ TXN: 1 }, ['TXN', 'NEW']))).toEqual(['TXN'])
    expect(fixedWeights({}, ['TXN'])).toEqual({})
    expect(fixedWeights(null, null)).toEqual({})
  })
})
