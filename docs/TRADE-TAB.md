# MĪZAN — Trade Tab: How It Works

> Instructions + technical explanation for the **Trade** tab (the MĪZAN Trading Bot
> and Order Ticket). Last reviewed against code: 2026-06-24.
> Source of truth: `src/components/MizanApp.jsx` (frontend) and `lib/handlers.mjs` (backend).

---

## 1. What it is

The **Trade** tab is MĪZAN's halal trading surface. It has two jobs:

1. **Trading Bot** (the primary surface) — define rule-based strategies in plain English.
   The bot **screens a halal universe, picks the ticker, sizes the position, and prices
   it**; you choose a per-strategy execution **layer** (manual / semi / full) that decides
   only who pulls the trigger. Every signal passes a non-negotiable Sharia gate.
2. **Manual Order** (ad-hoc override only) — place a one-off buy/sell order you type by
   hand, screened against AAOIFI Sharia rules before it reaches a broker (live via
   SnapTrade, or paper via Alpaca). Not how the bot trades — just a manual escape hatch.

It is **admin/root-only** and intentionally gated at several layers (see §3).

---

## 2. Where it lives in the UI

- Top-level nav item **"Trade"** — only rendered when the current user is admin
  (`NAV` array, `MizanApp.jsx:9771`). Hidden entirely for everyone else.
- Also reachable from the Command Palette (⌘K → "Go to Trade", admin only).
- The tab renders the `TradeBot` component (`MizanApp.jsx:5259`), which has two
  sub-tabs:
  - **Trading Bot** (default) → `TradingBotPanel` (`MizanApp.jsx:4936`)
  - **Manual Order** → inline order form + `OrderPreviewModal` (`MizanApp.jsx:4567`)

---

## 3. Access & permissions (the gating)

Access is enforced in **three** places — client convenience gates plus a hard
server gate that a tampered client cannot bypass.

| Layer | Where | Rule |
|------|-------|------|
| Nav visibility | `MizanApp.jsx:9771` | Tab only shown if `isAdmin` |
| Feature flags | `GET /api/user/features` (`handlers.mjs:1294`) | Returns `{ trading_bot, full_auto }` for the current user |
| Server gate | `canUseTradingBot()` (`handlers.mjs:700`) | **Every** `/api/bot/*` and `/api/snaptrade/trade/*` endpoint calls it; returns `403 trading_not_enabled` otherwise |

**Who counts as admin?** `canUseTradingBot(user) === isRootUser(user)` — i.e.
`profiles.is_root = true` (the first registered user, or `OWNER_EMAIL`).

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

The **Order Ticket** (blank symbol/qty/limit form) is **not** how the bot trades — it's
kept only as an **ad-hoc manual override** for one-off trades you place by hand.

---

## 5. How to use it (instructions)

### A) Ad-hoc manual order (Order Ticket — override only)
This is for a one-off trade you type by hand. Automated trades come from strategies (B).
1. Trade → **Manual Order**.
2. Pick a venue: **Live · SnapTrade** (real broker) or **Paper · Alpaca** (sandbox, no real money).
3. Choose **Buy/Sell**, select the account, enter **Symbol**, **Quantity**, and (for limit) **Limit Price**.
4. A **Sharia pre-check** runs on the symbol. Known non-compliant tickers are blocked before the broker is ever called.
5. **SnapTrade:** click **Preview** → review the impact modal (fees, fill price, buying power) → **Confirm** to place.
   **Alpaca:** the paper order is placed directly (no preview).

### B) Create a bot strategy (Natural-Language Builder)
1. Trade → **Trading Bot** (admin view).
2. In **Natural Language Strategy Builder**, describe the goal, e.g.
   *"Use $500 in my E\*Trade account, momentum swing-trade on halal tech, target 20% within 4 weeks."*
3. Click **Parse Strategy**. Claude returns a structured, risk-bounded strategy:
   a **primary ticker** plus a **`universe_tickers` candidate list** the bot will screen
   and pick from (if you name a theme rather than tickers, it proposes 3–8 liquid,
   Sharia-screened names), the account resolved from the named broker, strategy type,
   entry/exit rules, position size, capital cap, profit **target**, **mandatory
   stop-loss** + **max drawdown**, and horizon. Requests needing margin / options /
   shorting / leverage are refused outright. The profit target is a take-profit only —
   it never enters the trading logic.
4. **Reality-check review screen** (before activation): the parsed strategy is shown in
   plain language and **back-tested against Polygon history** — win rate, max drawdown,
   and a return distribution. If your target is far above what the strategy historically
   achieved (scaled to your horizon), a **mismatch warning** appears: *"Your target is
   X%; historically this achieved ~Y%."* You must tick the **risk acknowledgment**
   ("this is a TARGET, not a guarantee… could lose up to {stop/drawdown}%… not financial
   advice") before **Activate** unlocks. Stop-loss is enforced **server-side** on save —
   a strategy without one returns `400 stop_loss_required` and is never stored.

Once active, each strategy shows a **Strategy Progress** card: capital, current value,
% toward target (progress bar), days elapsed vs horizon, and trades executed.

### C) Review signals
- Pending signals appear under **Pending Signals** with side, qty, suggested price,
  and an expiry. **Approve** or **Reject** each. (Semi-auto only — full-auto executes
  without this step.)

### D) Manage strategies & the kill switch
- **Strategies** list: each shows the screened universe (e.g. "SPUS +4 more"), its
  current **layer** (Manual/Semi/Full), capital, target, stop. Use the inline
  **Manual / Semi / Full** selector to change the layer — it opens an **acknowledgment
  gate** explaining what that layer does before applying. **Pause/Resume** or **Delete** per strategy.
- **Automation Status** tile (top) has **⏹ PAUSE ALL** — the kill switch — which pauses every strategy at once (`PATCH /api/bot/strategies/pause-all`).

---

## 6. How it works under the hood

### Frontend components (`src/components/MizanApp.jsx`)
| Component | Line | Role |
|-----------|------|------|
| `TradeBot` | 5259 | Tab shell (Trading Bot / Order Ticket), order state, SnapTrade/Alpaca submit |
| `TradingBotPanel` | 4936 | Strategy builder, signals, strategies, kill switch, per-account full-auto toggles |
| `StrategyReality` | 4703 | Review screen — client-side backtest + mismatch warning |
| `StrategyProgressCard` | 4799 | Per-strategy progress toward target |
| `computeSmaBacktest` | 4666 | Shared backtest math (reused by HistoricalBacktest + StrategyReality) |
| `OrderPreviewModal` | 4567 | SnapTrade impact preview → confirm/cancel |
| `isAdmin` / `fullAutoEnabled` state | — | Fetched from `/api/user/features` at mount |

### Backend endpoints (`lib/handlers.mjs`) — all gated by `canUseTradingBot()`
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/user/features` | GET | Returns `{ trading_bot, full_auto }` |
| `/api/bot/strategies` | GET / POST | List / create strategies |
| `/api/bot/strategies/:id` | PATCH / DELETE | Update (incl. enable), delete |
| `/api/bot/strategies/pause-all` | PATCH | Kill switch |
| `/api/bot/signals` | GET | Pending (non-expired) signals |
| `/api/bot/signals/:id/approve` | POST | Approve a signal → executes via SnapTrade |
| `/api/bot/signals/:id/reject` | POST | Reject a signal |
| `/api/bot/full-auto-accounts` | GET / PATCH `/:accountId` | List / set per-account full-auto opt-in |
| `/api/bot/strategy/nl` | POST | Claude parses NL → structured strategy |
| `/api/snaptrade/trade/impact` | POST | Live order preview |
| `/api/snaptrade/trade/place` | POST | Place the previewed live order |
| `/api/alpaca/order` | POST | Paper order (Alpaca sandbox) |
| `/api/cron/bot-signals` | GET/POST | Scheduled signal generation/execution |

### The signal cron (`handlers.mjs:4770`)
- Auth: `Bearer ${CRON_SECRET}`.
- Schedule: `vercel.json` → `0 14 * * 1-5` (**daily 14:00 UTC, Mon–Fri**). NOTE: the
  in-code comment says "every 15 min during market hours" — that's the intended
  cadence, but Vercel's Hobby plan only allows daily crons, so the live schedule is
  once-daily. Restoring `*/15 9-16 * * 1-5` requires Vercel Pro.
- Per enabled strategy it: expires stale signals → resets daily trade counts →
  checks the daily cap (`max_trades_per_day`) → resolves the effective **layer** →
  reconstructs the net position → **runs the exit engine** (below). If flat, it runs
  the **screener**: builds the candidate set from `params.universe_tickers` (or the
  `HALAL_UNIVERSE_DEFAULT` set), re-filters it through the Sharia gate, fetches a Finnhub
  quote for **each** candidate, scores by day momentum, and **picks the single strongest
  name above +1.5%** — that's the "bot picks the ticker" behavior. It then sizes qty
  from `position_size_pct` (or an even split of `capital_allocated`) and inserts one
  **buy** `pending_signals` row on the picked ticker. **Buys come only from the screener;
  SELLs come only from the exit engine — the bot never shorts.** One open position per
  strategy at a time, so position accounting stays unambiguous.
- **Exit engine** (reconstructs the net position + the **held ticker** from executed
  signals, quotes that ticker, then by priority): **stop-loss or max-drawdown hit →
  exit + PAUSE the strategy** (overrides the target, non-negotiable); **horizon expired
  → close out + pause**; **target hit → take profit**. Full-auto exits execute via
  SnapTrade; semi pushes a "sell?" notification; manual stays quiet in the panel.
  Audited as `bot.strategy.stopped_out` / `horizon_closed` / `target_hit`.
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
- Client precheck on the ad-hoc Order Ticket uses a broader `HARAM_SNAP` set.
- Enforced server-side in **every execution path**: manual `/trade/impact`, signal
  approval, cron generation, and inside `executeSnapTradeOrder()` itself — re-checked at
  execution, not just on display. A blocked ticker is rejected and audited.

### Database tables (migrations `020_trading_bot.sql`, `021_full_auto_per_account.sql`)
- `bot_strategies` — one row per strategy: ticker (the **primary**/first candidate),
  strategy_type (`momentum|ma_crossover|breakout`), mode (`semi|full`, **derived from
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

## 7. Safety & compliance rails
- **Mandatory stop-loss** — enforced **server-side on save**: `POST /api/bot/strategies`
  returns `400 stop_loss_required` if it's missing/≤0. The NL parser also always sets one.
- **Daily trade cap** — `max_trades_per_day`, reset daily by the cron.
- **Kill switch** — Pause-all halts every strategy instantly.
- **Sharia gate** — enforced server-side at generation AND approval; cannot be bypassed by the client.
- **Explicit risk acknowledgment** — required before a strategy activates.
- **Full-auto triple-gate** — root **AND** profile master switch **AND** per-account opt-in
  (default off); flagged as RIA-sensitive in code.
- **Runtime exits cannot be disabled** — stop-loss / max-drawdown exits auto-close + pause
  the strategy, overriding the profit target.

---

## 8. Current implementation status

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
  and the error is surfaced + audited. Validate with one small ad-hoc Order-Ticket
  trade before relying on semi/full-auto.
- The screener scores candidates by day momentum (+1.5% buy threshold) — the free-tier
  Finnhub quote is the live proxy for the edge. `strategy_type` (`ma_crossover|breakout`)
  is carried through to the NL builder and the client reality-check backtest, but the
  live cron scores all types by day momentum for now; richer per-type screening is the
  next step. The screener fetches one quote per candidate (default universe ≈ 15), which
  is well within Finnhub's free 60/min for a daily, owner-only cron.

---

## 9. Quick file reference (line numbers drift — search the symbol if off)
```
Frontend  src/components/MizanApp.jsx
  4567  OrderPreviewModal
  4666  computeSmaBacktest      4703  StrategyReality      4799  StrategyProgressCard
  4936  LAYER_META + TradingBotPanel (builder, signals, strategies, layer toggle + ack
        gate, kill switch, per-account toggles)
  5297  TradeBot         (tab shell: Trading Bot / Manual Order, order submit/place)
  9771  NAV array        (admin-only "Trade" item)

Backend   lib/handlers.mjs
  31    HARAM_TICKERS (Sharia gate list) + HALAL_UNIVERSE_DEFAULT + strategyUniverse()
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
