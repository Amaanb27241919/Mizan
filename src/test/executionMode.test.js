import { describe, it, expect } from 'vitest'
import {
  MODES, LAYERS, resolveMode, resolveLayer, canExecute, isAutonomous, isRealMoney, refusalReason,
} from '../../lib/trading/executionMode.mjs'

const strat = (over = {}) => ({ enabled: true, mode: 'semi', params: {}, ...over })
const paper = (over = {}) => strat({ params: { broker: 'alpaca_paper', ...(over.params || {}) }, ...over })

describe('resolveMode', () => {
  it('maps the ladder that already existed under other names', () => {
    expect(resolveMode(strat())).toBe(MODES.LIVE_CONFIRM)
    expect(resolveMode(paper())).toBe(MODES.PAPER)
    expect(resolveMode(strat({ mode: 'full', params: { layer: 'full' } }), { fullAutoAllowed: true }))
      .toBe(MODES.LIVE_AUTO)
    expect(resolveMode(strat({ enabled: false }))).toBe(MODES.HALTED)
    expect(resolveMode(strat({ params: { layer: 'manual' } }))).toBe(MODES.READ_ONLY)
  })

  it('adds SHADOW, the rung that did not exist', () => {
    expect(resolveMode(strat({ params: { layer: 'shadow' } }))).toBe(MODES.SHADOW)
  })

  it('is most-restrictive-first: a permission can only NARROW, never widen', () => {
    // Shadow beats full-auto. Halted beats everything. This ordering is the
    // safety property — if a looser signal could win, every guard below it is
    // decorative.
    const armed = { fullAutoAllowed: true }
    expect(resolveMode(strat({ mode: 'full', params: { layer: 'shadow' } }), armed)).toBe(MODES.SHADOW)
    expect(resolveMode(strat({ enabled: false, mode: 'full', params: { layer: 'full' } }), armed)).toBe(MODES.HALTED)
    expect(resolveMode(paper({ mode: 'full', params: { layer: 'shadow', broker: 'alpaca_paper' } }), armed)).toBe(MODES.SHADOW)
  })

  it('a global halt overrides every strategy', () => {
    expect(resolveMode(strat({ mode: 'full', params: { layer: 'full' } }), { fullAutoAllowed: true, globalHalt: true }))
      .toBe(MODES.HALTED)
  })

  it('needs BOTH the declaration and the permission for live full-auto', () => {
    // Either alone must fall back to confirm-first. This is the RIA line in
    // code: discretionary trading requires an explicit external grant.
    expect(resolveMode(strat({ mode: 'full', params: { layer: 'full' } }), { fullAutoAllowed: false }))
      .toBe(MODES.LIVE_CONFIRM)
    expect(resolveMode(strat({ mode: 'semi', params: { layer: 'full' } }), { fullAutoAllowed: true }))
      .toBe(MODES.LIVE_CONFIRM)
  })

  it('calls an autonomous PAPER strategy PAPER, never LIVE_AUTO', () => {
    // It executes without a human, but no real money is reachable. Describing
    // it as LIVE_AUTO would overstate the risk and understate the distinction
    // the whole experiment rests on.
    const m = resolveMode(paper({ mode: 'full', params: { layer: 'full', broker: 'alpaca_paper' } }), { fullAutoAllowed: true })
    expect(m).toBe(MODES.PAPER)
    expect(isRealMoney(m)).toBe(false)
    expect(isAutonomous(m)).toBe(true)
  })

  it('FAILS CLOSED on garbage, rather than inheriting permission to trade', () => {
    // `typeof [] === "object"`, so an array originally fell through the guard
    // and resolved to LIVE_CONFIRM — an executing mode. An empty object did
    // too, because the check was `enabled !== false` rather than
    // `enabled === true`. Both are fail-OPEN on a malformed row.
    for (const bad of [null, undefined, 'x', 42, [], {}, [{ enabled: true }], () => {}]) {
      expect(canExecute(resolveMode(bad)), JSON.stringify(bad) ?? String(bad)).toBe(false)
    }
    // NOTE: two guards cover this — the Array.isArray check and the
    // affirmative `enabled === true`. Removing either alone leaves the other
    // catching it, so no single mutation turns this red; only removing BOTH
    // does. Recorded so a later reader does not mistake the surviving mutant
    // for a weak test.
  })

  it('requires enabled to be affirmatively TRUE', () => {
    for (const e of [undefined, null, 0, '', 'true', 1]) {
      expect(resolveMode({ enabled: e, mode: 'semi', params: {} }), String(e)).toBe(MODES.HALTED)
    }
    expect(resolveMode({ enabled: true, mode: 'semi', params: {} })).toBe(MODES.LIVE_CONFIRM)
  })
})

describe('canExecute — the single refusal', () => {
  it('refuses SHADOW, READ_ONLY and HALTED', () => {
    expect(canExecute(MODES.SHADOW)).toBe(false)
    expect(canExecute(MODES.READ_ONLY)).toBe(false)
    expect(canExecute(MODES.HALTED)).toBe(false)
  })

  it('permits exactly the three executing modes', () => {
    expect(canExecute(MODES.PAPER)).toBe(true)
    expect(canExecute(MODES.LIVE_CONFIRM)).toBe(true)
    expect(canExecute(MODES.LIVE_AUTO)).toBe(true)
  })

  it('refuses anything it does not recognise', () => {
    // Fail closed. A typo or a mode added later without updating this must not
    // become permission to trade.
    for (const bad of ['', null, undefined, 'LIVE', 'paper', 'SHADOW ', 42]) {
      expect(canExecute(bad), String(bad)).toBe(false)
    }
  })
})

describe('resolveLayer', () => {
  it('prefers the declared layer, falls back to the legacy mode column', () => {
    expect(resolveLayer({ params: { layer: 'shadow' } })).toBe('shadow')
    expect(resolveLayer({ mode: 'full', params: {} })).toBe('full')
    expect(resolveLayer({ mode: 'semi', params: {} })).toBe('semi')
  })

  it('ignores a layer it does not know, rather than trusting it', () => {
    expect(resolveLayer({ mode: 'semi', params: { layer: 'autopilot' } })).toBe('semi')
    expect(resolveLayer({ mode: 'full', params: { layer: 'god_mode' } })).toBe('full')
  })

  it('includes shadow in the accepted layers', () => {
    expect(LAYERS).toContain('shadow')
  })
})

describe('refusalReason', () => {
  it('explains a shadow refusal in words a log and a human can share', () => {
    expect(refusalReason(MODES.SHADOW)).toMatch(/can never place an order/)
    expect(refusalReason(MODES.HALTED)).toMatch(/halted/)
    expect(refusalReason(MODES.READ_ONLY)).toMatch(/read_only/)
  })

  it('is null when the mode is not a refusal', () => {
    expect(refusalReason(MODES.PAPER)).toBeNull()
    expect(refusalReason(MODES.LIVE_AUTO)).toBeNull()
  })
})

// ── Static contract: the refusal is at the chokepoint ───────────────────────
import { readFileSync } from 'node:fs'
import path from 'node:path'

describe('execution refusal wiring', () => {
  const SRC = readFileSync(path.resolve(__dirname, '../../lib/handlers.mjs'), 'utf8')

  it('refuses inside executeStrategyOrder, the one path all five sites share', () => {
    // A per-branch guard protects only the branches someone remembered. This
    // one cannot be routed around without deleting it.
    const fn = SRC.slice(SRC.indexOf('async function executeStrategyOrder'))
    const head = fn.slice(0, 1800)
    expect(head).toMatch(/resolveMode\(strategy\)/)
    expect(head).toMatch(/if \(!canExecute\(mode\)\)/)
    // And it must come BEFORE any broker is resolved or contacted.
    expect(head.indexOf('canExecute(mode)')).toBeLessThan(head.indexOf('resolveBroker(strategy)'))
  })

  it('does not pass fullAutoAllowed, which would only widen the result', () => {
    const head = SRC.slice(SRC.indexOf('async function executeStrategyOrder')).slice(0, 1800)
    expect(head).not.toMatch(/resolveMode\(strategy,\s*\{[^}]*fullAutoAllowed:\s*true/)
  })
})
