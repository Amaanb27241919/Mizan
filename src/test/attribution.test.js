// Signup attribution (BACKLOG G2).
//
// The Admin ACTIVATION FUNNEL measured signups → connected → returned but had
// no idea where anyone came from, so any marketing would have been unmeasurable.
// The rules worth pinning down: first touch wins, internal navigation must never
// overwrite it, and no full referring URL is ever stored.
import { describe, it, expect } from 'vitest'
import {
  parseAttribution,
  firstTouch,
  summarizeSources,
  channelForHost,
  hostOf,
  MAX_FIELD_LEN,
} from '../lib/attribution.js'

const APP = 'app.mizan.exchange'

describe('parseAttribution — UTM tagging wins', () => {
  it('reads source, medium and campaign', () => {
    expect(parseAttribution({
      search: '?utm_source=instagram&utm_medium=social&utm_campaign=zakat-week',
      selfHost: APP,
    })).toEqual({ source: 'instagram', medium: 'social', campaign: 'zakat-week' })
  })

  it('defaults a missing medium rather than dropping the source', () => {
    expect(parseAttribution({ search: '?utm_source=newsletter', selfHost: APP }))
      .toEqual({ source: 'newsletter', medium: 'unknown', campaign: null })
  })

  it('beats the referrer when both are present', () => {
    expect(parseAttribution({
      search: '?utm_source=printed-flyer',
      referrer: 'https://www.google.com/search?q=halal+investing',
      selfHost: APP,
    }).source).toBe('printed-flyer')
  })

  it('sanitizes hostile values instead of storing them raw', () => {
    const a = parseAttribution({ search: '?utm_source=<script>alert(1)</script>', selfHost: APP })
    expect(a.source).toBe('scriptalert1script')
    expect(a.source).not.toContain('<')
  })

  it('caps absurdly long values', () => {
    const a = parseAttribution({ search: `?utm_source=${'x'.repeat(500)}`, selfHost: APP })
    expect(a.source.length).toBe(MAX_FIELD_LEN)
  })
})

describe('parseAttribution — referrer fallback', () => {
  it('classifies known social hosts', () => {
    expect(parseAttribution({ referrer: 'https://l.instagram.com/?u=x', selfHost: APP }).source).toBe('instagram')
    expect(parseAttribution({ referrer: 'https://t.co/abc', selfHost: APP }).source).toBe('x')
    expect(parseAttribution({ referrer: 'https://www.tiktok.com/@someone', selfHost: APP }).source).toBe('tiktok')
  })

  it('marks search engines as organic', () => {
    const g = parseAttribution({ referrer: 'https://www.google.co.uk/search?q=zakat', selfHost: APP })
    expect(g).toEqual({ source: 'google', medium: 'organic', campaign: null })
  })

  it('treats the marketing site as its own source, not as internal', () => {
    // The landing → app hop is exactly the boundary G6 says is unmeasured.
    const a = parseAttribution({ referrer: 'https://www.mizan.exchange/', selfHost: APP })
    expect(a).toEqual({ source: 'landing', medium: 'internal-site', campaign: null })
  })

  it('reports no referrer as direct', () => {
    expect(parseAttribution({ referrer: '', selfHost: APP }))
      .toEqual({ source: 'direct', medium: 'none', campaign: null })
  })

  it('keeps an unknown referrer host as the source', () => {
    expect(parseAttribution({ referrer: 'https://someblog.example/post', selfHost: APP }).source)
      .toBe('someblog.example')
  })
})

describe('parseAttribution — internal navigation', () => {
  it('returns null for same-host navigation so it cannot erase the real first touch', () => {
    expect(parseAttribution({ referrer: `https://${APP}/portfolio`, selfHost: APP })).toBeNull()
  })

  it('returns null for a subdomain of itself', () => {
    expect(parseAttribution({ referrer: 'https://deep.app.mizan.exchange/x', selfHost: APP })).toBeNull()
  })

  it('still honors UTM params on an internal-looking visit', () => {
    // A campaign link that happens to be clicked from inside the app is still
    // an explicit tag and should be recorded.
    expect(parseAttribution({
      search: '?utm_source=email', referrer: `https://${APP}/`, selfHost: APP,
    }).source).toBe('email')
  })
})

describe('parseAttribution — junk input', () => {
  it('never throws on malformed input', () => {
    for (const ctx of [undefined, {}, { search: '???' }, { referrer: 'not a url' }, { search: null, referrer: null }]) {
      expect(() => parseAttribution(ctx)).not.toThrow()
    }
  })
})

describe('hostOf — privacy', () => {
  it('returns only the hostname, never path or query', () => {
    expect(hostOf('https://www.google.com/search?q=personal+medical+question')).toBe('google.com')
  })

  it('returns "" for unparseable input', () => {
    expect(hostOf('nonsense')).toBe('')
    expect(hostOf('')).toBe('')
    expect(hostOf(null)).toBe('')
  })
})

describe('channelForHost', () => {
  it('folds subdomains into the parent channel', () => {
    expect(channelForHost('m.facebook.com')).toBe('facebook')
    expect(channelForHost('l.instagram.com')).toBe('instagram')
  })

  it('handles country-specific Google domains', () => {
    expect(channelForHost('google.com')).toBe('google')
    expect(channelForHost('google.co.uk')).toBe('google')
  })
})

describe('firstTouch', () => {
  const incoming = { source: 'instagram', medium: 'social', campaign: null }

  it('stores the first attribution', () => {
    expect(firstTouch(null, incoming)).toEqual(incoming)
  })

  it('never overwrites an existing one — first touch wins', () => {
    const existing = { source: 'landing', medium: 'internal-site', campaign: null }
    expect(firstTouch(existing, incoming)).toBeNull()
  })

  it('stores nothing when the visit says nothing', () => {
    expect(firstTouch(null, null)).toBeNull()
  })
})

describe('summarizeSources', () => {
  it('counts and ranks sources, largest first', () => {
    const rows = [
      { source: 'instagram' }, { source: 'instagram' }, { source: 'instagram' },
      { source: 'google' },
    ]
    const out = summarizeSources(rows, 4)
    expect(out[0]).toEqual({ source: 'instagram', count: 3, pct: 75 })
    expect(out[1]).toEqual({ source: 'google', count: 1, pct: 25 })
  })

  it('surfaces pre-existing users as unattributed instead of hiding them', () => {
    // Everyone who signed up before G2 shipped can never be attributed. Showing
    // the gap keeps the breakdown honest — otherwise it looks complete.
    const out = summarizeSources([{ source: 'instagram' }], 12)
    const unknown = out.find(r => r.source === 'unattributed')
    expect(unknown).toEqual({ source: 'unattributed', count: 11, pct: 92 })
  })

  it('omits the unattributed row when everyone is accounted for', () => {
    const out = summarizeSources([{ source: 'a' }, { source: 'b' }], 2)
    expect(out.some(r => r.source === 'unattributed')).toBe(false)
  })

  it('returns an empty list for no input rather than throwing', () => {
    expect(summarizeSources([], 0)).toEqual([])
    expect(summarizeSources(null, 0)).toEqual([])
  })
})
