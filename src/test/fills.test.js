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

  it('gives a partial fill no verdict, keeping one meaning per state', () => {
    // I briefly wrote these as `submitted` with the filled quantity. Codex
    // caught why that is worse: every reader filters status = "executed", so
    // it changed nothing visible, AND it made `qty` mean "intended" on one
    // submitted row and "filled so far" on another — one column, two
    // meanings, decided by reconciliation history. A submitted row's qty is
    // always the INTENT; only `executed` carries broker truth.
    expect(reconcileSignal(readFill({ status: 'partially_filled', filled_qty: '3' }))).toBeNull()
    expect(reconcileSignal(readFill({ status: 'done_for_day', filled_qty: '4' }))).toBeNull()
  })

  it('takes executed_at from the BROKER, not from reconciliation time', () => {
    // Realized P&L sorts on executed_at. Stamping the time the cron happened
    // to run reorders history — a Friday fill reconciled on Monday would sort
    // after Monday's trades.
    const r = reconcileSignal(readFill({
      status: 'filled', filled_qty: '5', filled_avg_price: '10',
      filled_at: '2026-09-30T13:31:00Z',
    }))
    expect(r.executed_at).toBe('2026-09-30T13:31:00Z')
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

// ── Static contracts on the wiring ──────────────────────────────────────────
// These are ORDERING and QUERY properties. A logic test cannot reach them —
// which is the lesson from the broker seam, where a correct resolveBroker was
// fed a row the query never loaded a broker into.
import { readFileSync } from 'node:fs'
import path from 'node:path'

describe('Phase 0 wiring', () => {
  const SRC = readFileSync(path.resolve(__dirname, '../../lib/handlers.mjs'), 'utf8')
  // Just the reconcile function, for assertions that would otherwise match a
  // lookalike elsewhere in an 8,000-line file.
  const RECONCILE_FN = (() => {
    const i = SRC.indexOf('async function reconcileSubmittedSignals')
    expect(i, 'reconcileSubmittedSignals must exist').toBeGreaterThan(-1)
    const j = SRC.indexOf('\n}', i)
    return SRC.slice(i, j)
  })()

  it('EVERY paper execution site lands as submitted, not executed', () => {
    // Alpaca answers 2xx on ACCEPT. Counting, not presence: an earlier version
    // of this test checked that `submitted` APPEARED, which passed happily
    // while one of the five sites had been flipped back to `executed`.
    // Mutation testing caught it. There are five execution sites; all five
    // must branch the same way.
    const submitted = SRC.match(/\? \{ status: "submitted" \}/g) || []
    expect(submitted, 'all five execution sites must write submitted for paper')
      .toHaveLength(5)
    const ternaryExecuted = SRC.match(/\? \{ status: "executed"/g) || []
    expect(ternaryExecuted, 'no site may claim executed on the paper branch')
      .toHaveLength(0)
  })

  it('reconciles on BOTH cron paths, and never ahead of live strategies', () => {
    // Two competing requirements, and I got this wrong twice. Reconciliation
    // must not run FIRST — one Alpaca request per user ahead of the strategy
    // loop can starve the cron that serves a funded live account. But it also
    // cannot live only in the market-closed branch, or a 10:00 fill goes
    // unrecorded until after the close. So: once at the end of the open path,
    // once inside the closed branch.
    const calls = SRC.match(/await reconcileSubmittedSignals\(\)/g) || []
    expect(calls, 'one call per cron path').toHaveLength(2)

    const closed = SRC.indexOf('if (!market.open) {')
    const first = SRC.indexOf('await reconcileSubmittedSignals()')
    expect(first, 'must not run before the market check / strategy loop')
      .toBeGreaterThan(closed)
  })

  it('bounds the pass so it cannot run away', () => {
    // A funded live strategy shares this cron. An unbounded ledger sweep is a
    // denial of service against it.
    expect(SRC).toMatch(/RECONCILE_ROW_CAP\s*=\s*\d+/)
    expect(SRC).toMatch(/RECONCILE_USER_CAP\s*=\s*\d+/)
    expect(SRC).toMatch(/RECONCILE_MS_BUDGET\s*=/)
    expect(SRC).toMatch(/if \(Date\.now\(\) > deadline\)/)
  })

  it('does not let a submitted row live forever', () => {
    // A row stuck in `submitted` is invisible to every reader, so it silently
    // shrinks the book. If the broker no longer returns the order and it is
    // old enough that it never will, abandon it.
    expect(SRC).toMatch(/RECONCILE_ABANDON_DAYS\s*=\s*\d+/)
    expect(SRC).toMatch(/reconcile\.abandoned/)
    // Oldest first, or a backlog larger than the cap starves the stale rows
    // that most need attention. Scoped to THIS function's body: that order
    // clause appears five times in handlers.mjs, and an unscoped assertion
    // matched an unrelated query and survived mutation.
    expect(RECONCILE_FN).toMatch(/\.order\("created_at", \{ ascending: true \}\)/)
  })

  it('the reconcile query asks for status=all', () => {
    // Alpaca's /v2/orders defaults to status=open, which silently omits every
    // order that just FILLED — precisely the rows this pass exists to find.
    expect(SRC).toMatch(/status:\s*"all"/)
  })

  it('bars are fetched from the consolidated feed, not IEX', () => {
    // IEX is a MEDIAN 4.4% of consolidated volume with a per-symbol range of
    // 0.07%-21%, so the error is not a constant that calibrates out — it
    // silently reorders any volume-weighted ranking. Measured on this account:
    // MSFT 788,881 (IEX) vs 19,788,977 (SIP) for the same daily bar.
    expect(SRC).toMatch(/fetchAlpacaBars\([^)]*feed = "sip"/s)
    expect(SRC).not.toMatch(/fetchAlpacaBars\([^)]*feed = "iex"/s)
  })
})
