// The US equity market clock, including the extended-hours sessions.
//
// Every case pins a real wall-clock instant with an EXPLICIT UTC offset rather
// than relying on the runner's timezone, because the whole point of this module
// is that it answers in America/New_York no matter where it runs. A test that
// only passes on a US-East laptop would guard nothing on Vercel.
//
// Both DST phases are covered deliberately: EDT (-04:00) in August and EST
// (-05:00) in January. A naive implementation that hardcodes an offset passes
// one and fails the other, which is exactly the bug worth catching.
import { describe, it, expect } from 'vitest'
import {
  marketSession,
  usMarketStatus,
  validateSessionOrder,
  SESSION_BOUNDS,
  MARKET_HOLIDAYS,
  EARLY_CLOSES,
} from '../../lib/market/sessions.mjs'

// 2026-08-25 is a Tuesday in EDT (-04:00); 2026-01-13 a Tuesday in EST (-05:00).
const edt = (hhmm) => new Date(`2026-08-25T${hhmm}:00-04:00`)
const est = (hhmm) => new Date(`2026-01-13T${hhmm}:00-05:00`)

describe('marketSession — the four sessions', () => {
  it.each([
    ['04:00', 'pre',     'pre_market'],
    ['08:59', 'pre',     'pre_market'],
    ['09:30', 'regular', 'open'],
    ['12:00', 'regular', 'open'],
    ['15:59', 'regular', 'open'],
    ['16:00', 'after',   'after_hours'],
    ['19:59', 'after',   'after_hours'],
    ['20:00', 'closed',  'overnight'],
    ['23:30', 'closed',  'overnight'],
    ['03:59', 'closed',  'overnight'],
  ])('%s ET → %s', (hhmm, session, reason) => {
    const s = marketSession(edt(hhmm))
    expect(s.session).toBe(session)
    expect(s.reason).toBe(reason)
  })

  // Same boundaries must hold in winter. If the implementation ever hardcodes
  // an offset instead of asking Intl, this block is what goes red.
  it.each([
    ['04:00', 'pre'],
    ['09:30', 'regular'],
    ['16:00', 'after'],
    ['20:00', 'closed'],
  ])('%s ET in EST → %s (DST-safe)', (hhmm, session) => {
    expect(marketSession(est(hhmm)).session).toBe(session)
  })

  it('is closed all weekend, including during weekday session hours', () => {
    expect(marketSession(new Date('2026-08-22T12:00:00-04:00')).reason).toBe('weekend') // Sat
    expect(marketSession(new Date('2026-08-23T12:00:00-04:00')).reason).toBe('weekend') // Sun
  })

  it('is closed on a listed holiday', () => {
    expect(MARKET_HOLIDAYS.has('2026-11-26')).toBe(true)
    const s = marketSession(new Date('2026-11-26T12:00:00-05:00')) // Thanksgiving
    expect(s.session).toBe('closed')
    expect(s.reason).toBe('holiday')
    expect(s.tradeable).toBe(false)
  })

  it('marks only pre and after as extended, and only those require a limit', () => {
    expect(marketSession(edt('05:00'))).toMatchObject({ extendedHours: true,  requiresLimit: true,  tradeable: true })
    expect(marketSession(edt('17:00'))).toMatchObject({ extendedHours: true,  requiresLimit: true,  tradeable: true })
    expect(marketSession(edt('12:00'))).toMatchObject({ extendedHours: false, requiresLimit: false, tradeable: true })
    expect(marketSession(edt('22:00'))).toMatchObject({ extendedHours: false, requiresLimit: false, tradeable: false })
  })

  it('exposes the documented session bounds', () => {
    expect(SESSION_BOUNDS).toEqual({ preOpen: 240, regularOpen: 570, regularClose: 960, afterClose: 1200 })
  })
})

describe('usMarketStatus — unchanged contract for the bot and SnapTrade gate', () => {
  // These two callers place MARKET orders, which every broker refuses outside
  // regular hours. If extended-hours support ever leaks into this wrapper, the
  // bot starts firing market orders into a 2%-of-volume book. It must not.
  it('is open ONLY during the regular session', () => {
    expect(usMarketStatus(edt('12:00')).open).toBe(true)
    for (const t of ['03:00', '05:00', '09:29', '16:00', '17:00', '21:00']) {
      expect(usMarketStatus(edt(t)).open).toBe(false)
    }
  })

  it('preserves the original reason strings', () => {
    expect(usMarketStatus(edt('12:00')).reason).toBe('open')
    expect(usMarketStatus(edt('05:00')).reason).toBe('pre_market')
    expect(usMarketStatus(edt('17:00')).reason).toBe('after_hours')
    expect(usMarketStatus(new Date('2026-08-22T12:00:00-04:00')).reason).toBe('weekend')
    expect(usMarketStatus(new Date('2026-11-26T12:00:00-05:00')).reason).toBe('holiday')
  })
})

describe('validateSessionOrder — broker rules, enforced before the broker', () => {
  const PRE = edt('05:00')
  const REG = edt('12:00')
  const OFF = edt('22:00')

  it('refuses everything when the market is closed', () => {
    const v = validateSessionOrder({ type: 'limit', limitPrice: 100 }, OFF)
    expect(v.ok).toBe(false)
    expect(v.code).toBe('market_closed')
  })

  it('allows a plain market order during regular hours', () => {
    const v = validateSessionOrder({ type: 'market' }, REG)
    expect(v.ok).toBe(true)
    expect(v.extendedHours).toBe(false)
  })

  // The important one. Alpaca does not reject an out-of-hours market order —
  // it QUEUES it to the next session, so the user thinks they traded and fills
  // later at a price they never saw. Mizan refuses instead.
  it('refuses a market order in an extended session', () => {
    const v = validateSessionOrder({ type: 'market' }, PRE)
    expect(v.ok).toBe(false)
    expect(v.code).toBe('limit_required')
    expect(v.error).toMatch(/queued to the next session/i)
  })

  it('requires a limit price in an extended session', () => {
    expect(validateSessionOrder({ type: 'limit', limitPrice: null }, PRE).code).toBe('limit_price_required')
    expect(validateSessionOrder({ type: 'limit', limitPrice: 0 }, PRE).code).toBe('limit_price_required')
  })

  it('accepts only day or gtc time-in-force in an extended session', () => {
    expect(validateSessionOrder({ type: 'limit', limitPrice: 100, timeInForce: 'day' }, PRE).ok).toBe(true)
    expect(validateSessionOrder({ type: 'limit', limitPrice: 100, timeInForce: 'gtc' }, PRE).ok).toBe(true)
    expect(validateSessionOrder({ type: 'limit', limitPrice: 100, timeInForce: 'ioc' }, PRE).code).toBe('bad_tif')
  })

  it('marks a valid extended-hours order as extended', () => {
    const v = validateSessionOrder({ type: 'limit', limitPrice: 100 }, PRE)
    expect(v.ok).toBe(true)
    expect(v.extendedHours).toBe(true)
    expect(v.session.session).toBe('pre')
  })
})

// ── Half-days and the 2027 calendar ─────────────────────────────────────────
// Added 2026-09-19, after regenerating both tables from Alpaca's /v2/calendar
// — the authority, because it is the venue that accepts or rejects the order.
// That regeneration exposed two live defects, one per describe block below.
describe('marketSession — early closes', () => {
  // DEFECT 1: half-days were not modelled at all, so 13:00–16:00 on the day
  // after Thanksgiving read `regular`. A market order sent then is not
  // rejected by Alpaca — it is QUEUED to the next session and fills the
  // following morning at a price nobody saw. That is the failure this module
  // already refuses to allow in pre/after hours; it simply had a hole here.
  const halfDay = (hhmm) => new Date(`2026-11-27T${hhmm}:00-05:00`) // Fri after Thanksgiving

  it('trades normally up to the early close', () => {
    expect(marketSession(halfDay('09:30')).session).toBe('regular')
    expect(marketSession(halfDay('12:59')).session).toBe('regular')
  })

  it('keeps the reason string "open" on a half-day', () => {
    // usMarketStatus promises weekend|holiday|pre_market|after_hours|open to
    // the bot cron and the SnapTrade gate. A shortened session is still a
    // regular session, so that contract must not shift underneath them.
    expect(marketSession(halfDay('11:00')).reason).toBe('open')
    expect(usMarketStatus(halfDay('11:00'))).toEqual({ open: true, reason: 'open' })
  })

  it('is closed after the early close, not after-hours', () => {
    for (const t of ['13:00', '14:00', '15:59', '18:00']) {
      const s = marketSession(halfDay(t))
      expect(s.session).toBe('closed')
      expect(s.reason).toBe('early_close')
      expect(s.tradeable).toBe(false)
    }
  })

  it('refuses an order after the early close', () => {
    const v = validateSessionOrder({ type: 'market' }, halfDay('14:00'))
    expect(v.ok).toBe(false)
    expect(v.code).toBe('market_closed')
  })

  it('does not leak the early close to neighbouring days', () => {
    // The Monday after, and the Wednesday before, are ordinary sessions.
    expect(marketSession(new Date('2026-11-30T14:00:00-05:00')).session).toBe('regular')
    expect(marketSession(new Date('2026-11-25T14:00:00-05:00')).session).toBe('regular')
  })

  it('has 2027-12-24 as a holiday, not an early close', () => {
    // Christmas Eve is a half-day in 2026 and the observed holiday in 2027.
    // Exactly the detail that makes hand-writing these dates a bad idea.
    expect(EARLY_CLOSES.has('2026-12-24')).toBe(true)
    expect(EARLY_CLOSES.has('2027-12-24')).toBe(false)
    expect(MARKET_HOLIDAYS.has('2027-12-24')).toBe(true)
  })
})

describe('MARKET_HOLIDAYS — 2027 was seven days short', () => {
  // DEFECT 2: the table carried only three of 2027's ten holidays, so the
  // clock reported the market open on each of the rest and the bot cron would
  // have generated signals against a shut market all year.
  it.each([
    ['2027-03-26', 'Good Friday'],
    ['2027-05-31', 'Memorial Day'],
    ['2027-06-18', 'Juneteenth observed'],
    ['2027-07-05', 'Independence Day observed'],
    ['2027-09-06', 'Labor Day'],
    ['2027-11-25', 'Thanksgiving'],
    ['2027-12-24', 'Christmas observed'],
  ])('%s (%s) is closed', (date) => {
    expect(MARKET_HOLIDAYS.has(date)).toBe(true)
    expect(marketSession(new Date(`${date}T12:00:00-05:00`)).session).toBe('closed')
  })

  it('covers every holiday Alpaca lists through 2027', () => {
    // Guards against a partial year being added again. If this fails after a
    // regeneration, the table is short — re-run the recipe in sessions.mjs.
    expect([...MARKET_HOLIDAYS].filter((d) => d.startsWith('2026'))).toHaveLength(10)
    expect([...MARKET_HOLIDAYS].filter((d) => d.startsWith('2027'))).toHaveLength(10)
  })
})
