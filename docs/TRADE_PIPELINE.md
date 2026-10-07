# The Mīzan trade pipeline, as it actually exists

**Phase 1, first deliverable** of `Mizan_Trade_Lab_Revised_Proposal_and_AI_Roles.md` §24.
Written 2026-09-29 from direct code reads, with file:line for every claim so a
contractor can verify rather than trust it.

This document exists because §2 of the proposal ("Existing Mīzan Foundation")
was already wrong once: it listed "Alpaca paper trading" as working
infrastructure when the keys were absent from production and every route
returned 503. Quotes priced against an unverified inventory are wrong quotes.

---

## The finding that changes Phase 5

> **SUPERSEDED 2026-10-01 — the engine CAN reach Alpaca now.** The section below
> is kept as the record of what was true on 2026-09-29. Since then:
> `executeStrategyOrder` (`lib/handlers.mjs:1722`) routes on `params.broker` via
> `lib/trading/broker.mjs` — `alpaca_paper` → `placeAlpacaOrder`, absent or
> `snaptrade` → `executeSnapTradeOrder`. A missing broker still defaults to
> SnapTrade, so no pre-existing strategy changed venue. The rank-rebalance branch
> refuses any non-paper venue **by construction** (`if (!venue.paper)` →
> `bot.rank.live_refused`, `:8125`). Fills are reconciled by
> `lib/trading/fills.mjs` (signals land `submitted`, flip to `executed`).
>
> **Forward paper testing per §17 has started.** Strategy
> `97b5b48e-03b6-47b9-9fb5-8b05610bb1ec` (halal momentum, top 25 of 214 SPUS
> constituents, inverse-vol, weekly) fired at the 2026-10-02 open: 25 signals at
> 09:30:18 ET, all 25 Alpaca orders `filled`, $94,999.73 deployed on paper
> account `PA3ME4FKSILU`, $4,999.95 cash left — matching the $95k allocation.
>
> **2026-10-07.** Several strategies now share ONE Alpaca account, so each has
> a SLEEVE (`lib/trading/sleeve.mjs`): it spends only its own cash, capped by
> the account's real cash — the allocator budget was `capital_allocated`, which
> would have re-bought the whole book on 4× paper margin (`1537d1c`). Optional
> per-strategy filters: `earnings_filter_days`, `ai_gate` (paper only, with a
> pre-market review 08:00–09:29 ET), `cash_sweep`. Swing exits can rest at the
> broker as bracket legs (`params.broker_exits`). Experiments A–D run on a
> separate user's own $1M paper account; see CLAUDE.md §10 item 9.

**The strategy engine cannot place an Alpaca order. It has no code path to one.**

`placeAlpacaOrder` (`lib/handlers.mjs:1417`) has exactly **one** call site:
`/api/alpaca/order` (`:7354`), the manual Order Ticket. Verified mechanically:

- Alpaca references inside the `/api/cron/bot-signals` block (`:7564`–`:8100`): **0**
- Alpaca references in the signal-approval path (`:5659`–`:5760`): **0**

Every automated path — DCA (`:7771`), momentum sell (`:7828`), momentum buy
(`:8010`) and signal approval (`:5721`) — calls `executeSnapTradeOrder`
(`:1583`), which is **live money at a real broker**.

Why that matters more than it first appears: proposal §17 makes forward paper
testing the *only* valid evidence that AI research adds value, and §24's Phase 6
prices attribution against it. **Today a strategy cannot be forward-tested on
paper at all** — the engine only knows how to place live SnapTrade orders, and
the paper account is reachable only by a human clicking a ticket.

So the Alpaca work of 2026-09-19 (notional/fractional orders, the cash-not-
buying-power ceiling) currently sits on a path the bot cannot use. Connecting
the engine to a paper broker is a prerequisite for Phases 3–6, not a part of
Phase 5, and it should be priced there.

---

## Entry points

| Route | File:line | Purpose |
|---|---|---|
| `POST /api/bot/consent` | `:5393` | Risk-disclosure acceptance |
| `GET /api/bot/trades` | `:5407` | Executed fills |
| `GET /api/bot/activity` | `:5439` | Every signal + outcome |
| `GET/POST /api/bot/strategies` | `:5525` / `:5536` | Strategy CRUD |
| `GET /api/bot/signals` | `:5659` | Pending queue; approval lives here |
| `GET /api/bot/full-auto-accounts` | `:5755` | Per-account Layer-3 opt-in |
| `POST /api/bot/strategy/nl` | `:5778` | Natural-language strategy builder |
| `PUT /api/alpaca/keys` | `:7262` | Per-user paper credentials (migration 029) |
| `POST /api/alpaca/order` | `:7340` | **Only** Alpaca execution path |
| `GET /api/alpaca/orders`, `/positions` | `:7386`, `:7408` | Paper blotter |
| `GET/POST /api/cron/bot-signals` | `:7570` | The engine |

---

## Signal state machine

`pending_signals.status` ∈ `pending → approved → executed | rejected | expired`

- **manual / semi** leave the signal `pending` for human approval. DCA signals
  get a full-trading-day window (`dcaSignalExpiryIso`), not the 60-minute
  default — a weekly accumulation missed inside an hour was a real failure.
- **full** executes in the same tick and never leaves a `pending` row.
- A throw mid-execution resolves the row terminally via `inFlightSignalId`
  rather than leaving a reusable `pending` (ambiguous broker outcome).

## Gates, in the order the cron applies them

1. **Market closed** — `usMarketStatus()` (`:7594`). Returns early. A heartbeat
   is written to `cron_jobs` on *every* invocation including this one, because
   the thing monitored is "is the scheduler firing", not "did it trade".
2. **Atomic per-tick claim** — CAS on `bot_strategies.updated_at` used as a
   lease. Exactly one concurrent fire wins. This single guard closes three
   duplicate-execution races (overlapping GitHub Actions + Vercel fires);
   SnapTrade exposes no client idempotency key.
3. **Daily cap** — `trades_today >= max_trades_per_day`.
4. **Layer resolution** — `params.layer` (manual|semi|full), falling back to the
   DB `mode` column. A tampered `params.layer` cannot bypass anything: full-auto
   is gated separately.
5. **Full-auto triple gate** — `mode === "full"` **AND** master switch for the
   user **AND** per-account opt-in (`accountFullAutoEnabled`). This is the RIA
   line; it is owner-allowlist-only and must not be extended to beta users.
6. **Sharia** — `HARAM_TICKERS` blocklist, server-side, non-negotiable
   (`:1401`). Also re-checked inside basket leg selection.
7. **Session** — `validateSessionOrder` for extended hours; a market order
   outside regular hours is refused rather than queued, because Alpaca queues
   it and the user fills hours later at a price they never saw.
8. **Cash ceiling (Alpaca path only)** — order value ≤ settled cash, never
   `buying_power`. Margin is riba; see `lib/market/orders.mjs`.

## Audit trail

Twenty action types on this path, including `bot.signal.generated`,
`.approved`, `.executed`, `.rejected`, `.sharia_blocked`,
`.ambiguous_execution`, `.approve_conflict`, `bot.dca.auto_executed`,
`bot.kill_switch.activated`, `alpaca.order_placed`, `alpaca.order_blocked`.
§18 wants WHO/WHAT/WHEN/WHY/INPUT/OUTPUT/MODEL/VERSION; what exists today is
closer to WHO/WHAT/WHEN/RESULT. No model, prompt or data version is recorded
anywhere, because there is no model in the loop yet.

---

## What is NOT here

- **No AI anywhere in the execution path.** The NL strategy builder structures
  user-named tickers; it does not pick. Nothing else calls a model.
- **No Market Packet, no research committee, no consensus** (§6–§9).
- **No broker adapter.** Two bespoke executors with different signatures,
  different order vocabularies, and no shared interface (§15).
- **No execution-mode hierarchy.** Three layers (manual/semi/full), not the
  seven of §13. READ_ONLY, SHADOW and HALTED have no representation.
- **Kill switches are partial** — `bot.kill_switch.activated` exists; the
  GLOBAL/BROKER/ACCOUNT/STRATEGY/SYMBOL hierarchy of §14 does not.
- **No attribution** beyond realized P&L on closed round-trips.
- **`lib/trading/basket.mjs` is not wired to anything** — deliberately; it is
  §35's deterministic baseline, landed pure pending independent review.

## Known-stale claims to correct before pricing

1. §2 "Alpaca paper trading" — the keys were unset until 2026-09-19, and the
   engine could not reach it until 2026-10-01 (see the superseded note above).
2. §15's "Robinhood's supported agent infrastructure" — through SnapTrade,
   Robinhood is `allows_trading: false`; a `connectionType:"trade"` login
   returns 400 code 1012.
3. §20's instruction to decompose `MizanApp.jsx` contradicts CLAUDE.md §8,
   which forbids splitting it without an explicit ask. Settle this in writing.
