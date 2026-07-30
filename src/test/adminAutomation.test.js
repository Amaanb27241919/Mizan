// @vitest-environment node
//
// Admin-panel automation: the config/credential preflight and the activation
// state machine the Users table renders.
//
// Both exist because of outages that no test or build could have caught — the
// failures were in configuration, not code:
//   · ALERT_FROM drifted to an unverified domain and Resend 403'd every email.
//   · The Anthropic balance hit zero and the Assistant went down.
//   · CRON_SECRET was unset and the whole fail-closed cron fleet 401'd.
// These cover the pure mapping from probe result → verdict, which is where a
// misjudged health call would silently mark a broken system green.
import { describe, it, expect } from 'vitest'
import { CONFIG_CHECKS, senderDomain } from '../../lib/anomaly.mjs'
import { activationState } from '../../lib/handlers.mjs'

const check = (key) => CONFIG_CHECKS.find((c) => c.key === key)

describe('senderDomain', () => {
  it('parses a display-name form', () => {
    expect(senderDomain('MIZAN <alerts@mizan.exchange>')).toBe('mizan.exchange')
  })
  it('parses a bare address and lowercases it', () => {
    expect(senderDomain('Alerts@Mizan.Exchange')).toBe('mizan.exchange')
  })
  it('returns null for junk', () => {
    for (const v of ['', null, undefined, 'no-at-sign', 'a@b']) {
      expect(senderDomain(v)).toBeNull()
    }
  })
})

describe('config check — email sender', () => {
  const v = (probe) => check('email.sender').verdict(probe)

  it('passes a verified domain', () => {
    const r = v({ from: 'MIZAN <alerts@mizan.exchange>', domain: 'mizan.exchange', listed: true, status: 'verified' })
    expect(r.healthy).toBe(true)
    expect(r.detail).toMatch(/verified/)
  })

  // The exact 2026-07-20 regression: ALERT_FROM pointed at a domain that was
  // not on the Resend account at all, so every send 403'd.
  it('fails a domain that is not on the Resend account', () => {
    const r = v({ from: 'alerts@omni-flow.net', domain: 'omni-flow.net', listed: false, status: null })
    expect(r.healthy).toBe(false)
    expect(r.reason).toMatch(/not a domain on this Resend account/)
  })

  it('fails a domain that is listed but still pending verification', () => {
    const r = v({ from: 'alerts@mizan.exchange', domain: 'mizan.exchange', listed: true, status: 'pending' })
    expect(r.healthy).toBe(false)
    expect(r.reason).toMatch(/pending/)
  })

  it('fails when ALERT_FROM is unset', () => {
    expect(v({ from: null, domain: null }).healthy).toBe(false)
  })

  // Not being ABLE to check is not the same as being broken — don't cry wolf.
  it('stays healthy when there is no Resend key to verify against', () => {
    const r = v({ from: 'alerts@mizan.exchange', domain: 'mizan.exchange', skipped: 'RESEND_API_KEY not set, cannot verify' })
    expect(r.healthy).toBe(true)
  })

  it('fails when the Resend lookup itself errors', () => {
    const r = v({ from: 'alerts@mizan.exchange', domain: 'mizan.exchange', error: 'Resend HTTP 500' })
    expect(r.healthy).toBe(false)
  })
})

describe('config check — Anthropic', () => {
  const v = (probe) => check('anthropic.credits').verdict(probe)

  it('passes a 200', () => {
    expect(v({ present: true, status: 200 }).healthy).toBe(true)
  })

  // The 2026-07-21 outage: a perfectly valid key on an account with no credit.
  // Key presence proved nothing, which is why the probe spends a token.
  it('fails an out-of-credits 400', () => {
    const r = v({ present: true, status: 400, creditIssue: true, error: 'Your credit balance is too low' })
    expect(r.healthy).toBe(false)
    expect(r.reason).toMatch(/out of credits/)
  })

  it('fails a rejected key', () => {
    expect(v({ present: true, status: 401 }).healthy).toBe(false)
  })

  it('fails when the key is missing entirely', () => {
    expect(v({ present: false }).healthy).toBe(false)
  })

  // A 429 means the key authenticated. Flagging it would page the owner over
  // a transient burst.
  it('treats a rate-limited probe as healthy', () => {
    expect(v({ present: true, status: 429 }).healthy).toBe(true)
  })
})

describe('config check — secrets presence', () => {
  it('CRON_SECRET missing is a hard fail (every cron 401s)', () => {
    expect(check('cron.secret').verdict({ present: false }).healthy).toBe(false)
    expect(check('cron.secret').severity).toBe('critical')
  })
  it('ENCRYPTION_KEY missing is a fail', () => {
    expect(check('encryption.key').verdict({ present: false }).healthy).toBe(false)
  })
})

describe('activationState', () => {
  const NOW = new Date('2026-07-30T12:00:00Z').getTime()
  const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString()
  const user = (over = {}) => ({
    email: 'a@b.com', created_at: daysAgo(10), connected: false, suspended: false, ...over,
  })
  const state = (u, opts = {}) => activationState(u, { now: NOW, ...opts }).state

  it('marks a connected user as connected, never eligible', () => {
    expect(state(user({ connected: true }))).toBe('connected')
  })

  it('marks a lapsed, unconnected, in-window user eligible', () => {
    expect(state(user())).toBe('eligible')
  })

  it('holds off on accounts under 24h old', () => {
    expect(state(user({ created_at: daysAgo(0.5) }))).toBe('waiting')
  })

  it('skips accounts past the 45-day window', () => {
    expect(state(user({ created_at: daysAgo(60) }))).toBe('skipped')
  })

  // The guard that makes the 45-day window safe: recent sign-in means engaged,
  // and "you haven't connected anything" is the wrong message for them.
  it('skips someone who signed in this week', () => {
    expect(state(user(), { lastSignIn: daysAgo(1) })).toBe('skipped')
  })

  it('nudges once — a prior send wins over every other state', () => {
    expect(state(user(), { nudgedAt: daysAgo(3) })).toBe('sent')
  })

  it('skips suspended accounts and accounts with no email', () => {
    expect(state(user({ suspended: true }))).toBe('skipped')
    expect(state(user({ email: null }))).toBe('skipped')
  })

  it('always explains itself', () => {
    for (const u of [user(), user({ connected: true }), user({ created_at: daysAgo(60) })]) {
      expect(activationState(u, { now: NOW }).note).toBeTruthy()
    }
  })
})
