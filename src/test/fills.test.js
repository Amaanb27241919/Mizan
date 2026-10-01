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

  it('does NOT treat done_for_day as terminal', () => {
    // Corrected after reading the docs: done_for_day means "no further updates
    // UNTIL THE NEXT TRADING DAY". A GTC order there resumes and can fill
    // tomorrow. This module had it in TERMINAL_STATUSES for an hour, which is
    // the classic reconciliation bug — it would have closed orders that were
    // still working.
    const f = readFill({ status: 'done_for_day', filled_qty: '4' })
    expect(f.terminal).toBe(false)
    expect(f.outcome).toBe('partial')
    expect(TERMINAL_STATUSES.has('done_for_day')).toBe(false)
  })

  it('counts a partial fill as shares held even while the order works', () => {
    // A rebalancer that cannot see a partial fill buys more of what it owns.
    expect(settledQty(readFill({ status: 'partially_filled', filled_qty: '3' }))).toBe(3)
    expect(settledQty(readFill({ status: 'done_for_day', filled_qty: '4' }))).toBe(4)
  })

  it('parses Alpaca string numerics — every numeric field is a string', () => {
    // Verbatim from the OpenAPI spec: filled_qty is {"type":"string"} and
    // filled_avg_price is ["string","null"]. No numeric field is a JSON number.
    const f = readFill({ status: 'filled', filled_qty: '12.5', filled_avg_price: '101.2' })
    expect(f.filledQty).toBe(12.5)
    expect(f.avgPrice).toBe(101.2)
  })

  it('never reads `qty` — it stays null forever on a notional order', () => {
    // Spec: "Ordered quantity. If entered, notional will be null." qty is the
    // INTENT and is never back-filled with the resulting share count, so a
    // dollar-amount order reconciled on qty would always read as zero.
    const f = readFill({ status: 'filled', qty: null, notional: '500', filled_qty: '3.1446' })
    expect(f.filledQty).toBe(3.1446)
  })

  it('gives a replaced order NO verdict, and surfaces its successor', () => {
    // The row must neither claim the position (the successor may not have
    // filled) nor discard it (it may have). Resolving it to `rejected` would
    // silently lose a real holding.
    const f = readFill({ status: 'replaced', filled_qty: '0', replaced_by: 'abc-123' })
    expect(f.outcome).toBe('replaced')
    expect(f.replacedBy).toBe('abc-123')
    expect(reconcileSignal(f)).toBeNull()
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

  it('counts zero for an open order that has filled nothing', () => {
    for (const s of ['new', 'accepted', 'pending_new', 'held', 'accepted_for_bidding']) {
      expect(settledQty(readFill({ status: s, filled_qty: '0' })), s).toBe(0)
      expect(reconcileSignal(readFill({ status: s, filled_qty: '0' })), s).toBeNull()
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

  it('records a partial fill as `submitted`, never `executed`', () => {
    // Writing "executed" with 3 of 10 shares claims a position still being
    // built; writing "rejected" discards one already held; writing nothing
    // understates the book and makes a rebalancer re-buy what it owns. The
    // `submitted` status from migration 032 is the honest third answer.
    const r = reconcileSignal(readFill({ status: 'partially_filled', filled_qty: '3', filled_avg_price: '50' }))
    expect(r).toMatchObject({ status: 'submitted', qty: 3, suggested_price: 50 })
    expect(r.status).not.toBe('executed')
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
