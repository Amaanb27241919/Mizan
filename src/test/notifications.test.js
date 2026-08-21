// In-app notification store + detectors.
//
// Context for 2026-07-30: Mizan detected compliance flips, dividends and price
// alerts, but delivered every one of them ONLY as a browser Notification behind
// a permission check — so users who never granted permission got nothing, and
// the detection code returned before even marking dividends seen. These tests
// pin the behaviour that store and detectors are pure and permission-free.
import { describe, it, expect } from 'vitest'
import {
  makeNotification, addNotifications, unreadCount, markAllRead, markRead,
  relativeTime, shariaChangeNotifications, dividendNotifications,
  priceAlertNotifications, connectionNotifications, connectionBaseline,
  NOTIF_CAP, NOTIF_KINDS, NAV_TARGETS,
} from '../lib/notifications.js'

// MizanApp renders tabs as {nav==="overview" && …}. An unrecognised nav value
// renders nothing, so a bad target here means tapping a notification blanks the
// whole page — worth a test, since sub-tab names look plausible.
describe('nav targets', () => {
  it('every kind routes to a real top-level tab or nowhere', () => {
    for (const [kind, def] of Object.entries(NOTIF_KINDS)) {
      expect(def.nav === null || NAV_TARGETS.includes(def.nav), `${kind} -> ${def.nav}`).toBe(true)
    }
  })

  it('drops an unknown nav to null rather than trusting it', () => {
    expect(makeNotification({ id: '1', title: 't', nav: 'screener' }).nav).toBeNull()
    expect(makeNotification({ id: '2', title: 't', nav: 'portfolio' }).nav).toBe('portfolio')
  })
})

const n = (id, over = {}) => makeNotification({ id, title: `t${id}`, ...over })

describe('addNotifications', () => {
  it('adds new notifications newest-first', () => {
    const out = addNotifications(
      [n('a', { ts: '2026-07-01T00:00:00Z' })],
      [n('b', { ts: '2026-07-02T00:00:00Z' })])
    expect(out.map(x => x.id)).toEqual(['b', 'a'])
  })

  it('dedupes by id', () => {
    const out = addNotifications([n('a')], [n('a'), n('a')])
    expect(out.filter(x => x.id === 'a')).toHaveLength(1)
  })

  // A detector re-runs on every sync. If a duplicate reset `read`, the badge
  // would reappear forever and the user would learn to ignore it.
  it('does not resurrect a read notification as unread', () => {
    const existing = [{ ...n('a'), read: true }]
    const out = addNotifications(existing, [n('a')])
    expect(out[0].read).toBe(true)
    expect(unreadCount(out)).toBe(0)
  })

  it('caps the list at NOTIF_CAP, keeping the newest', () => {
    const many = Array.from({ length: NOTIF_CAP + 25 }, (_, i) =>
      n(`x${i}`, { ts: `2026-07-30T${String(i % 24).padStart(2, '0')}:00:00Z` }))
    expect(addNotifications([], many)).toHaveLength(NOTIF_CAP)
  })

  it('returns the original list unchanged when there is nothing to add', () => {
    const list = [n('a')]
    expect(addNotifications(list, [])).toBe(list)
    expect(addNotifications(list, [n('a')])).toBe(list)
  })

  it('survives null, non-array and malformed input', () => {
    expect(addNotifications(null, null)).toEqual([])
    expect(addNotifications('nope', [n('a')]).map(x => x.id)).toEqual(['a'])
    expect(addNotifications([], [null, {}, { id: '' }])).toEqual([])
  })
})

describe('read state', () => {
  it('counts unread', () => {
    expect(unreadCount([n('a'), { ...n('b'), read: true }])).toBe(1)
    expect(unreadCount(null)).toBe(0)
  })

  it('marks one and all read', () => {
    const list = [n('a'), n('b')]
    expect(unreadCount(markRead(list, 'a'))).toBe(1)
    expect(unreadCount(markAllRead(list))).toBe(0)
  })

  // Identity stability keeps React from re-rendering (and re-persisting) on
  // every open of an already-read panel.
  it('returns the same reference when nothing changes', () => {
    const list = [{ ...n('a'), read: true }]
    expect(markAllRead(list)).toBe(list)
    expect(markRead(list, 'a')).toBe(list)
    expect(markRead(list, 'missing')).toBe(list)
  })
})

describe('relativeTime', () => {
  const now = new Date('2026-07-30T12:00:00Z').getTime()
  const ago = (ms) => new Date(now - ms).toISOString()

  it.each([
    [30 * 1000, 'just now'],
    [5 * 60 * 1000, '5m ago'],
    [3 * 3600 * 1000, '3h ago'],
    [2 * 86400 * 1000, '2d ago'],
    [14 * 86400 * 1000, '2w ago'],
  ])('formats %ims as %s', (ms, expected) => {
    expect(relativeTime(ago(ms), now)).toBe(expected)
  })

  it('falls back to a date for anything older, and empties on junk', () => {
    expect(relativeTime(ago(200 * 86400 * 1000), now)).toMatch(/\d/)
    expect(relativeTime('not a date', now)).toBe('')
  })
})

describe('shariaChangeNotifications', () => {
  const base = { AAPL: { status: 'halal' }, XOM: { status: 'haram' } }

  it('fires when a holding flips to haram', () => {
    const out = shariaChangeNotifications(base, { AAPL: { status: 'haram' } })
    expect(out).toHaveLength(1)
    expect(out[0].title).toMatch(/AAPL flagged non-compliant/)
    expect(out[0].kind).toBe('sharia')
    expect(out[0].nav).toBe('portfolio')
  })

  it('fires when a holding recovers to halal', () => {
    const out = shariaChangeNotifications(base, { XOM: { status: 'halal' } })
    expect(out[0].title).toMatch(/XOM is now compliant/)
  })

  // review→halal and halal→review are noise, not events worth a badge.
  it('stays silent on unchanged verdicts and non-haram transitions', () => {
    expect(shariaChangeNotifications(base, { AAPL: { status: 'halal' } })).toEqual([])
    expect(shariaChangeNotifications(base, { AAPL: { status: 'review' } })).toEqual([])
    expect(shariaChangeNotifications({}, { AAPL: { status: 'haram' } })).toEqual([])
  })

  it('gives the same change a stable id so re-screening cannot duplicate it', () => {
    const a = shariaChangeNotifications(base, { AAPL: { status: 'haram' } }, '2026-07-30')
    const b = shariaChangeNotifications(base, { AAPL: { status: 'haram' } }, '2026-07-30')
    expect(a[0].id).toBe(b[0].id)
    expect(addNotifications(a, b)).toHaveLength(1)
  })
})

describe('dividendNotifications', () => {
  const div = (id, symbol, amount) => ({ id, symbol, amount, trade_date: '2026-07-29' })

  it('describes a dividend with ticker and amount', () => {
    const out = dividendNotifications([div('d1', 'SPUS', 12.345)])
    expect(out[0].title).toBe('SPUS dividend received')
    expect(out[0].body).toMatch(/\+\$12\.35/)
    expect(out[0].nav).toBe('portfolio')
  })

  it('handles all three SnapTrade symbol shapes', () => {
    expect(dividendNotifications([div('a', 'SPUS', 1)])[0].title).toMatch(/^SPUS/)
    expect(dividendNotifications([div('b', { symbol: 'SPWO' }, 1)])[0].title).toMatch(/^SPWO/)
    expect(dividendNotifications([div('c', { raw_symbol: 'SPSK' }, 1)])[0].title).toMatch(/^SPSK/)
  })

  it('coalesces the tail so one big sync cannot bury everything else', () => {
    const many = Array.from({ length: 9 }, (_, i) => div(`d${i}`, 'SPUS', 1))
    const out = dividendNotifications(many)
    expect(out).toHaveLength(6)
    expect(out.at(-1).title).toBe('4 more dividends received')
  })

  it('returns nothing for an empty or malformed list', () => {
    expect(dividendNotifications([])).toEqual([])
    expect(dividendNotifications(null)).toEqual([])
  })
})

describe('priceAlertNotifications', () => {
  it('describes both directions', () => {
    const [up] = priceAlertNotifications([{ symbol: 'SPUS', price: 42.5, target: 40, direction: 'above' }])
    expect(up.title).toBe('SPUS ↑ 40')
    expect(up.body).toMatch(/hit your target/)
    const [down] = priceAlertNotifications([{ symbol: 'SPUS', price: 38, target: 40, direction: 'below' }])
    expect(down.title).toBe('SPUS ↓ 40')
  })

  it('keys on symbol+direction+target so one crossing notifies once', () => {
    const c = [{ symbol: 'SPUS', price: 42.5, target: 40, direction: 'above' }]
    expect(addNotifications(priceAlertNotifications(c), priceAlertNotifications(c))).toHaveLength(1)
  })
})

// ── Partner connection changes (2026-08-21) ────────────────────────────────
// SnapTrade brokerages and Plaid banks, fed by /api/connections/health.
describe('connectionNotifications', () => {
  const snap = (id, status = 'ok', institution = 'Fidelity') =>
    ({ provider: 'snaptrade', item_id: id, institution, status })
  const plaid = (id, status = 'ok', institution = 'Chase') =>
    ({ provider: 'plaid', item_id: id, institution, status })

  // THE important one. A null baseline means "never seeded" — a user who has
  // had five accounts linked for months must not be greeted by five "connected"
  // notifications the first time this ships.
  it('says NOTHING on the first run, so existing connections are not announced', () => {
    expect(connectionNotifications(null, [snap('a'), plaid('b'), snap('c')])).toEqual([])
    expect(connectionNotifications(undefined, [snap('a')])).toEqual([])
  })

  it('announces a genuinely new connection', () => {
    const n = connectionNotifications([], [snap('a')])
    expect(n).toHaveLength(1)
    expect(n[0].title).toBe('Fidelity connected')
    expect(n[0].body).toMatch(/SnapTrade/)
    expect(n[0].meta.event).toBe('added')
  })

  it('names the right partner for each provider', () => {
    expect(connectionNotifications([], [plaid('b')])[0].body).toMatch(/Plaid/)
    expect(connectionNotifications([], [snap('a')])[0].body).toMatch(/SnapTrade/)
  })

  it('flags a working connection that starts needing re-auth', () => {
    const n = connectionNotifications([plaid('b', 'ok')], [plaid('b', 'reauth')])
    expect(n).toHaveLength(1)
    expect(n[0].title).toMatch(/needs reconnecting/)
    expect(n[0].body).toMatch(/going stale/)
  })

  it('confirms a broken connection coming back', () => {
    const n = connectionNotifications([plaid('b', 'reauth')], [plaid('b', 'ok')])
    expect(n).toHaveLength(1)
    expect(n[0].meta.event).toBe('restored')
  })

  it('notes a removed connection and why it matters', () => {
    const n = connectionNotifications([snap('a')], [])
    expect(n).toHaveLength(1)
    expect(n[0].meta.event).toBe('removed')
    expect(n[0].body).toMatch(/net worth/)
  })

  it('is silent when nothing changed', () => {
    const items = [snap('a'), plaid('b')]
    expect(connectionNotifications(items, items)).toEqual([])
  })

  // A connection that stays broken must not re-announce itself every sync —
  // only the TRANSITION is detected, never the state.
  it('does not re-fire while a connection simply stays broken', () => {
    expect(connectionNotifications([plaid('b', 'reauth')], [plaid('b', 'reauth')])).toEqual([])
  })

  it('detects several independent changes in one pass', () => {
    const before = [snap('a', 'ok'), plaid('b', 'ok'), snap('c', 'reauth')]
    const after  = [snap('a', 'reauth'), snap('c', 'ok'), plaid('d', 'ok', 'Amex')]
    const events = connectionNotifications(before, after).map(n => n.meta.event).sort()
    expect(events).toEqual(['added', 'reauth', 'removed', 'restored'])
  })

  it('routes to a real top-level tab, never a blank page', () => {
    const n = connectionNotifications([], [snap('a')])[0]
    expect(NAV_TARGETS).toContain(n.nav)
    expect(n.nav).toBe(NOTIF_KINDS.connection.nav)
  })

  it('dedupes within a day but notifies again on a later day', () => {
    const a = connectionNotifications([], [snap('a')], '2026-08-21')
    const b = connectionNotifications([], [snap('a')], '2026-08-21')
    expect(addNotifications(a, b)).toHaveLength(1)
    const c = connectionNotifications([], [snap('a')], '2026-09-04')
    expect(addNotifications(a, c)).toHaveLength(2)
  })

  it('survives junk input rather than throwing at the bell', () => {
    expect(() => connectionNotifications([], null)).not.toThrow()
    expect(() => connectionNotifications('nope', 'nope')).not.toThrow()
  })

  it('connectionBaseline keeps only the compared fields', () => {
    const b = connectionBaseline([{ ...snap('a'), last_sync_at: 'x', extra: 1 }])
    expect(b).toEqual([{ provider: 'snaptrade', item_id: 'a', institution: 'Fidelity', status: 'ok' }])
  })
})
