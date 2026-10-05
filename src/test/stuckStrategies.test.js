import { describe, it, expect } from 'vitest'
import { findStuckStrategies, describeFailure, STUCK_THRESHOLD } from '../../lib/trading/stuck.mjs'

const sig = (strategy_id, status, created_at, error_msg = null) => ({ strategy_id, status, created_at, error_msg })
const strat = (id, over = {}) => ({ id, enabled: true, strategy_type: 'dca', ...over })

// The real failure that prompted this: the funded E*TRADE DCA was rejected 46
// days running ("could not resolve symbol SPWO") and nobody was told.
const dcaRun = Array.from({ length: 5 }, (_, i) =>
  sig('dca', 'rejected', `2026-10-0${i + 1}T13:30:00Z`, 'could not resolve symbol SPWO for account'))

describe('findStuckStrategies', () => {
  it('flags an enabled strategy whose recent signals are all rejected', () => {
    const out = findStuckStrategies([strat('dca')], dcaRun)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ strategy_id: 'dca', consecutive: 5, last_error: 'could not resolve symbol SPWO for account' })
    expect(out[0].since).toBe('2026-10-01T13:30:00Z')
  })

  it('needs the threshold, so one bad day is not an alert', () => {
    const short = dcaRun.slice(0, STUCK_THRESHOLD - 1)
    expect(findStuckStrategies([strat('dca')], short)).toEqual([])
  })

  it('a single success after the failures clears it — only the unbroken recent streak counts', () => {
    const recovered = [...dcaRun, sig('dca', 'executed', '2026-10-06T13:30:00Z')]
    expect(findStuckStrategies([strat('dca')], recovered)).toEqual([])
  })

  it('ignores shadow rows, which are records and never orders', () => {
    const withShadow = [...dcaRun, sig('dca', 'shadow', '2026-10-06T13:30:00Z')]
    expect(findStuckStrategies([strat('dca')], withShadow)[0].consecutive).toBe(5)
  })

  it('ignores disabled strategies — a retired strategy is not stuck', () => {
    expect(findStuckStrategies([strat('dca', { enabled: false })], dcaRun)).toEqual([])
  })

  it('does not trust input order', () => {
    const shuffled = [dcaRun[3], sig('dca', 'executed', '2026-09-30T13:30:00Z'), dcaRun[0], dcaRun[4], dcaRun[2], dcaRun[1]]
    expect(findStuckStrategies([strat('dca')], shuffled)[0].consecutive).toBe(5)
  })

  it('survives malformed input instead of crashing the daily sweep', () => {
    expect(findStuckStrategies(null, null)).toEqual([])
    expect(findStuckStrategies({ error: 'x' }, { error: 'y' })).toEqual([])
    expect(findStuckStrategies([null, strat('dca')], [null, ...dcaRun])).toHaveLength(1)
  })
})

describe('describeFailure', () => {
  it('names a broken brokerage login instead of blaming the symbol', () => {
    expect(describeFailure({ status: 401 })).toMatch(/re-?connect/i)
    expect(describeFailure({ status: 403 })).toMatch(/re-?connect/i)
    expect(describeFailure({ status: 402 })).toMatch(/read-only|trade permission/i)
  })

  it('keeps the plain message when the search worked but found nothing', () => {
    expect(describeFailure({ status: 200, empty: true }, 'SPWO')).toMatch(/SPWO/)
    expect(describeFailure({ status: 200, empty: true }, 'SPWO')).not.toMatch(/re-?connect/i)
  })

  it('always carries the HTTP status so the real cause is never swallowed again', () => {
    expect(describeFailure({ status: 500 }, 'SPWO')).toMatch(/500/)
  })
})
