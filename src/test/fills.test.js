// Did the order actually fill?
//
// The engine marked a signal `executed` the moment Alpaca answered 2xx. Alpaca
// answers 2xx on ACCEPT: a market order placed outside session hours is queued
// and fills at the next open, and a notional order can fill partially. So
// "executed" meant "we sent it" while bookFromSignals, realized P&L and the
// rebalance plan all read it as "we own it".
//
// Codex flagged this as one of two structural reasons the rank-rebalance
// branch ships disabled. A forward test whose ledger drifts from the broker
// proves nothing — and a rebalancer working from a wrong book will sell what
// it does not hold and re-buy what it already owns.
import { describe, it, expect } from 'vitest'
import { readFill, reconcileSignal, settledQty, OPEN_STATUSES, TERMINAL_STATUSES }
  from '../../lib/trading/fills.mjs'

describe('readFill', () => {
  it('does NOT call a queued order filled — the original bug', () => {
    // This is the exact shape that broke the ledger: 2xx, accepted, nothing
    // filled. Market order outside session hours.
    const f = readFill({ status: 'accepted', filled_qty: '0' })
    expect(f.outcome).toBe('open')
    expect(f.filledQty).toBe(0)
    expect(f.terminal).toBe(false)
  })

  it('reports the quantity the BROKER filled, not the one requested', () => {
    // A notional order's share count is unknowable until this moment.
    const f = readFill({ status: 'filled', filled_qty: '12.5', filled_avg_price: '101.2' })
    expect(f.filledQty).toBe(12.5)
    expect(f.avgPrice).toBe(101.2)
    expect(f.outcome).toBe('filled')
  })

  it('treats terminal-with-a-partial-fill as owning shares', () => {
    // done_for_day after a partial fill: we DO hold something, just less than
    // we asked for. The case most likely to be got wrong.
    expect(readFill({ status: 'done_for_day', filled_qty: '4' }).outcome).toBe('filled')
    expect(settledQty(readFill({ status: 'done_for_day', filled_qty: '4' }))).toBe(4)
  })

  it('distinguishes an unreadable order from a dead one', () => {
    // A network blip is not a cancellation. Conflating them would resolve rows
    // to a state the broker never reported.
    for (const bad of [null, undefined, 'nope', 42, []]) {
      const f = readFill(bad)
      expect(f.known).toBe(false)
      expect(f.outcome).toBe('unknown')
    }
  })

  it('never counts an open order as settled', () => {
    for (const s of ['new', 'accepted', 'pending_new', 'partially_filled', 'held']) {
      expect(settledQty(readFill({ status: s, filled_qty: '5' })), s).toBe(0)
    }
  })

  it('keeps the open and terminal sets disjoint', () => {
    // A status in both would make `terminal` and `open` disagree and the
    // outcome depend on evaluation order.
    for (const s of OPEN_STATUSES) expect(TERMINAL_STATUSES.has(s), s).toBe(false)
  })
})

describe('reconcileSignal — silence is a valid answer', () => {
  it('leaves a queued order ALONE rather than resolving it', () => {
    expect(reconcileSignal(readFill({ status: 'accepted', filled_qty: '0' }))).toBeNull()
  })

  it('leaves a partially filled, still-open order alone', () => {
    // Writing "executed" with 3 of 10 shares would claim a position we are
    // still building; writing "rejected" would discard one we already hold.
    expect(reconcileSignal(readFill({ status: 'partially_filled', filled_qty: '3' }))).toBeNull()
  })

  it('leaves an unreadable order alone', () => {
    expect(reconcileSignal(readFill(null))).toBeNull()
    expect(reconcileSignal(null)).toBeNull()
  })

  it('only claims a position when the broker says filled', () => {
    const r = reconcileSignal(readFill({ status: 'filled', filled_qty: '7.25', filled_avg_price: '88.4' }))
    expect(r).toMatchObject({ status: 'executed', qty: 7.25, suggested_price: 88.4 })
  })

  it('rejects a terminal order that never filled', () => {
    for (const s of ['canceled', 'expired', 'rejected']) {
      expect(reconcileSignal(readFill({ status: s, filled_qty: '0' })), s)
        .toMatchObject({ status: 'rejected', qty: 0 })
    }
  })

  it('does not invent a price when the broker gave none', () => {
    const r = reconcileSignal(readFill({ status: 'filled', filled_qty: '2' }))
    expect(r.status).toBe('executed')
    expect(r.suggested_price).toBeUndefined()
  })
})
