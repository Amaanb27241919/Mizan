import { describe, it, expect } from 'vitest'
import { affordableBars, wholeShareOrders, slotPriceCap } from '../../lib/trading/smallAccount.mjs'

// Experiment E (2026-10-08): a $300, whole-shares-only version of B — the
// constraints of the owner's E*TRADE account, measured on paper first.
const bar = (c) => [{ c: c - 1 }, { c }]

describe('slotPriceCap', () => {
  it('is capital split across the slots', () => {
    expect(slotPriceCap({ capital: 300, buyTop: 3 })).toBe(100)
  })
  it('refuses nonsense', () => {
    expect(slotPriceCap({ capital: 0, buyTop: 3 })).toBe(0)
    expect(slotPriceCap(null)).toBe(0)
  })
})

describe('affordableBars — rank only what one slot can buy a share of', () => {
  it('drops names whose last close is above the cap', () => {
    const bars = { CSCO: bar(117), FCX: bar(72), FIX: bar(1751), NEW: [] }
    expect(Object.keys(affordableBars(bars, 100))).toEqual(['FCX'])
  })
  it('a zero cap keeps nothing; junk survives', () => {
    expect(affordableBars({ FCX: bar(72) }, 0)).toEqual({})
    expect(affordableBars(null, 100)).toEqual({})
  })
})

describe('wholeShareOrders — the E*TRADE rule: no fractions', () => {
  const price = { A: 40, B: 90, C: 33, SPSK: 17.43 }
  const priceOf = (s) => price[s] || 0
  it('floors each allocation to whole shares', () => {
    const r = wholeShareOrders({ allocations: [{ ticker: 'A', notional: 100 }, { ticker: 'B', notional: 100 }], priceOf, budget: 200 })
    expect(r.orders).toEqual([{ ticker: 'A', qty: 2 }, { ticker: 'B', qty: 1 }])
  })
  it('spends the leftover on whole shares in allocation order, never past the budget', () => {
    const r = wholeShareOrders({ allocations: [{ ticker: 'A', notional: 100 }, { ticker: 'C', notional: 100 }, { ticker: 'B', notional: 100 }], priceOf, budget: 300 })
    const spent = r.orders.reduce((t, o) => t + o.qty * priceOf(o.ticker), 0)
    expect(spent).toBeLessThanOrEqual(300)
    expect(r.leftover).toBeCloseTo(300 - spent)
    expect(r.leftover).toBeLessThan(Math.min(...Object.values(price).slice(0, 3)))
    for (const o of r.orders) expect(Number.isInteger(o.qty)).toBe(true)
  })
  it('holds one share of every planned name it can afford before doubling up (dry run, 2026-10-08)', () => {
    // Inverse-vol gave ON ~$80 against an $82.52 share: flooring dropped it
    // and the leftover bought more FCX/SLB — a 3-slot book became 2 names.
    const px = { FCX: 71.87, ON: 82.52, SLB: 47.96 }
    const r = wholeShareOrders({ allocations: [{ ticker: 'FCX', notional: 110 }, { ticker: 'ON', notional: 80 }, { ticker: 'SLB', notional: 110 }], priceOf: (t) => px[t], budget: 300 })
    expect(r.orders.map((o) => o.ticker).sort()).toEqual(['FCX', 'ON', 'SLB'])
    expect(r.orders.reduce((t, o) => t + o.qty * px[o.ticker], 0)).toBeLessThanOrEqual(300)
  })
  it('a name it cannot afford one share of is dropped, not rounded up', () => {
    const r = wholeShareOrders({ allocations: [{ ticker: 'B', notional: 50 }], priceOf, budget: 50 })
    expect(r.orders).toEqual([])
    expect(r.leftover).toBe(50)
  })
  it('survives junk', () => {
    expect(wholeShareOrders(null)).toEqual({ orders: [], leftover: 0 })
    expect(wholeShareOrders({ allocations: [{ ticker: 'Z', notional: 10 }], priceOf: () => 0, budget: 10 }).orders).toEqual([])
  })
})

import { readFileSync } from 'node:fs'
import path from 'node:path'
describe('rank engine wiring (handlers.mjs)', () => {
  const SRC = readFileSync(path.resolve(__dirname, '../../lib/handlers.mjs'), 'utf8')
  it('filters ranking to affordable names only when whole_shares is on', () => {
    const p = SRC.slice(SRC.indexOf('async function prepareRankPlan('), SRC.indexOf('async function runAiGate('))
    expect(p).toMatch(/if \(strat\.params\?\.whole_shares === true\) \{\s*rankBars = affordableBars\(rankBars, slotPriceCap\(/)
    expect(p.indexOf('affordableBars(')).toBeLessThan(p.indexOf('rankUniverse('))
  })
  it('whole-share buys go out as qty, never notional', () => {
    expect(SRC).toMatch(/wholeShareOrders\(\{ allocations: alloc\.allocations, priceOf, budget \}\)\.orders\s*\.map\(\(w\) => \(\{ sym: w\.ticker, side: "buy", qty: w\.qty, notional: null \}\)\)/)
  })
})
