import { describe, it, expect } from 'vitest'
import { strategyLabel, blotterRows, allocationSegments, tapeRows, strategyStatus } from '../lib/deskBlotter.js'

const strat = (over = {}) => ({
  id: 'a7728bbe-1', strategy_type: 'rank_rebalance', mode: 'semi', enabled: true, capital_allocated: '250000.00',
  nl_description: 'Experiment A — reference (uncle) system: top 15 / hold 25',
  params: { experiment: 'A: reference system + AI gate', broker: 'alpaca_paper', ai_gate: true, rebalance_days: 30, last_rebalance: '2026-10-07' },
  progress: { paper: true, equity: 252557.84, return_pct: 1.0231, bench_return_pct: -0.0981, alpha_pct: 1.1212, started_at: '2026-10-07T13:33:38Z', trades_executed: 13, holdings_count: 16 },
  ...over,
})

describe('strategyLabel — every strategy has a name a person can read', () => {
  it('reads the experiment code and name', () => {
    expect(strategyLabel(strat())).toEqual({ code: 'A', name: 'Reference system + AI gate' })
    expect(strategyLabel(strat({ params: { experiment: 'E · core: A + C combined, whole shares' } }))).toEqual({ code: 'E·core', name: 'A + C combined, whole shares' })
  })
  it('falls back to the first clause of the description', () => {
    expect(strategyLabel(strat({ params: {}, nl_description: 'Halal momentum, top 25 of the SPUS universe' }))).toEqual({ code: '', name: 'Halal momentum' })
    expect(strategyLabel({ strategy_type: 'dca', params: {} })).toEqual({ code: '', name: 'dca' })
  })
})

describe('strategyStatus', () => {
  const now = new Date('2026-10-08T15:00:00Z')
  it('a DCA waiting for a deposit says so', () => {
    expect(strategyStatus(strat({ strategy_type: 'dca', params: { dca_waiting_for_funds: '2026-10-08' } }), now)).toEqual({ text: 'waiting for a deposit', tone: 'warn' })
  })
  it('a rank strategy states its next rebalance', () => {
    expect(strategyStatus(strat(), now).text).toBe('rebalance in 29d')
  })
  it('a rebalance waiting on the Sharia screen says so', () => {
    expect(strategyStatus(strat({ params: { last_screen: { date: '2026-10-08', waiting: true, unverified: ['X'] } } }), now)).toEqual({ text: 'screen pending (1)', tone: 'warn' })
  })
  it('paused and shadow read as such', () => {
    expect(strategyStatus(strat({ enabled: false }), now).text).toBe('paused')
    expect(strategyStatus(strat({ params: { layer: 'shadow' } }), now).text).toMatch(/shadow/)
  })
  it('a swing holding a name names it', () => {
    expect(strategyStatus(strat({ strategy_type: 'breakout', progress: { held_ticker: 'ISRG' } }), now).text).toBe('holding ISRG')
  })
})

describe('blotterRows', () => {
  it('passes the scoreboard through; an unpriced strategy has no return, never −100%', () => {
    const [a, d] = blotterRows([strat(), strat({ id: 'd', params: { experiment: 'D: swing' }, progress: { paper: true, equity: null, return_pct: null, unpriced: ['ISRG'], started_at: 'x', trades_executed: 1 } })])
    expect(a).toMatchObject({ code: 'A', sleeve: 250000, equity: 252557.84, returnPct: 1.0231, benchPct: -0.0981, alphaPct: 1.1212, venue: 'paper', holdings: 16 })
    expect(d).toMatchObject({ code: 'D', equity: null, returnPct: null, unpriced: true })
  })
  it('sorts by experiment code, unlabeled last', () => {
    const rows = blotterRows([strat({ id: '1', params: {}, nl_description: 'Halal momentum' }), strat({ id: '2', params: { experiment: 'B: x' } }), strat({ id: '3' })])
    expect(rows.map((r) => r.code)).toEqual(['A', 'B', ''])
  })
  it('survives junk', () => { expect(blotterRows(null)).toEqual([]) })
})

describe('allocationSegments — how the pot is split', () => {
  it('each sleeve is its share of the account; the rest is unallocated', () => {
    const segs = allocationSegments([{ code: 'A', sleeve: 250000 }, { code: 'B', sleeve: 250000 }], 1000000)
    expect(segs).toEqual([
      { code: 'A', amount: 250000, pct: 25 },
      { code: 'B', amount: 250000, pct: 25 },
      { code: 'unallocated', amount: 500000, pct: 50 },
    ])
  })
  it('over-allocation is stated, never drawn past 100%', () => {
    const segs = allocationSegments([{ code: 'A', sleeve: 900000 }, { code: 'B', sleeve: 300000 }], 1000000)
    expect(segs.reduce((t, s) => t + s.pct, 0)).toBeCloseTo(100)
    expect(segs.find((s) => s.code === 'unallocated')).toBeUndefined()
  })
  it('no account equity, no bar', () => { expect(allocationSegments([{ code: 'A', sleeve: 1 }], 0)).toEqual([]) })
})

describe('tapeRows — the activity tape', () => {
  const items = [
    { id: '1', strategy_id: 'a7728bbe-1', ticker: 'MU', side: 'buy', qty: 34.5, status: 'executed', created_at: '2026-10-07T13:33:00Z' },
    { id: '2', strategy_id: 'a7728bbe-1', ticker: 'COHR', side: 'buy', qty: 0, status: 'shadow', created_at: '2026-10-07T13:40:00Z' },
    { id: '3', strategy_id: 'zzz', ticker: 'SPWO', side: 'buy', qty: 1, status: 'rejected', error_msg: 'HTTP 402', created_at: '2026-10-07T13:30:00Z' },
  ]
  it('orders, newest first; AI reviews are not orders and are left out', () => {
    const rows = tapeRows(items, [strat()])
    expect(rows.map((r) => r.id)).toEqual(['1', '3'])
    expect(rows[0]).toMatchObject({ code: 'A', side: 'buy', ticker: 'MU', status: 'executed' })
    expect(rows[1].code).toBe('—')
  })
  it('caps the tape', () => {
    expect(tapeRows(Array.from({ length: 40 }, (_, i) => ({ ...items[0], id: String(i) })), [], 12)).toHaveLength(12)
  })
})

import { groupTotals } from '../lib/deskBlotter.js'
describe('groupTotals', () => {
  it('sums a multi-sleeve experiment into one line', () => {
    expect(groupTotals([{ group: 'E', sleeve: 70000, equity: 71400, traded: true }, { group: 'E', sleeve: 30000, equity: 29700, traded: true }, { group: null, sleeve: 1, equity: 1 }]))
      .toEqual([{ group: 'E', members: 2, sleeve: 100000, equity: 101100, traded: true, returnPct: 1.1 }])
  })
  it('no return before any sleeve trades — not 0.00%', () => {
    expect(groupTotals([{ group: 'E', sleeve: 70000, equity: 70000, traded: false }, { group: 'E', sleeve: 30000, equity: 30000, traded: false }])[0].returnPct).toBeNull()
  })
  it('unknown, not partial, when a member is unpriced', () => {
    expect(groupTotals([{ group: 'E', sleeve: 1, equity: null, traded: true }, { group: 'E', sleeve: 1, equity: 1, traded: true }])[0]).toMatchObject({ equity: null, returnPct: null })
  })
  it('a single-member group is not a group', () => { expect(groupTotals([{ group: 'X', sleeve: 1, equity: 1 }])).toEqual([]) })
})

describe('tapeRows ordering', () => {
  it('sorts by the time it displays — the fill', () => {
    const rows = tapeRows([
      { id: 'late-created-early-fill', created_at: '2026-10-07T13:35:00Z', executed_at: '2026-10-07T13:33:10Z', status: 'executed' },
      { id: 'early-created-late-fill', created_at: '2026-10-07T13:33:00Z', executed_at: '2026-10-07T13:34:30Z', status: 'executed' },
    ], [])
    expect(rows.map((r) => r.id)).toEqual(['early-created-late-fill', 'late-created-early-fill'])
  })
})

describe("strategyMode", () => {
  it("places each strategy on the execution ladder", async () => {
    const { strategyMode, MODE_LADDER } = await import("../lib/deskBlotter.js");
    expect(MODE_LADDER).toEqual(["shadow", "paper", "confirm", "semi", "auto"]);
    expect(strategyMode({ params: { layer: "shadow", broker: "alpaca_paper" } })).toBe("shadow");
    expect(strategyMode({ params: { broker: "alpaca_paper", layer: "full" } })).toBe("paper");
    expect(strategyMode({ progress: { paper: true } })).toBe("paper");
    expect(strategyMode({ params: { layer: "full" } })).toBe("auto");
    expect(strategyMode({ params: { layer: "manual" } })).toBe("confirm");
    expect(strategyMode({ mode: "full" })).toBe("auto");
    expect(strategyMode({})).toBe("semi");
    expect(strategyMode({ enabled: false, params: { layer: "full" } })).toBe("halted");
    expect(strategyMode(null)).toBe("semi");
  });
});
