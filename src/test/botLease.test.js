import { describe, it, expect } from 'vitest'
import {
  BOT_CLAIM_LEASE_MS,
  botClaimLeaseThresholdIso,
  isStrategyClaimable,
} from '../../lib/botLease.mjs'

// The bot-signals cron can fire twice for one tick (GitHub Actions */15 + the
// Vercel daily backstop, or a manual re-trigger). The per-strategy claim is an
// atomic compare-and-swap on bot_strategies.updated_at used as a lease. These
// tests pin the lease semantics the DB CAS relies on, without any Supabase mock.

const NOW = Date.parse('2026-07-07T15:00:00.000Z')

describe('BOT_CLAIM_LEASE_MS', () => {
  it('is 5 minutes — below the 15-min cron cadence, above a sub-minute duplicate gap', () => {
    expect(BOT_CLAIM_LEASE_MS).toBe(5 * 60 * 1000)
    expect(BOT_CLAIM_LEASE_MS).toBeLessThan(15 * 60 * 1000) // next legit tick can re-claim
    expect(BOT_CLAIM_LEASE_MS).toBeGreaterThan(60 * 1000)   // a near-simultaneous fire is deduped
  })
})

describe('botClaimLeaseThresholdIso', () => {
  it('returns now minus the lease window as ISO', () => {
    expect(botClaimLeaseThresholdIso(NOW)).toBe('2026-07-07T14:55:00.000Z')
  })

  it('honors a custom lease window', () => {
    expect(botClaimLeaseThresholdIso(NOW, 60_000)).toBe('2026-07-07T14:59:00.000Z')
  })
})

describe('isStrategyClaimable', () => {
  it('claims a strategy whose updated_at is older than the lease window', () => {
    // last touched 15 min ago (a normal prior tick) → claimable now
    const updatedAt = new Date(NOW - 15 * 60 * 1000).toISOString()
    expect(isStrategyClaimable(updatedAt, NOW)).toBe(true)
  })

  it('SKIPS a strategy claimed seconds ago by a concurrent fire (the dedupe case)', () => {
    // the winning fire just bumped updated_at to ~now → the loser must skip
    const updatedAt = new Date(NOW - 3 * 1000).toISOString()
    expect(isStrategyClaimable(updatedAt, NOW)).toBe(false)
  })

  it('is exclusive at exactly the lease boundary (strictly-older, matches .lt)', () => {
    const updatedAt = new Date(NOW - BOT_CLAIM_LEASE_MS).toISOString()
    expect(isStrategyClaimable(updatedAt, NOW)).toBe(false)
    const justOlder = new Date(NOW - BOT_CLAIM_LEASE_MS - 1).toISOString()
    expect(isStrategyClaimable(justOlder, NOW)).toBe(true)
  })

  it('skips a duplicate fire but re-claims on the next 15-min tick', () => {
    const claimedAt = new Date(NOW).toISOString()
    // duplicate fire 30s later → skip
    expect(isStrategyClaimable(claimedAt, NOW + 30 * 1000)).toBe(false)
    // next scheduled tick 15 min later → claimable again
    expect(isStrategyClaimable(claimedAt, NOW + 15 * 60 * 1000)).toBe(true)
  })

  it('treats a missing/invalid updated_at as claimable so a strategy never gets stuck', () => {
    expect(isStrategyClaimable(null, NOW)).toBe(true)
    expect(isStrategyClaimable(undefined, NOW)).toBe(true)
    expect(isStrategyClaimable('not-a-date', NOW)).toBe(true)
  })
})
