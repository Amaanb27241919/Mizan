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
import { netWorthParts, netWorthTotal, hasSnapshotableData, isBrokeragePlaid } from '../lib/netWorth.js'

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

describe('isBrokeragePlaid', () => {
  it('matches investment and brokerage types only', () => {
    expect(isBrokeragePlaid({ type: 'investment' })).toBe(true)
    expect(isBrokeragePlaid({ type: 'brokerage' })).toBe(true)
    expect(isBrokeragePlaid({ type: 'depository' })).toBe(false)
    expect(isBrokeragePlaid({ type: 'credit' })).toBe(false)
    expect(isBrokeragePlaid(null)).toBe(false)
  })
})
