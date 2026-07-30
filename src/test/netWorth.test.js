// Net-worth composition — the single definition the headline, the chart's
// history snapshot, and the weekly digest all share.
//
// Regression guard for 2026-07-30: the headline summed brokerage + bank +
// manual assets while the daily snapshot summed brokerage balances only, so the
// chart drew a brokerage-only line and pinned its last point to the
// bank-inclusive headline. The entire non-brokerage balance fell into the range
// gain — every connected user's history disagreed with their own headline, from
// +$1.5k to −$9.9k.
import { describe, it, expect } from 'vitest'
import {
  netWorthParts, netWorthTotal, hasSnapshotableData, isBrokeragePlaid, mergeNetWorthHistory,
  NW_HISTORY_CAP,
} from '../lib/netWorth.js'

const acct = (balance, cash = 0) => ({ balance, cash })

describe('netWorthParts', () => {
  it('sums brokerage balances, net bank and manual assets', () => {
    const p = netWorthParts({
      accounts: [acct(20000, 1500), acct(5000)],
      bankBalance: 3000,
      manualAssetTotal: 12000,
    })
    expect(p.total).toBe(40000)
    expect(p.brokerageTot).toBe(25000)
    expect(p.cash).toBe(1500)
  })

  // The core of the bug: the snapshot's number must equal the headline's.
  it('gives the snapshot and the headline the same total for the same inputs', () => {
    const input = { accounts: [acct(31003.8)], bankBalance: 1505.59, manualAssetTotal: 0 }
    expect(netWorthTotal(input)).toBe(netWorthParts(input).total)
    expect(netWorthTotal(input)).toBeCloseTo(32509.39, 2)
  })

  // akhan.industries: $185 invested against ~$9.9k of card debt.
  it('goes negative when debt exceeds investments', () => {
    expect(netWorthTotal({ accounts: [acct(185.17)], bankBalance: -9859.16 })).toBeCloseTo(-9673.99, 2)
  })

  it('falls back to position market value when no broker account is linked', () => {
    expect(netWorthTotal({ accounts: [], equityValue: 8000 })).toBe(8000)
  })

  // A broker linked through BOTH providers reports the same balance twice.
  it('ignores Plaid investment accounts while SnapTrade is connected', () => {
    const plaidAccounts = [{ type: 'investment', current_bal: 13000 }]
    expect(netWorthTotal({ accounts: [acct(13000)], plaidAccounts })).toBe(13000)
  })

  it('counts Plaid investment accounts when SnapTrade is not connected', () => {
    const plaidAccounts = [{ type: 'investment', current_bal: 13000 }]
    expect(netWorthTotal({ accounts: [], plaidAccounts })).toBe(13000)
  })

  it('treats missing and malformed inputs as zero rather than NaN', () => {
    expect(netWorthTotal({})).toBe(0)
    expect(netWorthTotal({ accounts: [{}, { balance: null }], bankBalance: undefined })).toBe(0)
  })
})

describe('hasSnapshotableData', () => {
  it('is false during the load gap, so no $0 row is written', () => {
    expect(hasSnapshotableData({ accounts: [], plaidAccounts: [], bankBalance: 0 })).toBe(false)
    expect(hasSnapshotableData()).toBe(false)
  })

  // The old guard was `total > 0`, which silently skipped anyone underwater.
  it('is true for a user whose net worth is negative', () => {
    expect(hasSnapshotableData({ accounts: [acct(185.17)], bankBalance: -9859.16 })).toBe(true)
  })

  it('is true for a bank-only user with no brokerage', () => {
    expect(hasSnapshotableData({ accounts: [], bankBalance: 2500 })).toBe(true)
  })
})

// This runs against every user's real financial history, so it has to survive
// every shape actually sitting in user_state — not just the happy path.
describe('mergeNetWorthHistory', () => {
  const today = { date: '2026-07-30', total: 32509.39 }

  it('lets the legacy (bank-inclusive) value win on a shared date', () => {
    const canonical = [{ date: '2026-07-29', total: 31003.8, cash: 500, accounts: 2 }]
    const legacy    = [{ date: '2026-07-29', value: 32498.11 }]
    const out = mergeNetWorthHistory(canonical, legacy, today)
    expect(out.find(e => e.date === '2026-07-29').total).toBe(32498.11)
  })

  it('backfills dates only the legacy series has', () => {
    const canonical = [{ date: '2026-07-29', total: 100 }]
    const legacy    = [{ date: '2026-05-13', value: 20000 }, { date: '2026-06-01', value: 21000 }]
    const out = mergeNetWorthHistory(canonical, legacy, today)
    expect(out.map(e => e.date)).toEqual(['2026-05-13', '2026-06-01', '2026-07-29', '2026-07-30'])
  })

  it("today's fresh entry beats both series", () => {
    const out = mergeNetWorthHistory(
      [{ date: '2026-07-30', total: 1 }], [{ date: '2026-07-30', value: 2 }], today)
    expect(out.at(-1).total).toBe(32509.39)
  })

  it('is idempotent — re-merging its own output changes nothing', () => {
    const canonical = [{ date: '2026-07-28', total: 100 }]
    const legacy    = [{ date: '2026-07-27', value: 90 }]
    const once  = mergeNetWorthHistory(canonical, legacy, today)
    const twice = mergeNetWorthHistory(once, legacy, today)
    expect(twice).toEqual(once)
  })

  it('survives null, non-array and junk columns', () => {
    expect(mergeNetWorthHistory(null, undefined, today)).toEqual([today])
    expect(mergeNetWorthHistory({ not: 'an array' }, 'nope', today)).toEqual([today])
    expect(mergeNetWorthHistory([null, {}, { date: null }], [{ value: 5 }], today)).toEqual([today])
  })

  it('drops legacy entries whose amount is not a finite number', () => {
    const out = mergeNetWorthHistory([], [{ date: '2026-07-01', value: 'NaN' }, { date: '2026-07-02' }], today)
    expect(out).toEqual([today])
  })

  it('keeps a negative net worth rather than treating it as missing', () => {
    const out = mergeNetWorthHistory([], [{ date: '2026-07-29', value: -9673.99 }], today)
    expect(out[0].total).toBe(-9673.99)
  })

  it('caps at the most recent N entries', () => {
    const many = Array.from({ length: 400 }, (_, i) =>
      ({ date: `2025-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`, total: i }))
    expect(mergeNetWorthHistory(many, [], today, 365).length).toBeLessThanOrEqual(365)
  })

  // One cap, shared. When the client kept 3650 and the cron kept 365, every
  // nightly run silently trimmed a decade of history to a year.
  it('defaults to the shared retention cap, not a smaller server-side one', () => {
    expect(NW_HISTORY_CAP).toBe(3650)
    const many = Array.from({ length: 500 }, (_, i) =>
      ({ date: new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10), total: i }))
    expect(mergeNetWorthHistory(many, [], today)).toHaveLength(501)
  })

  it('returns entries sorted oldest to newest', () => {
    const out = mergeNetWorthHistory(
      [{ date: '2026-07-20', total: 3 }, { date: '2026-01-02', total: 1 }],
      [{ date: '2026-03-15', value: 2 }], today)
    expect(out.map(e => e.date)).toEqual([...out.map(e => e.date)].sort())
  })
})

// The exact 2026-07-30 incident, as a regression test. The nightly cron merged
// a user's history at 19:22 (18 -> 32 points, backfilled to May 13). A browser
// tab open since before then still held the 18-point array and wrote it back at
// 20:07, discarding two months. The client now merges against what is STORED
// rather than overwriting with its own copy, so the stale tab can only ever
// contribute its own day.
describe('stale-tab clobber (regression)', () => {
  const merged = [
    { date: '2026-05-13', total: 20000 },
    { date: '2026-06-15', total: 25000 },
    { date: '2026-07-29', total: 32498.11 },
  ]
  const staleTabLocalCopy = [{ date: '2026-07-29', total: 31003.8, cash: 500, accounts: 2 }]
  const todayFromStaleTab = { date: '2026-07-30', total: 31018.79 }

  it('keeps the backfilled history a stale tab never saw', () => {
    const out = mergeNetWorthHistory(merged, null, todayFromStaleTab, 3650)
    expect(out.map(e => e.date)).toEqual(['2026-05-13', '2026-06-15', '2026-07-29', '2026-07-30'])
    expect(out.find(e => e.date === '2026-05-13').total).toBe(20000)
  })

  it("does not let the stale tab's older points overwrite the merged ones", () => {
    // What the OLD code effectively did — write the local array wholesale.
    const clobbered = [...staleTabLocalCopy, todayFromStaleTab]
    expect(clobbered).toHaveLength(2)
    // What the new path does: today's point merged into the stored series.
    const out = mergeNetWorthHistory(merged, null, todayFromStaleTab, 3650)
    expect(out.length).toBeGreaterThan(clobbered.length)
    expect(out.find(e => e.date === '2026-07-29').total).toBe(32498.11)
  })

  it('still records the stale tab\'s own day', () => {
    const out = mergeNetWorthHistory(merged, null, todayFromStaleTab, 3650)
    expect(out.at(-1)).toEqual({ date: '2026-07-30', total: 31018.79 })
  })
})

describe('isBrokeragePlaid', () => {
  it('matches investment and brokerage types only', () => {
    expect(isBrokeragePlaid({ type: 'investment' })).toBe(true)
    expect(isBrokeragePlaid({ type: 'brokerage' })).toBe(true)
    expect(isBrokeragePlaid({ type: 'depository' })).toBe(false)
    expect(isBrokeragePlaid({ type: 'credit' })).toBe(false)
    expect(isBrokeragePlaid(null)).toBe(false)
  })
})
