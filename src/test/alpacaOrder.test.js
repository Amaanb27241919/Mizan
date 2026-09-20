// Order sizing rules for the Alpaca path.
//
// Two things are pinned here. The first is broker mechanics: Alpaca accepts
// fractional quantities and `notional` dollar amounts only as day orders, and
// only one of qty/notional per order. Encoding that lets us refuse with a
// reason instead of relaying a 422 nobody can read.
//
// The second is a Sharia rule and matters more. An Alpaca account reports 4x
// buying power against cash by default — the Trade Lab paper account shows
// $400,000 against $100,000 — and spending into that gap is margin, which is
// riba. Every other trading platform validates affordability against
// buying_power in order to PERMIT leverage. Here the check exists to forbid it,
// so the denominator must be cash. These tests exist so that inversion cannot
// be "fixed" by someone reaching for the field that looks more permissive.
import { describe, it, expect } from 'vitest'
import { validateOrderSizing, estimateOrderValue, withinCashCeiling, FRACTIONAL_TIF }
  from '../../lib/market/orders.mjs'

describe('validateOrderSizing', () => {
  it('accepts a notional day order — the halal basket shape', () => {
    const r = validateOrderSizing({ notional: 25, type: 'market', timeInForce: 'day' })
    expect(r.ok).toBe(true)
    expect(r.isFractional).toBe(true)
  })

  it('accepts a fractional qty as fractional', () => {
    expect(validateOrderSizing({ qty: 0.42, timeInForce: 'day' })).toMatchObject({ ok: true, isFractional: true })
  })

  it('does not treat a whole-share order as fractional', () => {
    // Regression guard: the pre-existing whole-share path must keep working,
    // including time-in-force values fractional orders may not use.
    expect(validateOrderSizing({ qty: 3, timeInForce: 'gtc' })).toMatchObject({ ok: true, isFractional: false })
  })

  it('refuses qty and notional together', () => {
    expect(validateOrderSizing({ qty: 1, notional: 50 }).code).toBe('qty_and_notional')
  })

  it('refuses an order with no size at all', () => {
    expect(validateOrderSizing({}).code).toBe('no_size')
  })

  it(`requires time_in_force=${FRACTIONAL_TIF} for anything fractional`, () => {
    expect(validateOrderSizing({ notional: 50, timeInForce: 'gtc' }).code).toBe('fractional_tif')
    expect(validateOrderSizing({ qty: 0.5, timeInForce: 'gtc' }).code).toBe('fractional_tif')
  })

  it('refuses a notional amount finer than cents', () => {
    // Alpaca truncates past 2dp; a silently-changed order amount is worse
    // than a refusal.
    expect(validateOrderSizing({ notional: 10.123, timeInForce: 'day' }).code).toBe('notional_precision')
  })

  it('refuses nonsense sizes', () => {
    expect(validateOrderSizing({ notional: 0 }).code).toBe('bad_notional')
    expect(validateOrderSizing({ notional: -5 }).code).toBe('bad_notional')
    expect(validateOrderSizing({ qty: -1 }).code).toBe('bad_qty')
  })
})

describe('estimateOrderValue', () => {
  it('is the notional amount when given one', () => {
    expect(estimateOrderValue({ notional: 50 })).toBe(50)
  })
  it('is qty x price for a priced order', () => {
    expect(estimateOrderValue({ qty: 2, price: 50 })).toBe(100)
  })
  it('is null — not zero — when the value cannot be known', () => {
    // A market order given a share count and no quote. Null must mean
    // "do not claim to know"; zero would read as free and pass every ceiling.
    expect(estimateOrderValue({ qty: 2 })).toBeNull()
  })
})

describe('withinCashCeiling — margin is riba', () => {
  it('allows a buy that fits inside settled cash', () => {
    expect(withinCashCeiling({ side: 'buy', estimatedValue: 50, cash: 100000 }))
      .toMatchObject({ ok: true, enforced: true })
  })

  it('refuses a buy that would reach into margin', () => {
    const r = withinCashCeiling({ side: 'buy', estimatedValue: 200000, cash: 100000 })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('exceeds_cash')
    expect(r.error).toMatch(/riba/i)
  })

  it('refuses at buying power even though the broker would allow it', () => {
    // The exact shape of the trap: Alpaca reports $400k buying power on $100k
    // cash and would happily fill this. Cash is the ceiling.
    expect(withinCashCeiling({ side: 'buy', estimatedValue: 400000, cash: 100000 }).ok).toBe(false)
  })

  it('does not gate sells — they raise cash', () => {
    expect(withinCashCeiling({ side: 'sell', estimatedValue: 999999, cash: 1 }))
      .toMatchObject({ ok: true, enforced: false })
  })

  it('reports unenforced rather than passing silently when inputs are unknown', () => {
    // Honest about what it checked: the caller still sizes on cash, and this
    // is the backstop. Claiming a check that did not happen is the failure.
    expect(withinCashCeiling({ side: 'buy', estimatedValue: null, cash: 100 }))
      .toMatchObject({ ok: true, enforced: false })
    expect(withinCashCeiling({ side: 'buy', estimatedValue: 50, cash: null }))
      .toMatchObject({ ok: true, enforced: false })
  })
})
