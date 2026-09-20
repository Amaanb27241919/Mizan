// The deterministic portfolio baseline (Trade Lab proposal §35).
//
// This allocator exists to be boring and reproducible, so that when an AI
// research committee is eventually pointed at the same capital there is an
// honest baseline to measure it against. These tests pin the two properties
// that make it trustworthy: it spends exactly what it was given, and it never
// proposes a sell.
//
// The specific failure it replaces: the whole-share path buys the single
// most-underweight member it can afford a whole share of. At $50/week against
// a ~$55 share that means some weeks it buys NOTHING, and a member that is
// never individually affordable is never bought at all. There is a test below
// for exactly that case.
import { describe, it, expect } from 'vitest'
import { computeBasketAllocation, MIN_NOTIONAL } from '../../lib/trading/basket.mjs'

// Halal Bogleheads three-fund, the live basket's weights.
const legs = (over = {}) => [
  { ticker: 'SPUS', weight: 50, price: 55, value: 0 },
  { ticker: 'SPWO', weight: 30, price: 28, value: 0 },
  { ticker: 'SPSK', weight: 20, price: 21, value: 0 },
].map((l) => ({ ...l, ...(over[l.ticker] || {}) }))

const by = (r) => Object.fromEntries(r.allocations.map((a) => [a.ticker, a.notional]))
const sum = (r) => Math.round(r.allocations.reduce((s, a) => s + a.notional, 0) * 100) / 100

describe('computeBasketAllocation — an empty basket', () => {
  it('splits the contribution at exact target weights', () => {
    const r = computeBasketAllocation({ legs: legs(), budget: 50 })
    expect(by(r)).toEqual({ SPUS: 25, SPWO: 15, SPSK: 10 })
  })

  it('buys every member even when no member costs less than one share', () => {
    // The whole-share path's dead zone: $50 budget, cheapest share $21, most
    // underweight is SPUS at $55 — it would buy SPSK or nothing depending on
    // the week. Notional buys all three, every week, at the right weights.
    const r = computeBasketAllocation({ legs: legs(), budget: 50 })
    expect(r.allocations).toHaveLength(3)
    expect(r.allocations.every((a) => a.notional > 0)).toBe(true)
  })
})

describe('computeBasketAllocation — drift correction', () => {
  it('steers contributions to the laggards, not evenly', () => {
    // SPUS has run up and is far above its 50% target; the money should go to
    // the other two rather than being split by raw weight.
    const r = computeBasketAllocation({ legs: legs({ SPUS: { value: 5000 } }), budget: 100 })
    const a = by(r)
    expect(a.SPUS ?? 0).toBe(0)
    expect((a.SPWO ?? 0) + (a.SPSK ?? 0)).toBeCloseTo(100, 2)
  })

  it('never proposes a sell, however far a leg has drifted', () => {
    const r = computeBasketAllocation({ legs: legs({ SPUS: { value: 1_000_000 } }), budget: 50 })
    expect(r.allocations.every((a) => a.notional >= 0)).toBe(true)
  })

  it('falls back to raw weights when every leg is already at target', () => {
    const r = computeBasketAllocation({
      legs: legs({ SPUS: { value: 500 }, SPWO: { value: 300 }, SPSK: { value: 200 } }), budget: 50,
    })
    expect(by(r)).toEqual({ SPUS: 25, SPWO: 15, SPSK: 10 })
  })
})

describe('computeBasketAllocation — closure', () => {
  it('spends the budget exactly, to the cent', () => {
    // The invariant. A basket that quietly spends a different amount than it
    // was handed is the bug this module exists to make impossible.
    for (const b of [1, 3, 7.77, 25, 50, 51.11, 100, 333.33, 1000.01]) {
      expect(sum(computeBasketAllocation({ legs: legs(), budget: b }))).toBe(b)
    }
  })

  it('spends the budget exactly with awkward weights and held value', () => {
    const odd = [
      { ticker: 'A', weight: 1, price: 3.33, value: 17.77 },
      { ticker: 'B', weight: 7, price: 101.5, value: 3.01 },
      { ticker: 'C', weight: 13, price: 0.99, value: 0 },
    ]
    for (const b of [10, 19.99, 47.03, 250.5]) {
      expect(sum(computeBasketAllocation({ legs: odd, budget: b }))).toBe(b)
    }
  })
})

describe('computeBasketAllocation — broker floor', () => {
  it('never emits an order below the notional minimum', () => {
    const r = computeBasketAllocation({ legs: legs(), budget: 5 })
    expect(r.allocations.every((a) => a.notional >= MIN_NOTIONAL)).toBe(true)
    expect(sum(r)).toBe(5)
  })

  it('puts a tiny budget into the single most-underweight leg', () => {
    const r = computeBasketAllocation({ legs: legs(), budget: 1 })
    expect(r.allocations).toHaveLength(1)
    expect(sum(r)).toBe(1)
  })
})

describe('computeBasketAllocation — refusals', () => {
  it('refuses a budget under the broker minimum rather than emitting junk', () => {
    expect(computeBasketAllocation({ legs: legs(), budget: 0.5 }))
      .toMatchObject({ ok: false, reason: 'budget_below_minimum' })
  })

  it('refuses when no leg is usable', () => {
    expect(computeBasketAllocation({ legs: [], budget: 50 }).reason).toBe('no_valid_legs')
    expect(computeBasketAllocation({ legs: [{ ticker: 'X', weight: 0, price: 5 }], budget: 50 }).reason).toBe('no_valid_legs')
    expect(computeBasketAllocation({ legs: [{ ticker: 'X', weight: 5, price: 0 }], budget: 50 }).reason).toBe('no_valid_legs')
  })

  it('survives null and garbage rather than throwing', () => {
    // Fourth time this trap has appeared in this codebase: a default parameter
    // only fires on undefined, so an explicit null reaches the loop.
    expect(computeBasketAllocation({ legs: null, budget: 50 }).ok).toBe(false)
    expect(computeBasketAllocation({}).ok).toBe(false)
    expect(computeBasketAllocation().ok).toBe(false)
    // A TRUTHY non-array is the case `legs || []` cannot catch — it passes the
    // value straight through to .filter and throws. Found by mutation testing:
    // the null cases above went green against both the real guard and a broken
    // one, so they were proving nothing about it.
    for (const junk of ['SPUS', {}, 42, { ticker: 'SPUS' }]) {
      expect(() => computeBasketAllocation({ legs: junk, budget: 50 })).not.toThrow()
      expect(computeBasketAllocation({ legs: junk, budget: 50 }).ok).toBe(false)
    }
  })
})
