import { describe, it, expect } from 'vitest'
import { summarizePanel, failingHeld, screenSummary, dcaSummary, strategyBrief } from '../../lib/ownerBrief.mjs'

// Shapes copied from real pending_signals rows (2026-10-07).
const panelRow = (answered, failures = []) => ({
  rationale: {
    kind: 'ai_panel', panel: { asked: 3, answered, complete: answered === 3 },
    ensemble: { per_model: [
      ...(answered >= 1 ? [{ provider: 'google' }] : []),
      ...(answered >= 2 ? [{ provider: 'openrouter' }] : []),
      ...(answered >= 3 ? [{ provider: 'anthropic' }] : []),
    ] },
    failures,
  },
})
const screenOnly = { rationale: { kind: 'ai_panel', screen_only: true, sharia_verdict: 'haram' } }

describe('summarizePanel', () => {
  it('counts reviews and says which analysts answered and which failed, with the reason', () => {
    const s = summarizePanel([panelRow(3), panelRow(2, [{ provider: 'anthropic', code: 'http_400' }]), screenOnly])
    expect(s.reviewed).toBe(2)
    expect(s.complete).toBe(false)
    expect(s.screenOnly).toBe(1)
    expect(s.byProvider.anthropic).toEqual({ answered: 1, failed: 1, codes: ['http_400'] })
    expect(s.byProvider.google).toEqual({ answered: 2, failed: 0, codes: [] })
  })
  it('is complete only when every review heard from every analyst asked', () => {
    expect(summarizePanel([panelRow(3), panelRow(3)]).complete).toBe(true)
  })
  it('returns null when nothing was reviewed today — "no panel" is not "panel failed"', () => {
    expect(summarizePanel([])).toBeNull()
    expect(summarizePanel(null)).toBeNull()
  })
})

describe('failingHeld', () => {
  const v = (aaoifi) => ({ status: 'halal', byStandard: { AAOIFI: { pass: aaoifi } } })
  it('names held stocks that FAIL AAOIFI per the cached verdicts, never funds or unscreened names', () => {
    const book = { STX: 10, BAD: 5, SPSK: 100, GONE: 0, NEW: 3 }
    expect(failingHeld(book, { STX: v(true), BAD: v(false), SPSK: v(false), GONE: v(false) })).toEqual(['BAD'])
  })
  it('survives junk', () => { expect(failingHeld(null, null)).toEqual([]) })
})

describe('screenSummary', () => {
  const today = '2026-10-08'
  it('reports today\'s rebalance screen', () => {
    const s = screenSummary({ date: today, standard: 'AAOIFI', excluded: ['X'], sells: ['Y'], unverified: [], waiting: false }, today, true)
    expect(s).toEqual({ due: true, ran: true, standard: 'AAOIFI', excluded: ['X'], sells: ['Y'], unverified: [], waiting: false })
  })
  it('a stale record from another day is not today\'s result', () => {
    expect(screenSummary({ date: '2026-10-07', excluded: ['X'] }, today, true)).toEqual({ due: true, ran: false })
  })
  it('not due today says so', () => {
    expect(screenSummary(null, today, false)).toEqual({ due: false, ran: false })
  })
})

describe('dcaSummary', () => {
  it('reports waiting for funds and the last signal', () => {
    const s = dcaSummary({ dca_waiting_for_funds: '2026-10-08' }, { created_at: '2026-10-07T13:30:05Z', status: 'rejected', error_msg: 'brokerage login rejected (HTTP 401)' })
    expect(s).toEqual({ waitingForFunds: '2026-10-08', last: { date: '2026-10-07', status: 'rejected', error: 'brokerage login rejected (HTTP 401)' } })
  })
  it('survives no history', () => {
    expect(dcaSummary(null, null)).toEqual({ waitingForFunds: null, last: null })
  })
})

describe('strategyBrief', () => {
  it('carries the scoreboard numbers through untouched and labels the venue', () => {
    const b = strategyBrief({
      strategy: { id: 'a7728bbe-0000', strategy_type: 'rank_rebalance', params: { label: 'A — uncle + AI gate', ai_gate: true }, capital_allocated: 250000 },
      account: 'khanstyle02', paper: true,
      progress: { equity: 252550, return_pct: 1.02, bench_return_pct: -0.1, alpha_pct: 1.12, started_at: '2026-10-07', trades_executed: 25 },
    })
    expect(b).toMatchObject({ id: 'a7728bbe', label: 'A — uncle + AI gate', account: 'khanstyle02', venue: 'paper',
      score: { equity: 252550, returnPct: 1.02, benchReturnPct: -0.1, alphaPct: 1.12, startedAt: '2026-10-07', traded: true } })
  })
  it('an untraded strategy has no return to state', () => {
    const b = strategyBrief({ strategy: { id: 'x', strategy_type: 'dca', params: {} }, account: 'a', paper: false, progress: { trades_executed: 0, return_pct: -100 } })
    expect(b.score).toMatchObject({ traded: false, returnPct: null })
    expect(b.venue).toBe('live')
  })
})

import { shortLabel } from '../../lib/ownerBrief.mjs'
describe('shortLabel', () => {
  it('takes the first clause of a strategy description', () => {
    expect(shortLabel('Experiment A — reference (uncle) system: top 15')).toBe('Experiment A')
    expect(shortLabel('Halal momentum, top 25 of the SPUS constituent universe')).toBe('Halal momentum')
    expect(shortLabel('SHADOW research panel. Runs Anthropic + Gemini')).toBe('SHADOW research panel')
    expect(shortLabel(null)).toBe('')
  })
})

import { readFileSync } from 'node:fs'
import path from 'node:path'
describe('/api/owner/brief wiring (handlers.mjs)', () => {
  const SRC = readFileSync(path.resolve(__dirname, '../../lib/handlers.mjs'), 'utf8')
  const route = SRC.slice(SRC.indexOf('if (pathname === "/api/owner/brief"'), SRC.indexOf('if (pathname === "/api/cron/cleanup")'))
  const fn = (name) => { const i = SRC.indexOf(`function ${name}(`); return SRC.slice(i, SRC.indexOf('\n}\n', i)) }
  it('fails closed on its OWN token — never CRON_SECRET, which can fire crons', () => {
    expect(route).toMatch(/^if \(pathname === "\/api\/owner\/brief" && method === "GET"\) \{\s*if \(briefUnauthorized\(h\)\)/)
    expect(fn('briefUnauthorized')).toMatch(/if \(!BRIEF_TOKEN\) return true;/)
    expect(fn('briefUnauthorized')).toMatch(/timingSafeEqual/)
    expect(fn('briefUnauthorized')).not.toMatch(/CRON_SECRET/)
  })
  it('only reads the owner\'s strategies (root profiles + OWNER_EMAIL)', () => {
    expect(route).toMatch(/\.eq\("is_root", true\)/)
    expect(route).toMatch(/\.in\("user_id", \[\.\.\.ownerIds\]\)/)
    expect(route).toMatch(/BRIEF_EMAILS/)
  })
  it('is read-only — no inserts, updates or deletes', () => {
    expect(route).not.toMatch(/\.(insert|update|upsert|delete)\(/)
  })
  it('the rank plan records its screen BEFORE a waiting rebalance returns', () => {
    const p = fn('prepareRankPlan')
    const recorded = p.indexOf('last_screen: lastScreen')
    expect(recorded).toBeGreaterThan(-1)
    expect(recorded).toBeLessThan(p.indexOf('if (screen.waiting)'))
  })
})

describe('strategy progress keeps the venue it was seeded with', () => {
  const SRC = readFileSync(path.resolve(__dirname, '../../lib/handlers.mjs'), 'utf8')
  it('fills confirm paper; they cannot turn an unfilled paper strategy "live"', () => {
    const f = SRC.slice(SRC.indexOf('async function computeStrategyProgress('), SRC.indexOf('async function computeStrategyProgress(') + 2500)
    expect(f).toMatch(/out\.paper = out\.paper \|\| !!pos\.paper;/)
    expect(f).not.toMatch(/out\.paper = !!pos\.paper;/)
  })
})

import { groupBrief } from '../../lib/ownerBrief.mjs'
describe('groupBrief — Experiment E is two sleeves, reported as one', () => {
  const core = { id: 'c', capital: 70000, score: { equity: 71400 } }
  const swing = { id: 's', capital: 30000, score: { equity: 29700 } }
  it('sums equity and states the return on the combined capital', () => {
    expect(groupBrief('E', [core, swing])).toEqual({ name: 'E', members: ['c', 's'], capital: 100000, equity: 101100, returnPct: 1.1 })
  })
  it('a member without an equity makes the total unknown, not partial', () => {
    expect(groupBrief('E', [core, { id: 's', capital: 30000, score: { equity: null } }])).toMatchObject({ equity: null, returnPct: null })
  })
  it('survives junk', () => { expect(groupBrief('E', null)).toBeNull(); expect(groupBrief(null, [core])).toBeNull() })
})
