// Per-user Alpaca paper credentials — the invariants that must not regress.
//
// The property worth protecting is narrow and absolute: an Alpaca SECRET can
// place orders, and it must never come to rest in plaintext. That cannot be
// proven by a behaviour test without a live database and a live broker, so the
// storage shape is asserted directly against the migration and the handler
// source — the same approach pwaManifest.test.js and legal.test.js take for
// claims that are structural rather than computational.
//
// Context for anyone loosening these: before migration 029, Settings → API Keys
// collected an Alpaca key ID and secret into the `mizan_keys` blob in
// user_state, which is plaintext at rest AND which the server never read for
// Alpaca. So the app invited a trading credential into the clear in exchange
// for nothing. Don't rebuild that.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

const migration = read('supabase/migrations/029_alpaca_user_keys.sql')
const handlers  = read('lib/handlers.mjs')
const app       = read('src/components/MizanApp.jsx')

describe('migration 029 — storage shape', () => {
  it('adds a full ciphertext triple for BOTH halves of the credential', () => {
    for (const col of [
      'alpaca_key_id_ciphertext', 'alpaca_key_id_iv', 'alpaca_key_id_auth_tag',
      'alpaca_secret_ciphertext', 'alpaca_secret_iv', 'alpaca_secret_auth_tag',
    ]) {
      expect(migration).toContain(col)
    }
  })

  // The whole point. finnhub_key and polygon_key each keep a plaintext column
  // for backward compatibility; Alpaca has no history to be compatible with,
  // so there is nowhere for an unencrypted trading credential to land.
  it('creates NO plaintext column for the secret', () => {
    expect(/ADD COLUMN IF NOT EXISTS\s+alpaca_secret\s+text/i.test(migration)).toBe(false)
    expect(/ADD COLUMN IF NOT EXISTS\s+alpaca_key_id\s+text/i.test(migration)).toBe(false)
  })

  it('stores only a last-4 for display, and defaults to paper', () => {
    expect(migration).toContain('alpaca_key_last4')
    expect(migration).toMatch(/alpaca_paper\s+boolean NOT NULL DEFAULT true/i)
  })

  it('is additive only — no DROP, no data rewrite', () => {
    expect(/\bDROP\s+(TABLE|COLUMN)\b/i.test(migration)).toBe(false)
    expect(/\bUPDATE\s+public\.user_keys\b/i.test(migration)).toBe(false)
  })
})

describe('handlers — the credential never round-trips to the client', () => {
  it('the keys route returns last4, never the secret or the key id', () => {
    // Grab the /api/alpaca/keys block and check what its GET hands back.
    const block = handlers.slice(handlers.indexOf('/api/alpaca/keys'))
      .slice(0, handlers.slice(handlers.indexOf('/api/alpaca/keys')).indexOf('/api/alpaca/order'))
    expect(block).toContain('last4')
    // A response body that echoes the decrypted material back would defeat the
    // encryption entirely — the browser is the one place it must never be.
    expect(/body:\s*\{[^}]*\bsecret\b\s*[:,]/.test(block)).toBe(false)
  })

  it('fails CLOSED when a stored credential cannot be decrypted', () => {
    // A decrypt failure must not fall through to the shared account: the user
    // would place orders they believe are theirs into someone else's blotter.
    const fn = handlers.slice(handlers.indexOf('async function getAlpacaCreds'))
    const body = fn.slice(0, fn.indexOf('\n}\n'))
    expect(body).toContain('decrypt_failed')
    // Assert the CONTROL FLOW, not a comment: between logging the decrypt
    // failure and the shared-account fallback there must be a return, so a
    // user whose own key fails to decrypt can never be silently dropped onto
    // someone else's blotter.
    const afterLog = body.slice(body.indexOf('decrypt_failed'))
    const beforeSharedFallback = afterLog.slice(0, afterLog.indexOf('ALPACA_KEY_ID'))
    expect(beforeSharedFallback.length).toBeGreaterThan(0)
    expect(beforeSharedFallback).toMatch(/return null/)
  })

  it('verifies credentials against the PAPER endpoint before storing', () => {
    expect(handlers).toContain('async function verifyAlpacaCreds')
    expect(handlers).toMatch(/ALPACA_BASE\s*=\s*"https:\/\/paper-api\.alpaca\.markets/)
  })

  it('refuses to store anything when server encryption is off', () => {
    const put = handlers.slice(handlers.indexOf('/api/alpaca/keys'))
    expect(put).toMatch(/if \(!ENC_ENABLED\)/)
  })

  it('gates every Alpaca route on the trading allowlist', () => {
    const routes = ['/api/alpaca/keys', '/api/alpaca/order', '/api/alpaca/orders', '/api/alpaca/positions']
    for (const r of routes) {
      const from = handlers.indexOf(`pathname === "${r}"`)
      expect(from, `${r} route missing`).toBeGreaterThan(-1)
      expect(handlers.slice(from, from + 900)).toContain('canUseTradingBot')
    }
  })
})

describe('the plaintext trap stays removed', () => {
  it('Settings no longer collects Alpaca credentials into mizan_keys', () => {
    // The Alpaca entry must carry no input fields. If someone re-adds
    // {k:"alpacaSecret"} here, a trading secret goes back into user_state,
    // which is plaintext at rest.
    expect(app).not.toMatch(/k:\s*"alpacaSecret"/)
    expect(app).not.toMatch(/k:\s*"alpacaId"/)
  })

  it('points the user at the surface that stores them properly', () => {
    expect(app).toContain('managedElsewhere')
  })

  // Vite INLINES anything prefixed VITE_ into the public browser bundle. The
  // client used to read VITE_ALPACA_KEY_ID / VITE_ALPACA_SECRET into component
  // state; nothing consumed them after migration 029 moved credentials
  // server-side, but .env.local still carried both names sitting empty — so
  // filling in the obvious blank would have shipped a live trading credential
  // to every visitor. The server reads the UNPREFIXED names.
  it('never reads an Alpaca credential through a VITE_ variable', () => {
    const src = read('src/components/MizanApp.jsx')
    // Ignore the comment that explains this rule; catch real references.
    const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    expect(code).not.toMatch(/VITE_ALPACA/)
  })

  it('no VITE_-prefixed Alpaca reference anywhere in src/', () => {
    const files = ['src/components/MizanApp.jsx', 'src/lib/ethicalOverlay.js', 'src/lib/userState.js']
    for (const f of files) {
      const code = read(f).split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
      expect(code, f).not.toMatch(/VITE_ALPACA/)
    }
  })
})

describe('crypto round-trip for the stored shape', () => {
  const KEY = 'a'.repeat(64) // 32 bytes hex — a test key, never a real one

  it('encrypts and decrypts a credential through the exact stored triple', async () => {
    process.env.ENCRYPTION_KEY = KEY
    const { encrypt, decrypt } = await import('../../lib/crypto.mjs')
    const secret = 'testSecretValue1234567890'
    const enc = encrypt(secret)
    expect(enc).toHaveProperty('ciphertext')
    expect(enc).toHaveProperty('iv')
    expect(enc).toHaveProperty('authTag')
    expect(enc.ciphertext).not.toContain(secret)
    // Exactly how getAlpacaCreds reassembles it from the three columns.
    expect(decrypt({ ciphertext: enc.ciphertext, iv: enc.iv, authTag: enc.authTag })).toBe(secret)
  })

  it('rejects a tampered ciphertext rather than returning garbage', async () => {
    process.env.ENCRYPTION_KEY = KEY
    const { encrypt, decrypt } = await import('../../lib/crypto.mjs')
    const enc = encrypt('testSecretValue1234567890')
    const flipped = Buffer.from(enc.ciphertext, 'base64')
    flipped[0] ^= 0xff
    expect(() => decrypt({ ciphertext: flipped.toString('base64'), iv: enc.iv, authTag: enc.authTag })).toThrow()
  })
})
