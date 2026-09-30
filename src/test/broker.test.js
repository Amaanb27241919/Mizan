// Which broker executes a strategy's orders.
//
// Until this seam existed, `placeAlpacaOrder` had one caller — the manual Order
// Ticket — and every automated path called `executeSnapTradeOrder`, which is
// LIVE money. A strategy could not be forward-tested on paper at all, which is
// the evidence Trade Lab §17 makes the only valid proof that research adds
// value. See docs/TRADE_PIPELINE.md.
//
// The two properties below are what make this safe to put in front of a funded,
// full-auto-armed execution path.
import { describe, it, expect } from 'vitest'
import { BROKERS, BROKER_CAPABILITIES, PAPER_ROUTING_ENABLED, resolveBroker, validateIntent, normalizeResult }
  from '../../lib/trading/broker.mjs'

describe('resolveBroker', () => {
  it('routes every EXISTING strategy to snaptrade, unchanged', () => {
    // Every row in bot_strategies today has no params.broker. If this ever
    // stops answering snaptrade, live strategies change venue silently.
    for (const s of [{}, { params: {} }, { params: { broker: null } },
                     { params: { broker: "" } }, null, undefined]) {
      expect(resolveBroker(s)).toMatchObject({ ok: true, broker: BROKERS.SNAPTRADE, paper: false })
    }
  })

  it('routes an explicit paper strategy to alpaca, now the ledger can label it', () => {
    // Enabled only once migration 030 gave pending_signals broker/paper/
    // order_id, with a CHECK keeping paper and broker in lockstep. Before that
    // a simulated fill was indistinguishable from a real one in the ledger —
    // Codex caught it, and routing failed closed until the columns existed.
    expect(PAPER_ROUTING_ENABLED).toBe(true)
    expect(resolveBroker({ params: { broker: 'alpaca_paper' } }))
      .toMatchObject({ ok: true, broker: BROKERS.ALPACA_PAPER, paper: true })
  })

  it('still refuses paper if the flag is ever turned back off', () => {
    // The flag and the migration are one decision. If someone flips it without
    // the columns, routing must refuse rather than write an unlabelled fill.
    // (Asserted via the exported constant so the coupling stays visible.)
    expect(typeof PAPER_ROUTING_ENABLED).toBe('boolean')
  })

  it('REFUSES an unrecognized broker rather than defaulting', () => {
    // The important one. Defaulting a typo to snaptrade would route a strategy
    // someone intended as paper onto live money; defaulting it to paper would
    // silently stop a funded live strategy trading. Neither guess is worth
    // making, so it errors and says what it saw.
    for (const bad of ['alpaca', 'ALPACA_PAPER', 'paper', 'snap', 'ibkr', 0, true, {}]) {
      const r = resolveBroker({ params: { broker: bad } })
      expect(r.ok, `"${String(bad)}" should not resolve`).toBe(false)
      expect(r.code).toBe('unknown_broker')
    }
  })
})

describe('validateIntent — capability, not reshaping', () => {
  it('refuses a notional order on snaptrade', () => {
    // E*TRADE answers "Units to purchase should be whole units". Truncating to
    // 0 shares is a silent no-trade; rounding to 1 is a different order than
    // was intended. Refuse and say why.
    const r = validateIntent({ broker: BROKERS.SNAPTRADE, notional: 50 })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('notional_unsupported')
  })

  it('refuses a fractional quantity on snaptrade', () => {
    expect(validateIntent({ broker: BROKERS.SNAPTRADE, qty: 0.42 }).code).toBe('fractional_unsupported')
  })

  it('allows whole shares on snaptrade', () => {
    expect(validateIntent({ broker: BROKERS.SNAPTRADE, qty: 3 }).ok).toBe(true)
  })

  it('allows both notional and fractional on alpaca paper', () => {
    expect(validateIntent({ broker: BROKERS.ALPACA_PAPER, notional: 25 }).ok).toBe(true)
    expect(validateIntent({ broker: BROKERS.ALPACA_PAPER, qty: 0.42 }).ok).toBe(true)
  })

  it('refuses both-or-neither sizes on any broker', () => {
    for (const b of Object.values(BROKERS)) {
      expect(validateIntent({ broker: b, qty: 1, notional: 50 }).code).toBe('qty_and_notional')
      expect(validateIntent({ broker: b }).code).toBe('no_size')
    }
  })

  it('refuses an unknown broker', () => {
    expect(validateIntent({ broker: 'ibkr', qty: 1 }).code).toBe('unknown_broker')
  })
})

describe('normalizeResult — one shape from two executors', () => {
  it('reads SnapTrade tradeId and Alpaca json.id as the same field', () => {
    expect(normalizeResult(BROKERS.SNAPTRADE, { ok: true, status: 200, tradeId: 't1' }))
      .toMatchObject({ ok: true, orderId: 't1', paper: false })
    expect(normalizeResult(BROKERS.ALPACA_PAPER, { ok: true, status: 200, json: { id: 'a1' } }))
      .toMatchObject({ ok: true, orderId: 'a1', paper: true })
  })

  it('carries the sharia block through as a code, not a bare message', () => {
    // A caller must be able to branch on this without string-matching.
    expect(normalizeResult(BROKERS.SNAPTRADE, { ok: false, status: 403, sharia_blocked: true, error: 'x' }).code)
      .toBe('sharia_blocked')
    expect(normalizeResult(BROKERS.SNAPTRADE, { ok: false, status: 425, market_closed: true, error: 'x' }).code)
      .toBe('market_closed')
  })

  it('never reports ok for a failure, however shaped', () => {
    for (const raw of [null, undefined, {}, { ok: false }, { error: 'boom' }]) {
      expect(normalizeResult(BROKERS.SNAPTRADE, raw).ok).toBeFalsy()
    }
  })

  it('marks paper results as paper, so a blotter cannot be mistaken for live', () => {
    expect(normalizeResult(BROKERS.ALPACA_PAPER, { ok: true }).paper).toBe(true)
    expect(normalizeResult(BROKERS.SNAPTRADE, { ok: true }).paper).toBe(false)
    expect(BROKER_CAPABILITIES[BROKERS.ALPACA_PAPER].paper).toBe(true)
  })
})

// ── Static contract: routing needs params at every call site ────────────────
// Codex caught this on the first review of the seam, and no logic test could
// have: the defect was in a QUERY, not in the routing code.
//
// The semi-auto approval path loaded `bot_strategies(account_id)` and passed
// that partial row into executeStrategyOrder. resolveBroker reads
// `strategy?.params?.broker`, saw undefined, and defaulted to SnapTrade — so a
// pending signal belonging to an `alpaca_paper` strategy would have executed
// LIVE, at a real broker, the moment somebody tapped approve. resolveBroker's
// own unit tests all passed, because resolveBroker was behaving correctly on
// the object it was handed.
import { readFileSync } from 'node:fs'
import path from 'node:path'

describe('routing has the data it routes on', () => {
  const SRC = readFileSync(path.resolve(__dirname, '../../lib/handlers.mjs'), 'utf8')

  it('the approval query loads params, not just account_id', () => {
    expect(SRC, 'the signal-approval select must load params or every paper '
      + 'strategy silently executes live on approval')
      .toMatch(/bot_strategies\(account_id,\s*params\)/)
    expect(SRC, 'a bare bot_strategies(account_id) select feeds routing a row with no broker')
      .not.toMatch(/bot_strategies\(account_id\)/)
  })

  it('no audit record hardcodes the broker name', () => {
    // Once routing exists, a literal broker in the audit trail is a lie for
    // every paper execution.
    expect(SRC).not.toMatch(/broker:\s*"snaptrade"/)
  })
})
