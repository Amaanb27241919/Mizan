import { describe, it, expect } from 'vitest'
import { deskEquity, deskDayChange, deskSummary } from '../lib/deskSummary.js'

// A stand-in for MizanApp's mapPosition: the only contract this module needs
// is that it returns something with `sym` and `qty`.
const mp = (raw) => ({ sym: raw.sym, qty: raw.qty })

const acct = (balance, positions = []) => ({ balance, positions })

describe('deskEquity', () => {
  it('sums account balances', () => {
    expect(deskEquity([acct(1000), acct(250.5)])).toBe(1250.5)
  })

  it('survives the garbage a connector actually sends', () => {
    // balance:0 is real — some 401k custodians report it, and treating the
    // account as absent is what once dropped it out of net worth entirely.
    expect(deskEquity([acct(0), acct('450'), acct(null), acct(undefined), {}])).toBe(450)
    expect(deskEquity(null)).toBe(0)
    expect(deskEquity('nope')).toBe(0)
  })
})

describe('deskDayChange', () => {
  it('sums qty x (current - previous close)', () => {
    const accounts = [acct(0, [{ sym: 'SPUS', qty: 10 }, { sym: 'SPSK', qty: 4 }])]
    const live = { SPUS: { c: 60, pc: 59 }, SPSK: { c: 24, pc: 25 } }
    const d = deskDayChange(accounts, live, mp)
    expect(d.change).toBeCloseTo(10 * 1 + 4 * -1, 10)   // +10 - 4 = +6
    expect(d.quoted).toBe(2)
    expect(d.total).toBe(2)
    expect(d.complete).toBe(true)
  })

  it('reports INCOMPLETE when a position has no quote', () => {
    // The whole reason this module exists. A partial sum is not the book's
    // day change, and the rail has to be able to tell the difference.
    const accounts = [acct(0, [{ sym: 'SPUS', qty: 10 }, { sym: 'OTCX', qty: 100 }])]
    const d = deskDayChange(accounts, { SPUS: { c: 60, pc: 59 } }, mp)
    expect(d.quoted).toBe(1)
    expect(d.total).toBe(2)
    expect(d.complete).toBe(false)
    expect(d.change).toBeCloseTo(10, 10)   // the quoted part only
  })

  it('divides the change by the QUOTED positions prior value, not the whole book', () => {
    // Using the full book as the denominator would understate the move.
    const accounts = [acct(0, [{ sym: 'SPUS', qty: 10 }, { sym: 'OTCX', qty: 1000 }])]
    const d = deskDayChange(accounts, { SPUS: { c: 60, pc: 50 } }, mp)
    expect(d.change).toBeCloseTo(100, 10)
    expect(d.changePct).toBeCloseTo(20, 10)   // 100 / (10*50), not 100 / huge
  })

  it('refuses a zero or missing previous close instead of dividing by it', () => {
    const accounts = [acct(0, [{ sym: 'A', qty: 1 }, { sym: 'B', qty: 1 }, { sym: 'C', qty: 1 }])]
    const live = { A: { c: 10, pc: 0 }, B: { c: 10 }, C: { c: 10, pc: null } }
    const d = deskDayChange(accounts, live, mp)
    expect(d.quoted).toBe(0)
    expect(d.change).toBe(0)
    expect(d.changePct).toBeNull()
    expect(Number.isFinite(d.change)).toBe(true)
  })

  it('costs one row, not the rail, when mapPosition throws', () => {
    const boom = (raw) => { if (raw.sym === 'BAD') throw new Error('malformed'); return mp(raw) }
    const accounts = [acct(0, [{ sym: 'BAD', qty: 1 }, { sym: 'SPUS', qty: 10 }])]
    const d = deskDayChange(accounts, { SPUS: { c: 60, pc: 59 } }, boom)
    expect(d.total).toBe(1)
    expect(d.change).toBeCloseTo(10, 10)
  })

  it('returns a safe zero shape on garbage input', () => {
    for (const bad of [null, undefined, 'x', 42, {}]) {
      const d = deskDayChange(bad, {}, mp)
      expect(d.change).toBe(0)
      expect(d.complete).toBe(false)
    }
    expect(deskDayChange([acct(0, [{ sym: 'A', qty: 1 }])], {}, null).total).toBe(0)
  })
})

describe('deskSummary', () => {
  it('passes the broker figure through rather than re-deriving it', () => {
    // Alpaca's own equity is more authoritative than anything we could
    // compute, and a second definition is how two numbers start disagreeing.
    const s = deskSummary({
      paper: { equity: 99999.72, cash: 99999.72, dayChange: -0.28, dayChangePct: -0.00028, accountNumber: 'PA3ME4FKSILU', source: 'user' },
      accounts: [], live: {}, mapPosition: mp,
    })
    expect(s.paper.equity).toBe(99999.72)
    expect(s.paper.change).toBe(-0.28)
    expect(s.paper.complete).toBe(true)
    expect(s.paper.shared).toBe(false)
  })

  it('flags a shared blotter, so a tester knows whose fills they are seeing', () => {
    expect(deskSummary({ paper: { source: 'shared' } }).paper.shared).toBe(true)
    expect(deskSummary({ paper: { source: 'user' } }).paper.shared).toBe(false)
  })

  it('leaves paper null while loading, without breaking the live side', () => {
    const s = deskSummary({
      paper: null,
      accounts: [acct(500, [{ sym: 'SPUS', qty: 10 }])],
      live: { SPUS: { c: 60, pc: 59 } }, mapPosition: mp,
    })
    expect(s.paper).toBeNull()
    expect(s.live.equity).toBe(500)
    expect(s.live.change).toBeCloseTo(10, 10)
  })

  it('gives a live change of null when there are no positions at all', () => {
    // Not 0. Zero means "the book did not move"; null means "there is no book".
    const s = deskSummary({ accounts: [acct(500)], live: {}, mapPosition: mp })
    expect(s.live.change).toBeNull()
    expect(s.live.equity).toBe(500)
  })
})
