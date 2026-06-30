# MĪZAN — Trade Tab: How It Works

> Instructions + technical explanation for the **Trade** tab (the MĪZAN Trading Bot
> and Quick Trade ticket). Last reviewed against code: 2026-06-25.
> Source of truth: `src/components/MizanApp.jsx` (frontend) and `lib/handlers.mjs` (backend).

---

## 1. What it is

The **Trade** tab is MĪZAN's halal trading surface. It has two jobs:

1. **Trading Bot** (the primary surface) — define rule-based strategies in plain English.
   The bot **screens a halal universe, picks the ticker, sizes the position, and prices
   it**; you choose a per-strategy execution **layer** (manual / semi / full) that decides
   only who pulls the trigger. Every signal passes a non-negotiable Sharia gate.
2. **Quick Trade** (ad-hoc override only) — place a one-off buy/sell order you type by
   hand, screened against AAOIFI Sharia rules before it reaches a broker (live via
   SnapTrade, or paper via Alpaca). Not how the bot trades — just a manual escape hatch.

It is **admin/root-only** and intentionally gated at several layers (see §3).

---

## 2. Where it lives in the UI

- Top-level nav item **"Trade"** — only rendered when the current user is admin
  (`NAV` array, `MizanApp.jsx:9935`). Hidden entirely for everyone else.
- Also reachable from the Command Palette (⌘K → "Go to Trade") and the keyboard
  shortcut **`g t`** — both registered **only when `isAdmin`**.
- The tab renders the `TradeBot` component (`MizanApp.jsx:5356`), an admin trading
  **hub** with **six sub-tabs** (`TabBar`, `MizanApp.jsx:5490`). It opens on
  **Strategies**. `TradeBot` itself returns `null` for non-admins (`:5487`).

  | Sub-tab | Renders | Role |
  |---------|---------|------|
  | **Strategies** (default) | `TradingBotPanel view="strategies"` (`:4918`) | NL builder, strategy list, layer toggle, kill switch, per-account full-auto |
  | **Signals** | `TradingBotPanel view="signals"` | Pending signals → Approve / Reject, **plus the Bot Activity timeline** (every action the bot took) |
  | **Screener** | `AAOIFIScreener` (`:2103`) | AAOIFI Sharia screen (shared with Portfolio) |
  | **Rebalance** | `Rebalancer` (`:3638`) | Drift vs target allocation (shared with Portfolio) |
  | **Backtest** | `HistoricalBacktest` (`:4821`) | Polygon-history SMA backtest |
  | **Quick Trade** | inline order form + `OrderPreviewModal` (`:4567`) | Ad-hoc manual override only (see §4) |

---

## 3. Access & permissions (the gating)

Access is enforced in **three** places — client convenience gates plus a hard
server gate that a tampered client cannot bypass.

| Layer | Where | Rule |
|------|-------|------|
| Nav visibility | `NAV` (`MizanApp.jsx:9935`) | "Trade" item only in the array if `isAdmin` |
| Non-admin lockdown | `setNav` guard (`:8935`) + bounce effect (`:9785`) + `TradeBot` returns `null` (`:5487`) | Even a forced `nav="trade"` (stale localStorage, tampering) is rewritten to `overview`; the component renders nothing for non-admins |
| Command palette / shortcut | `SHORTCUT_REFERENCE` filter (`:10240`) + palette item (`:10253`) | `g t` and "Go to Trade" only registered when `isAdmin` |
| Feature flags | `GET /api/user/features` (`handlers.mjs:1294`) | Returns `{ trading_bot, full_auto }` for the current user; sets `isAdmin` / `fullAutoEnabled` (and `featuresLoaded`) at mount |
| Server gate | `canUseTradingBot()` (`handlers.mjs:700`) | **Every** `/api/bot/*` and `/api/snaptrade/trade/*` endpoint calls it; returns `403 trading_not_enabled` otherwise |

The client gates are convenience only — to a non-admin the tab **"literally doesn't
exist."** The server gate is the real boundary: a tampered client still gets `403`.

**Who counts as admin?** `canUseTradingBot(user) === isRootUser(user)` — i.e.
`profiles.is_root = true` **OR** the `OWNER_EMAIL` env (backend) / `VITE_OWNER_EMAIL`
(frontend) fallback. The env value **wins over the DB** and requires a redeploy to
re-bind (backend caches it in an in-memory `_rootCache`, cleared on cold start). As of
2026-06-25 the sole root/owner is **akhan.industries@gmail.com**.

**Full-auto** is stricter and now **per-account**. Layer 3 executes only when ALL hold:
`strategy.mode = 'full'` **AND** `profiles.full_auto_enabled = true` (master switch)
**AND** the specific account is opted in via the `account_full_auto` table
(`accountFullAutoEnabled()`), which **defaults to false even for the owner**. Managed
through `GET/PATCH /api/bot/full-auto-accounts`. There is a compliance note in the
code: enabling full-auto for non-owner accounts likely requires RIA registration — do
not change without legal review.

### How to grant a user access

```sql
-- Trading bot (manual + semi-auto):
UPDATE profiles SET is_root = true WHERE id = (
  SELECT id FROM auth.users WHERE email = 'user@example.com'
);

-- Full-auto MASTER switch (root only):
UPDATE profiles SET full_auto_enabled = true WHERE id = (
  SELECT id FROM auth.users WHERE email = 'user@example.com'
);
```

Full-auto then ALSO requires a **per-account opt-in** (default off). Toggle it in the UI
(Trading Bot panel → "Full-Auto — Per-Account Opt-In") or directly:

```sql
INSERT INTO account_full_auto (user_id, account_id, enabled)
VALUES ('<uuid>', '<snaptrade_account_id>', true)
ON CONFLICT (user_id, account_id) DO UPDATE SET enabled = true;
```

After granting, the user must reload — `/api/user/features` is fetched once at mount.

---

## 4. The three automation layers

The **layer never changes what gets traded** — the strategy is the brain. On every
layer the bot screens the strategy's halal universe, **picks the ticker**, sizes the
position from allocated capital, and prices it. The layer only decides **who pulls the
trigger**. It is a **per-strategy** setting (stored in `params.layer`); switch it with
the inline Manual / Semi / Full selector, which opens an **acknowledgment gate** before
applying. Shown as cards in the non-admin "Coming Soon" view (`MizanApp.jsx:4865`).

| Layer | What it does | Who pulls the trigger |
|-------|--------------|------------------------|
| 🎯 **Manual** | Bot posts a ready-to-go, fully-formed signal (ticker/qty/price picked). No push, no auto. | You — tap Execute on each signal in the panel |
| 🤖 **Semi-auto** | Same bot-picked signal, delivered as a push to Approve/Reject. | You — one tap per signal |
| ⚡ **Full-auto** | The strategy signals **and** executes within your caps, stop-loss, and the Sharia gate. | Nobody — autonomous (root + master switch + **per-account opt-in**) |

> The DB `mode` column (`semi`/`full`) is derived from the layer and is the real
> full-auto safety gate. Only `layer="full"` maps to `mode="full"`, so a tampered
> client `params.layer` can never bypass the per-account opt-in.

The **Quick Trade** ticket (blank symbol/qty/limit form) is **not** how the bot
trades — it's kept only as an **ad-hoc manual override** for one-off trades you place
by hand.

---

## 5. Execution flow — WITH vs WITHOUT money in a connected brokerage

**The single most important property:** money **never** flows through MĪZAN. Every
layer ends at `executeSnapTradeOrder()` → SnapTrade `/trade/impact` → `/trade/place`,
which only *instructs the connected broker*. So the broker state — connected & funded,
connected but unfunded, or not connected — decides whether a signal ever **fills**,
while the layer only decides **who pulls the trigger**.

Signals are generated the **same way regardless of broker state.** With no broker (or
no buying power) the bot is effectively a **preview / paper surface**: it still screens,
picks, sizes, and posts signals — they just never fill.

### Shared pipeline (runs before any layer-specific step)

```
Daily cron  /api/cron/bot-signals  (0 14 * * 1-5, fail-closed: Bearer CRON_SECRET)
  │  for each ENABLED strategy:
  ├─ expire stale signals · reset daily trade counts · check max_trades_per_day
  ├─ reconstruct net position from executed signals  ──►  EXIT ENGINE
  │        stop-loss / max-drawdown hit → SELL + PAUSE   (non-negotiable)
  │        horizon expired → close out + pause
  │        target hit → take profit
  └─ if FLAT → SCREENER
           build candidates (params.universe_tickers │ HALAL_UNIVERSE_DEFAULT)
           → re-filter through Sharia gate (HARAM_TICKERS)
           → Finnhub quote each → score by day momentum
           → pick strongest name > +1.5%  → size from capital
           → INSERT one BUY row in pending_signals  (status: pending)
                                  │
                                  ▼
                 ┌─ trigger differs by LAYER ─┐
```

### Layer 1 — 🎯 Manual  (`params.layer="manual"`, DB `mode="semi"`)

```
pending_signal sits SILENTLY in Trade → Signals  (no push)
        │
        ▼  you tap "Approve / Execute"
POST /api/bot/signals/:id/approve  →  executeSnapTradeOrder()
        │
        ├─ Sharia gate (HARAM_TICKERS) ─ blocked? → rejected + audited (never fills)
        ▼
   broker state?
   ├── WITH money  (broker connected + buying power)
   │       /trade/impact → /trade/place → REAL FILL at the broker
   │       signal → executed  (+ SnapTrade trade id, audited bot.signal.executed)
   │
   └── WITHOUT money
           • no broker linked     → executeSnapTradeOrder returns broker_not_connected
           • broker but no cash    → /trade/impact rejected (insufficient buying power)
           ⇒ signal STAYS approved + error_msg, HTTP 502, NOTHING fills (preview only)
```

### Layer 2 — 🤖 Semi-auto  (`params.layer="semi"`, DB `mode="semi"`)

```
pending_signal created  →  PUSH notification "approve this trade?"
        │
        ▼  you tap Approve  (Reject → status rejected, no broker call)
POST /api/bot/signals/:id/approve  →  executeSnapTradeOrder()   [identical to Layer 1]
        │
        ▼  broker state?
   ├── WITH money     → impact → place → REAL FILL → executed + "executed" push
   └── WITHOUT money  → broker_not_connected / insufficient buying power
                        ⇒ stays approved + error_msg, 502, nothing fills
```

### Layer 3 — ⚡ Full-auto  (`params.layer="full"`, DB `mode="full"`)

Triple-gated: `mode="full"` **AND** `profiles.full_auto_enabled` **AND**
`account_full_auto` for that account (default **off**). Any gate false → the strategy
still **signals** but never **fires** (degrades to a silent Layer-1 signal).

```
the cron itself calls executeSnapTradeOrder()  — nobody taps anything
        │
        ├─ Sharia gate (re-checked at execution)
        ▼  broker state?
   ├── WITH money     → impact → place → AUTO-FILL → executed
   │                    + "auto-executed" push, audited bot.signal.auto_executed
   └── WITHOUT money  → broker_not_connected / insufficient buying power
                        ⇒ signal LEFT pending + logged (bot.signal.execute_failed),
                          NOTHING fills — safe failure, retried next cron
```

**Summary:** the layer changes *who/what triggers* (you tap · you approve a push ·
nobody). The broker state changes *whether it fills* (real fill · safe no-op). The two
are orthogonal — e.g. a Full-auto strategy on an account with no buying power generates
and "fires" signals every cron run that simply never fill until the account is funded.

---

## 6. How to use it (instructions)

### A) Ad-hoc manual order (Quick Trade — override only)
This is for a one-off trade you type by hand. Automated trades come from strategies (B).
1. Trade → **Quick Trade**.
2. Pick a venue: **Live · SnapTrade** (real broker) or **Paper · Alpaca** (sandbox, no real money).
3. Choose **Buy/Sell**, select the account, enter **Symbol**, **Quantity**, and (for limit) **Limit Price**.
4. A **Sharia pre-check** runs on the symbol. Known non-compliant tickers are blocked before the broker is ever called.
5. **SnapTrade:** click **Preview** → review the impact modal (fees, fill price, buying power) → **Confirm** to place.
   **Alpaca:** the paper order is placed directly (no preview).

### B) Create a bot strategy (Natural-Language Builder)
1. Trade → **Strategies** (admin view).
2. Pick the **EXECUTION LAYER** default (Manual / Semi / Full) the new strategy will be
   created with — this is just the starting layer; you can change it per-strategy later.
3. In **Natural Language Strategy Builder**, describe the goal, e.g.
   *"Use $500 in my E\*Trade account, momentum swing-trade on halal tech, target 20% within 4 weeks."*
4. Click **Parse Strategy**. Claude returns a structured, risk-bounded strategy:
   a **primary ticker** plus a **`universe_tickers` candidate list** the bot will screen
   and pick from (if you name a theme rather than tickers, it proposes 3–8 liquid,
   Sharia-screened names), the account resolved from the named broker, strategy type,
   entry/exit rules, position size, capital cap, profit **target**, **mandatory
   stop-loss** + **max drawdown**, and horizon. The parser **only refuses** genuinely
   non-compliant asks (margin / options / shorting / interest) — ambitious goals,
   question phrasing ("how can I double $50?"), short horizons and small capital are
   **mapped, not refused** ("double"→100% target, "triple"→200%). A refusal returns a
   `200 { error }` the UI surfaces inline instead of a blank screen. The profit target
   is a take-profit only — it never enters the trading logic.
5. **Reality-check review screen** (before activation): the parsed strategy is shown in
   plain language and **back-tested against Polygon history** — win rate, max drawdown,
   and a return distribution. A **BROKERAGE ACCOUNT** `<select>` (defaulted to the
   account resolved from your wording, else your first connected account) chooses where
   the strategy runs — if the named broker (e.g. "E\*Trade") isn't a connected SnapTrade
   account it shows a "couldn't match" hint, and if you have **no** brokerage connected
   it shows an empty state. If your target is far above what the strategy historically
   achieved (scaled to your horizon), a **mismatch warning** appears: *"Your target is
   X%; historically this achieved ~Y%."* You must tick the **risk acknowledgment**
   ("this is a TARGET, not a guarantee… could lose up to {stop/drawdown}%… not financial
   advice") **and** select an account before **Activate Strategy** unlocks
   (`disabled={!riskAck || !nlAccount}`). Stop-loss is enforced **server-side** on save —
   a strategy without one returns `400 stop_loss_required` and is never stored.

Once active, each strategy shows a **Strategy Progress** card: capital, current value,
% toward target (progress bar), days elapsed vs horizon, and trades executed.

### C) Review signals & watch the bot
- Open the **Signals** sub-tab. Pending signals appear with side, qty, suggested price,
  and an expiry. **Approve** or **Reject** each. (Manual & Semi-auto — full-auto executes
  without this step; with no funded broker, Approve returns a 502 and the signal keeps
  its `error_msg` instead of filling — see §5.)
- Below the pending list, **BOT ACTIVITY · ALL ACTIONS** is the bot's full timeline
  (`GET /api/bot/activity`, newest-first, ≤100) straight from `pending_signals` — every
  signal it generated and what became of it: BUY/SELL, **FILLED** / **PENDING** /
  **APPROVED** / **REJECTED** / **EXPIRED** / **FAILED** (status `approved` + `error_msg`),
  with side, qty, ticker, strategy label, ~price, timestamp, and the error inline on
  failures. It reads the bot's **own ledger**, so a **full-auto fill shows here the instant
  the cron runs — before** it reaches the broker-synced **Portfolio → Activity** tab (which
  depends on SnapTrade sync). This is the no-broker-needed view of what the bot did; it
  refetches after each Approve/Reject. (Closed round-trips with P&L live in the
  **Realized P&L · Closed Trades** tile under Strategies; the open position's live value
  is in **Strategy Progress**.)

### D) Manage strategies & the kill switch
- **Strategies** list: each shows the screened universe (e.g. "SPUS +4 more"), its
  current **layer** (Manual/Semi/Full), capital, target, stop. Use the inline
  **Manual / Semi / Full** selector to change the layer — it opens an **acknowledgment
  gate** explaining what that layer does before applying. **Edit**, **Pause/Resume**, or
  **Delete** per strategy.
- **Edit a strategy in place** — the **Edit** button opens a **structured, pre-filled
  modal** (no AI call). Editable: primary ticker, strategy type, screen universe
  (comma-separated tickers), brokerage account, capital, profit target, stop-loss,
  max drawdown, time horizon, max trades/day. Saving sends a `PATCH
  /api/bot/strategies/:id` with the changed fields. Previously these were create-only
  (you had to delete and recreate); now they're editable directly. Two guardrails:
  - **Stop-loss can be tightened but never removed** — the gate is enforced on **both**
    client and server. A `PATCH` with `stop_loss_pct ≤ 0` returns `400 stop_loss_required`
    (mirrors the create gate), and the modal blocks Save with the same message.
  - **Editing a live FULL-AUTO strategy re-prompts a risk acknowledgment** before Save
    unlocks, because the change takes effect on the **next automated run**. (Manual/Semi
    edits save without the extra ack.)
  - Server-side, any edit touching `params` / `universe_tickers` / `layer` does a
    **read-modify-write** of the `params` jsonb, so `layer`, `universe_tickers`, and
    entry/exit rules survive a partial edit instead of being clobbered.
- **Automation Status** tile (top) has **⏹ PAUSE ALL** — the kill switch — which pauses every strategy at once (`PATCH /api/bot/strategies/pause-all`).

---

## 7. How it works under the hood

### Frontend components (`src/components/MizanApp.jsx`)
| Component | Line | Role |
|-----------|------|------|
| `TradeBot` | 5356 | 6-sub-tab hub shell; order state, SnapTrade/Alpaca submit; `null` for non-admins |
| `TradingBotPanel` | 4918 | `view="strategies"`/`"signals"` — NL builder, signals, strategies, kill switch, per-account full-auto, brokerage `<select>`, **in-place Edit modal** (`openEdit`/`saveEdit`) |
| `LAYER_META` | 4904 | Manual/Semi/Full metadata (icon + blurb) for the layer selector & ack gate |
| `StrategyReality` | 4703 | Review screen — client-side backtest + mismatch warning |
| `StrategyProgressCard` | 4799 | Per-strategy progress toward target |
| `computeSmaBacktest` | 4666 | Shared backtest math (reused by HistoricalBacktest + StrategyReality) |
| `OrderPreviewModal` | 4567 | SnapTrade impact preview → confirm/cancel |
| `isAdmin` / `fullAutoEnabled` / `featuresLoaded` state | 8887 | Fetched from `/api/user/features` at mount; gate the nav, palette, shortcut, and bounce |

### Backend endpoints (`lib/handlers.mjs`) — all gated by `canUseTradingBot()`
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/user/features` | GET | Returns `{ trading_bot, full_auto, is_root, trading_bot_consented }` |
| `/api/bot/consent` | POST | Records the beta risk-disclosure acceptance (`profiles.trading_bot_consent_at`); required before non-root create/approve/place |
| `/api/bot/strategies` | GET / POST | List / create strategies |
| `/api/bot/strategies/:id` | PATCH / DELETE | Update (enable, layer, **full param edit** — ticker, account, type, universe, capital, target, stop, drawdown, horizon, daily cap), delete. Re-enforces the stop-loss gate (`400 stop_loss_required` on `≤0`) and read-modify-writes `params`. |
| `/api/bot/strategies/pause-all` | PATCH | Kill switch |
| `/api/bot/signals` | GET | Pending (non-expired) signals |
| `/api/bot/signals/:id/approve` | POST | Approve a signal → executes via SnapTrade |
| `/api/bot/signals/:id/reject` | POST | Reject a signal |
| `/api/bot/activity` | GET | **Bot Activity timeline** — all signals + outcomes from `pending_signals` (newest-first, ≤100); powers the BOT ACTIVITY tile |
| `/api/bot/trades` | GET | **Realized-P&L ledger** — aggregate realized + win rate + closed round-trips across all strategies (`botRealizedPnl`) |
| `/api/bot/full-auto-accounts` | GET / PATCH `/:accountId` | List / set per-account full-auto opt-in |
| `/api/bot/strategy/nl` | POST | Claude parses NL → structured strategy |
| `/api/snaptrade/trade/impact` | POST | Live order preview |
| `/api/snaptrade/trade/place` | POST | Place the previewed live order |
| `/api/alpaca/order` | POST | Paper order (Alpaca sandbox) |
| `/api/cron/bot-signals` | GET/POST | Scheduled signal generation/execution |

### The signal cron (`handlers.mjs:4770`)
- Auth: **fail-closed** via `cronUnauthorized(headers)` (`handlers.mjs:124`) — requires
  `Authorization: Bearer ${CRON_SECRET}` and returns `401` if `CRON_SECRET` is unset or
  the header doesn't match. All seven `/api/cron/*` routes share this helper (no more
  fail-open when the secret is missing).
- Schedule: `vercel.json` → `0 14 * * 1-5` (**daily 14:00 UTC, Mon–Fri**). NOTE: the
  in-code comment says "every 15 min during market hours" — that's the intended
  cadence, but Vercel's Hobby plan only allows daily crons, so the live schedule is
  once-daily. Restoring `*/15 9-16 * * 1-5` requires Vercel Pro.
- Per enabled strategy it: expires stale signals → resets daily trade counts →
  checks the daily cap (`max_trades_per_day`) → resolves the effective **layer** →
  branches on `strategy_type`:
  - **`dca` (long-term accumulation)** — its own branch BEFORE the momentum/exit
    engine. Buys whole shares of the target on a fixed cadence (`params.dca_cadence_days`,
    default 7) up to `params.dca_amount` (default = `capital_allocated`), capped by
    remaining capital exposure, and **HOLDS** — no momentum entry, **no stop/target/
    trailing exits** (you exit manually, ideally past 1yr for long-term cap-gains). It can
    add to an existing position and is never auto-sold. One attempt/day guard; the cadence
    advances only on a **real fill**, so an unfunded/closed-market account retries daily
    until the first buy lands, then accumulates on cadence. Audited `bot.dca.*`.
  - **`momentum|ma_crossover|breakout`** — reconstruct the net position → **run the exit
    engine** (below). If flat, run the **screener**: candidate set from
    `params.universe_tickers` (or `HALAL_UNIVERSE_DEFAULT`), re-filtered through the Sharia
    gate; a Finnhub quote per candidate, scored by day momentum; **picks the single
    strongest name that (a) clears the per-strategy threshold `params.entry_threshold_pct`
    (default 1.5%) AND (b) is AFFORDABLE — `floor(deployable/price) >= 1`.** The
    affordability filter is essential: without it the bot locks onto the biggest mover even
    when it's too pricey to buy (e.g. AMD @ $582 on a $100 budget) and trades nothing while
    cheaper qualifying names wait. Sizes qty from `position_size_pct` (or an even split of
    `capital_allocated`) and inserts one **buy** signal on the picked ticker. **Buys come
    only from the screener; SELLs come only from the exit engine — the bot never shorts.**
    One open position per strategy at a time.
- **Exit engine** (momentum types only; reconstructs the net position + **held ticker**,
  quotes it, then by priority): **stop-loss or max-drawdown → exit + PAUSE** (overrides
  the target, non-negotiable); **horizon expired → close + pause**; **target hit → take
  profit** (keeps running); **trailing stop** → take profit (keeps running). The trailing
  stop tracks the position high-water (`params.high_water`, updated each tick, cleared on
  close); once the peak is up ≥ `params.trail_activate_pct` (default 10%), a `params.trail_pct`
  (default 6%) pullback from the peak sells — **profit-only** (the hard stop owns the
  downside). Full-auto exits execute via SnapTrade; semi pushes "sell?"; manual stays quiet.
  Audited `bot.strategy.stopped_out` / `horizon_closed` / `target_hit` / `trailing_stop`.
- **Market hours:** the cron fires `*/15` all weekday hours, but the broker rejects market
  orders outside RTH (`impact 403: exchanges not open`) — harmless, but a market-hours gate
  (via the planned Alpaca data integration) is the clean fix.
- **Manual (Layer 1):** signal is created and waits silently in the panel — no push.
  You tap **Approve/Execute** when ready.
- **Semi-auto (Layer 2):** sends an approval push notification; the trade executes via
  SnapTrade only when you tap **Approve**.
- **Full-auto** (`mode === "full"` AND `profiles.full_auto_enabled` AND
  `accountFullAutoEnabled(user, account)`): calls `executeSnapTradeOrder()` (impact →
  place) on the connected brokerage, marks the signal executed, sends an "auto-executed"
  push. A full-mode strategy on a non-opted-in account still signals but never fires.

### Sharia gate
- Server list: `HARAM_TICKERS = {JPM, WYNN, MO, LCID, BND}` (`handlers.mjs:31`).
- Default screening set: `HALAL_UNIVERSE_DEFAULT` (Sharia-screened ETFs SPUS/HLAL/UMMA/…
  plus commonly-compliant large caps) — every candidate is still re-checked against
  `HARAM_TICKERS` before any signal (`strategyUniverse()`).
- Client precheck on the ad-hoc Quick Trade ticket uses a broader `HARAM_SNAP` set.
- Enforced server-side in **every execution path**: manual `/trade/impact`, signal
  approval, cron generation, and inside `executeSnapTradeOrder()` itself — re-checked at
  execution, not just on display. A blocked ticker is rejected and audited.

### Database tables (migrations `020_trading_bot.sql`, `021_full_auto_per_account.sql`, `023_bot_strategy_type_dca.sql`)
- `bot_strategies` — one row per strategy: ticker (the **primary**/first candidate),
  strategy_type (`momentum|ma_crossover|breakout|dca`), mode (`semi|full`, **derived from
  the layer**), capital_allocated, profit_target_pct, **stop_loss_pct**, max_drawdown_pct,
  time_horizon_days, max_trades_per_day, trades_today, enabled, account_id, user_id,
  and `params` jsonb (**`layer`** manual/semi/full, **`universe_tickers`** candidate
  array, universe, entry_rules, exit_rules, position_size_pct). RLS owner-only. The
  manual layer needed **no schema change** — it lives in `params.layer` while the
  `mode` CHECK stays `semi|full`.
- `pending_signals` — generated signals (ticker, side, qty, suggested_price, status:
  pending/approved/executed/rejected/expired, error_msg, expires_at, executed_at). RLS owner-only.
- `account_full_auto` — per-connected-account full-auto opt-in (user_id, account_id,
  enabled **default false**). RLS owner-only. The Layer-3 boundary.
- `profiles` — `is_root` (admin gate) + `full_auto_enabled` (full-auto master switch).

### Audit trail
Every meaningful action writes to `audit_log`: `bot.signal.generated`, `.approved`,
`.rejected`, `.executed`, `.auto_executed`, `.execute_failed`, `.sharia_blocked`;
`bot.strategy.target_hit`, `.stopped_out`, `.horizon_closed`, `.nl_refused`;
`bot.full_auto.account_enabled` / `.account_disabled`. Use these to monitor automation.

---

## 8. Safety & compliance rails
- **Mandatory stop-loss** — enforced **server-side on both create and edit**: `POST`
  and `PATCH /api/bot/strategies` return `400 stop_loss_required` if it's missing/≤0
  (edit can tighten it but never remove it). The NL parser also always sets one.
- **Daily trade cap** — `max_trades_per_day`, reset daily by the cron.
- **Kill switch** — Pause-all halts every strategy instantly.
- **Sharia gate** — enforced server-side at generation AND approval; cannot be bypassed by the client.
- **Explicit risk acknowledgment** — required before a strategy activates.
- **Full-auto triple-gate** — root **AND** profile master switch **AND** per-account opt-in
  (default off); flagged as RIA-sensitive in code.
- **Runtime exits cannot be disabled** — stop-loss / max-drawdown exits auto-close + pause
  the strategy, overriding the profit target.

---

## 9. Current implementation status

This is an **owner-only** feature (`is_root`). It does not exist for any other user —
it is not advertised, sold, or available to them. Because it only ever trades the
owner's own money on the owner's own connected brokerage, it is not an advisory
service. (`canUseFullAuto` still carries the RIA comment as a hard boundary against
ever extending full-auto to non-owner accounts without legal review.)

All three layers execute through **SnapTrade → the connected brokerage** (impact →
place). Money never flows through MĪZAN; it only instructs the broker.

- ✅ **Layer 1 (Manual)** — `/api/snaptrade/trade/impact` now runs a server-side
  Sharia gate and resolves the ticker to a `universal_symbol_id` before previewing;
  `/trade/place` confirms. (Previously it passed a raw ticker as the symbol id, which
  SnapTrade rejects — fixed via `resolveUniversalSymbolId()`.)
- ✅ **Layer 2 (Semi-auto)** — `POST /api/bot/signals/:id/approve` calls
  `executeSnapTradeOrder()` (impact → place). Success → `executed` with the SnapTrade
  trade id audited; failure → stays `approved` + `error_msg`, returns 502 (never
  falsely executed).
- ✅ **Layer 3 (Full-auto)** — the cron calls `executeSnapTradeOrder()` for
  `mode='full'` strategies whose owner profile has `full_auto_enabled=true`, then
  audits + push-notifies after the fact. Failures leave the signal pending + logged.
- 🔒 **Sharia gate is enforced server-side in every execution path** (manual impact,
  approve, cron) via `HARAM_TICKERS` — re-checked at execution, not just on display.
- 🧪 **Needs live validation.** SnapTrade's symbol-search contract
  (`POST /accounts/{id}/symbols`) and the impact/place round-trip can only be verified
  against a real connected brokerage during market hours. The failure mode is **safe**:
  if resolution or impact/place fails, no order is placed, nothing is marked executed,
  and the error is surfaced + audited. Validate with one small ad-hoc Quick Trade
  trade before relying on semi/full-auto.
- The screener scores candidates by day momentum (+1.5% buy threshold) — the free-tier
  Finnhub quote is the live proxy for the edge. `strategy_type` (`ma_crossover|breakout`)
  is carried through to the NL builder and the client reality-check backtest, but the
  live cron scores all types by day momentum for now; richer per-type screening is the
  next step. The screener fetches one quote per candidate (default universe ≈ 15), which
  is well within Finnhub's free 60/min for a daily, owner-only cron.

---

## 10. Quick file reference (line numbers drift — search the symbol if off)
```
Frontend  src/components/MizanApp.jsx
  4567  OrderPreviewModal
  4666  computeSmaBacktest      4703  StrategyReality      4799  StrategyProgressCard
  4904  LAYER_META
  4918  TradingBotPanel  (builder, signals, strategies, layer toggle + ack gate,
        kill switch, per-account toggles, brokerage <select> at ~5211)
  5356  TradeBot         (6-sub-tab hub; TabBar at 5490; null for non-admins at 5487)
  8853  KeyboardShortcuts ("g t" admin-only)
  9785  non-admin bounce effect    9935  NAV array (admin-only "Trade" item)

Backend   lib/handlers.mjs
  31    HARAM_TICKERS (Sharia gate list) + HALAL_UNIVERSE_DEFAULT + strategyUniverse()
  124   cronUnauthorized (fail-closed Bearer CRON_SECRET gate, shared by all crons)
  700   canUseTradingBot   707  canUseFullAuto   717  accountFullAutoEnabled
  792   resolveUniversalSymbolId   813  executeSnapTradeOrder
        botPositionFromSignals (returns held ticker)
  1294  GET /api/user/features
  1477  /api/snaptrade/trade/impact   1612  /trade/place
  3196  /api/bot/strategies*   3264  /api/bot/signals*   3340  /api/bot/full-auto-accounts*
  3366  /api/bot/strategy/nl (Claude)
  4559  /api/alpaca/order
  4770  /api/cron/bot-signals (universe screener → picks ticker → entry; + exit engine)

Migrations  020_trading_bot.sql · 021_full_auto_per_account.sql
Config      vercel.json → crons → /api/cron/bot-signals (0 14 * * 1-5)
```
