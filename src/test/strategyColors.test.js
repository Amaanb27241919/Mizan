import { describe, it, expect } from 'vitest'
import { STRATEGY_PALETTE, strategyColorKey, strategyColor, strategyColorMap } from '../lib/strategyColors.js'

const s = (o) => ({ id: 'x', strategy_type: 'rank_rebalance', enabled: true, params: { broker: 'alpaca_paper' }, ...o })

describe('strategy identity colours', () => {
  it('each lettered experiment owns its slot; both E sleeves share E', () => {
    expect(strategyColorKey(s({ params: { experiment: 'A: reference system + AI gate' } }))).toBe('A')
    expect(strategyColorKey(s({ params: { experiment: 'D: swing' } }))).toBe('D')
    expect(strategyColor(s({ params: { experiment: 'E · core: A + C' } }))).toBe(STRATEGY_PALETTE.E)
    expect(strategyColor(s({ params: { experiment: 'E · swing: D + volume' } }))).toBe(STRATEGY_PALETTE.E)
  })
  it('the shadow panel and the live control have their own slots', () => {
    expect(strategyColorKey(s({ params: { layer: 'shadow', broker: 'alpaca_paper' } }))).toBe('SH')
    expect(strategyColorKey(s({ nl_description: 'Halal momentum, top 25' }))).toBe('LV')
  })
  it('anything else is neutral — a 9th strategy never gets a generated hue', () => {
    expect(strategyColor({ strategy_type: 'dca', params: {} })).toBeNull()
    expect(strategyColor(null)).toBeNull()
  })
  it('the eight hues are distinct and fixed', () => {
    const hues = Object.values(STRATEGY_PALETTE)
    expect(hues).toHaveLength(8)
    expect(new Set(hues).size).toBe(8)
    expect(Object.isFrozen(STRATEGY_PALETTE)).toBe(true)
  })
  it('id map for surfaces that only carry strategy_id', () => {
    const m = strategyColorMap([s({ id: 'a1', params: { experiment: 'A: x' } }), null])
    expect(m.get('a1')).toBe(STRATEGY_PALETTE.A)
  })
})
