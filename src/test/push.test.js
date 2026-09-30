// VAPID key decoding for push subscription.
//
// Web push was never wired on the client: the server had the endpoints, the
// table, a `push` listener in sw.js and three crons calling sendPushToUser,
// but nothing ever called pushManager.subscribe(), so push_subscriptions was
// empty and every send had no recipient.
//
// This function is the classic failure point of that flow. VAPID keys are
// URL-safe base64; atob() needs standard base64 with correct padding. Get it
// wrong and subscribe() rejects with InvalidCharacterError or
// InvalidAccessError — an error whose cause is nowhere near its symptom — so
// the conversion is pure and pinned here rather than inlined at the call site.
import { describe, it, expect } from 'vitest'
import webpush from 'web-push'
import { urlBase64ToUint8Array } from '../lib/push.js'

describe('urlBase64ToUint8Array', () => {
  it('decodes a real VAPID public key to the 65 bytes web-push expects', () => {
    // The exact assertion the server-side check reports on: web-push rejects
    // anything that is not "65 bytes long when decoded".
    for (let i = 0; i < 5; i++) {
      const { publicKey } = webpush.generateVAPIDKeys()
      expect(urlBase64ToUint8Array(publicKey)).toHaveLength(65)
    }
  })

  it('translates the URL-safe alphabet back to standard base64', () => {
    // "-" -> "+" and "_" -> "/". A key containing either decodes to different
    // bytes if this is skipped, and the push service rejects the subscription.
    const withDashes = 'a-b_cd'
    const expected = atob('a+b/cd')
    const out = urlBase64ToUint8Array(withDashes)
    expect(out).toHaveLength(expected.length)
    expect([...out]).toEqual([...expected].map((c) => c.charCodeAt(0)))
  })

  it('accepts unpadded keys, and rejects a structurally impossible one', () => {
    // NOTE ON THE PADDING LINE in urlBase64ToUint8Array: it cannot be
    // mutation-tested here, and that is a property of the platform rather than
    // a gap in the test. atob() implements WHATWG "forgiving-base64 decode",
    // in which padding is OPTIONAL — removing the padding line leaves every
    // case below passing. It is kept as belt-and-braces for a value handed
    // straight to a crypto API, not because a test proves it necessary. An
    // earlier version of this test asserted the padding worked and could
    // never have failed; that is worse than not testing it.
    for (const raw of ['QQ', 'QUJD', 'QUI', 'QUJDRA']) {
      expect(() => urlBase64ToUint8Array(raw)).not.toThrow()
    }
    // length % 4 === 1 is not reachable from any valid base64 encoding, and
    // this DOES throw — a real assertion rather than a decorative one.
    expect(() => urlBase64ToUint8Array('QUJDR')).toThrow()
  })

  it('refuses an empty key rather than producing an empty array', () => {
    // An empty Uint8Array passed as applicationServerKey throws inside
    // subscribe() instead, where the message says nothing useful.
    for (const bad of ['', '   ', null, undefined]) {
      expect(() => urlBase64ToUint8Array(bad)).toThrow(/empty VAPID key/)
    }
  })

  it('returns a Uint8Array, which is what subscribe() requires', () => {
    const { publicKey } = webpush.generateVAPIDKeys()
    expect(urlBase64ToUint8Array(publicKey)).toBeInstanceOf(Uint8Array)
  })
})

// ── Flow guards ─────────────────────────────────────────────────────────────
// Each of these is a path that must fail QUIETLY and legibly rather than
// throwing inside subscribe(), because this runs behind a user clicking
// "enable notifications" and a thrown error there is a dead button.
import { vi, beforeEach, afterEach } from 'vitest'

const mockFetch = vi.fn()
vi.mock('../lib/apiFetch', () => ({
  apiFetch: (...a) => mockFetch(...a),
  recordAudit: () => {},
}))

const { subscribeToPush, pushSupported } = await import('../lib/push.js')

describe('subscribeToPush — guards', () => {
  const orig = {}
  beforeEach(() => {
    mockFetch.mockReset()
    orig.nav = globalThis.navigator
    orig.notif = globalThis.Notification
    orig.pm = globalThis.PushManager
    globalThis.PushManager = function () {}
    globalThis.Notification = { permission: 'granted' }
    Object.defineProperty(globalThis, 'navigator', {
      value: { serviceWorker: {} }, configurable: true, writable: true,
    })
  })
  afterEach(() => {
    globalThis.Notification = orig.notif
    globalThis.PushManager = orig.pm
    Object.defineProperty(globalThis, 'navigator', {
      value: orig.nav, configurable: true, writable: true,
    })
  })

  it('stops when the server says VAPID is not configured', async () => {
    // The endpoint returns {key: null} precisely so the client can stand down.
    // Calling subscribe() with an empty applicationServerKey throws instead.
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ key: null }) })
    await expect(subscribeToPush()).resolves.toMatchObject({ ok: false, reason: 'not_configured' })
    // and it must NOT have gone on to POST a subscription
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('stops when permission was not granted', async () => {
    globalThis.Notification = { permission: 'default' }
    await expect(subscribeToPush()).resolves.toMatchObject({ ok: false, reason: 'permission_not_granted' })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('stops on a browser without push support', async () => {
    delete globalThis.PushManager
    await expect(subscribeToPush()).resolves.toMatchObject({ ok: false, reason: 'unsupported' })
    expect(pushSupported()).toBe(false)
  })

  it('never throws, whatever the environment does', async () => {
    // It runs behind a button click; a rejected promise there is a dead button.
    mockFetch.mockRejectedValue(new Error('network gone'))
    await expect(subscribeToPush()).resolves.toMatchObject({ ok: false })
  })
})
