# MĪZAN — Trade Tab: How It Works

> Instructions + technical explanation for the **Trade** tab (the MĪZAN Trading Bot
> and Order Ticket). Last reviewed against code: 2026-06-24.
> Source of truth: `src/components/MizanApp.jsx` (frontend) and `lib/handlers.mjs` (backend).

---

## 1. What it is

The **Trade** tab is MĪZAN's halal trading surface. It has two jobs:

1. **Order Ticket** — place individual buy/sell orders, each screened against AAOIFI
   Sharia rules before it reaches a broker (live via SnapTrade, or paper via Alpaca).
2. **Trading Bot** — define rule-based strategies in plain English, let the system
   generate buy/sell **signals**, and either approve them yourself (semi-auto) or let
   them run (full-auto). Every signal passes a non-negotiable Sharia gate.

It is **admin/root-only** and intentionally gated at several layers (see §3).

---

## 2. Where it lives in the UI

- Top-level nav item **"Trade"** — only rendered when the current user is admin
  (`NAV` array, `MizanApp.jsx:9539`). Hidden entirely for everyone else.
- Also reachable from the Command Palette (⌘K → "Go to Trade", admin only).
- The tab renders the `TradeBot` component (`MizanApp.jsx:5027`), which has two
  sub-tabs (`TabBar`, `MizanApp.jsx:5150`):
  - **Trading Bot** (default) → `TradingBotPanel` (`MizanApp.jsx:4770`)
  - **Order Ticket** → inline order form + `OrderPreviewModal` (`MizanApp.jsx:4567`)

---

## 3. Access & permissions (the gating)

Access is enforced in **three** places — client convenience gates plus a hard
server gate that a tampered client cannot bypass.

| Layer | Where | Rule |
|------|-------|------|
| Nav visibility | `MizanApp.jsx:9539` | Tab only shown if `isAdmin` |
| Feature flags | `GET /api/user/features` (`handlers.mjs:1089`) | Returns `{ trading_bot, full_auto }` for the current user |
| Server gate | `canUseTradingBot()` (`handlers.mjs:700`) | **Every** `/api/bot/*` and `/api/snaptrade/trade/*` endpoint calls it; returns `403 trading_not_enabled` otherwise |

**Who counts as admin?** `canUseTradingBot(user) === isRootUser(user)` — i.e.
`profiles.is_root = true` (the first registered user, or `OWNER_EMAIL`).

**Full-auto** is stricter: `canUseFullAuto()` (`handlers.mjs:707`) requires **root
AND** `profiles.full_auto_enabled = true`. There is a compliance note in the code:
enabling full-auto for non-owner accounts likely requires RIA registration — do not
change without legal review.

### How to grant a user access

```sql
-- Trading bot (manual + semi-auto):
UPDATE profiles SET is_root = true WHERE id = (
  SELECT id FROM auth.users WHERE email = 'user@example.com'
);

-- Full-auto execution (root only, explicit opt-in):
UPDATE profiles SET full_auto_enabled = true WHERE id = (
  SELECT id FROM auth.users WHERE email = 'user@example.com'
);
```

After this, the user must reload — `/api/user/features` is fetched once at mount
(`MizanApp.jsx:9386`).

---

## 4. The three automation layers

Shown as cards in the non-admin "Coming Soon" view (`MizanApp.jsx:4865`); the real
controls appear in the admin view.

| Layer | What it does | Who approves the trade |
|-------|--------------|------------------------|
| 🎯 **Manual** | You fill the Order Ticket. Sharia precheck → impact preview → one-tap confirm. | You, every time |
| 🤖 **Semi-auto** | A strategy generates signals; you get a push notification and Approve/Reject each one. | You, per signal |
| ⚡ **Full-auto** | The strategy signals **and** executes within your caps, stop-loss, and the Sharia gate. | Nobody — autonomous (root + `full_auto_enabled` only) |

---

## 5. How to use it (instructions)

### A) Place a manual order (Order Ticket)
1. Trade → **Order Ticket**.
2. Pick a venue: **Live · SnapTrade** (real broker) or **Paper · Alpaca** (sandbox, no real money).
3. Choose **Buy/Sell**, select the account, enter **Symbol**, **Quantity**, and (for limit) **Limit Price**.
4. A **Sharia pre-check** runs on the symbol. Known non-compliant tickers are blocked before the broker is ever called.
5. **SnapTrade:** click **Preview** → review the impact modal (fees, fill price, buying power) → **Confirm** to place.
   **Alpaca:** the paper order is placed directly (no preview).

### B) Create a bot strategy (Natural-Language Builder)
1. Trade → **Trading Bot** (admin view).
2. In **Natural Language Strategy Builder**, describe the goal, e.g.
   *"Use $500 in my E\*Trade account, momentum swing-trade on SPUS, target 20% within 4 weeks."*
3. Click **Parse Strategy**. Claude converts it into a structured, risk-bounded
   strategy: ticker, strategy type, capital, profit target, **mandatory stop-loss**
   (defaults to 15% if unspecified), and time horizon.
4. Review the parsed strategy + risk disclosure, tick the **risk acknowledgment**
   ("this is a TARGET, not a guarantee…"), then **Activate Strategy**.

### C) Review signals
- Pending signals appear under **Pending Signals** with side, qty, suggested price,
  and an expiry. **Approve** or **Reject** each. (Semi-auto only — full-auto executes
  without this step.)

### D) Manage strategies & the kill switch
- **Strategies** list: each shows mode (semi/full), capital, target, stop. **Pause/Resume** or **Delete** per strategy.
- **Automation Status** tile (top) has **⏹ PAUSE ALL** — the kill switch — which pauses every strategy at once (`PATCH /api/bot/strategies/pause-all`).

---

## 6. How it works under the hood

### Frontend components (`src/components/MizanApp.jsx`)
| Component | Line | Role |
|-----------|------|------|
| `TradeBot` | 5027 | Tab shell (Trading Bot / Order Ticket), order state, SnapTrade/Alpaca submit |
| `TradingBotPanel` | 4770 | Strategy builder, signals, strategy list, kill switch |
| `OrderPreviewModal` | 4567 | SnapTrade impact preview → confirm/cancel |
| `isAdmin` / `fullAutoEnabled` state | 8539–8540 | Fetched from `/api/user/features` at mount (9386) |

### Backend endpoints (`lib/handlers.mjs`) — all gated by `canUseTradingBot()`
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/user/features` | GET | Returns `{ trading_bot, full_auto }` |
| `/api/bot/strategies` | GET / POST | List / create strategies |
| `/api/bot/strategies/:id` | PATCH / DELETE | Update (incl. enable), delete |
| `/api/bot/strategies/pause-all` | PATCH | Kill switch |
| `/api/bot/signals` | GET | Pending (non-expired) signals |
| `/api/bot/signals/:id/approve` | POST | Approve a signal |
| `/api/bot/signals/:id/reject` | POST | Reject a signal |
| `/api/bot/strategy/nl` | POST | Claude parses NL → structured strategy |
| `/api/snaptrade/trade/impact` | POST | Live order preview |
| `/api/snaptrade/trade/place` | POST | Place the previewed live order |
| `/api/alpaca/order` | POST | Paper order (Alpaca sandbox) |
| `/api/cron/bot-signals` | GET/POST | Scheduled signal generation/execution |

### The signal cron (`handlers.mjs:4492`)
- Auth: `Bearer ${CRON_SECRET}`.
- Schedule: `vercel.json` → `0 14 * * 1-5` (**daily 14:00 UTC, Mon–Fri**). NOTE: the
  in-code comment says "every 15 min during market hours" — that's the intended
  cadence, but Vercel's Hobby plan only allows daily crons, so the live schedule is
  once-daily. Restoring `*/15 9-16 * * 1-5` requires Vercel Pro.
- Per enabled strategy it: expires stale signals → resets daily trade counts →
  checks the daily cap (`max_trades_per_day`) → **Sharia gate** → fetches a Finnhub
  quote → applies a simple momentum rule (day change ≥ +1.5% → buy, ≤ −1.5% → sell)
  → sizes qty from `capital_allocated` → inserts a `pending_signals` row.
- **Semi-auto:** sends an approval push notification; the trade executes via SnapTrade
  only when you tap **Approve**.
- **Full-auto** (`strat.mode === "full"` AND profile `full_auto_enabled`): calls
  `executeSnapTradeOrder()` (impact → place) to execute on the connected brokerage,
  then marks the signal executed and sends an "auto-executed" push.

### Sharia gate
- Server list: `HARAM_TICKERS = {JPM, WYNN, MO, LCID, BND}` (`handlers.mjs:31`).
- Client precheck on the Order Ticket uses a broader `HARAM_SNAP` set.
- Enforced at **three** points: manual order submit (client), signal approval
  (server, `handlers.mjs:3072`), and cron signal generation (server, `:4538`).
  A blocked ticker is rejected and audited (`bot.signal.sharia_blocked`).

### Database tables
- `bot_strategies` — one row per strategy (ticker, mode, capital, targets, stop-loss,
  `max_trades_per_day`, `trades_today`, `enabled`, `account_id`, `user_id`).
- `pending_signals` — generated signals (ticker, side, qty, suggested_price, status:
  pending/approved/executed/rejected/expired, expires_at).
- `profiles` — `is_root`, `full_auto_enabled` drive all gating.

### Audit trail
Every meaningful action writes to `audit_log`: `bot.signal.generated`,
`bot.signal.approved`, `bot.signal.rejected`, `bot.signal.auto_executed`,
`bot.signal.sharia_blocked`. Use these to monitor automation.

---

## 7. Safety & compliance rails
- **Mandatory stop-loss** — the NL parser refuses a strategy without one (defaults to 15%).
- **Daily trade cap** — `max_trades_per_day`, reset daily by the cron.
- **Kill switch** — Pause-all halts every strategy instantly.
- **Sharia gate** — enforced server-side at generation AND approval; cannot be bypassed by the client.
- **Explicit risk acknowledgment** — required before a strategy activates.
- **Full-auto double-gate** — root AND per-profile opt-in; flagged as RIA-sensitive in code.

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
  and the error is surfaced + audited. Validate with one small manual Order-Ticket
  trade before relying on semi/full-auto.
- The momentum rule is intentionally simple (±1.5% day change). It's a scaffold for
  the Backtester's MA-crossover / breakout strategy types.

---

## 9. Quick file reference
```
Frontend  src/components/MizanApp.jsx
  4567  OrderPreviewModal
  4770  TradingBotPanel  (builder, signals, strategies, kill switch)
  5027  TradeBot         (tab shell, order submit/place)
  9539  NAV array        (admin-only "Trade" item)
  9386  /api/user/features fetch

Backend   lib/handlers.mjs
  31    HARAM_TICKERS (Sharia gate list)
  700   canUseTradingBot / 707 canUseFullAuto
  1089  GET /api/user/features
  1272  /api/snaptrade/trade/impact   1393  /trade/place
  2977  /api/bot/strategies*          3040 /api/bot/signals*
  3094  /api/bot/strategy/nl (Claude)
  4245  /api/alpaca/order
  4492  /api/cron/bot-signals

Config    vercel.json → crons → /api/cron/bot-signals (0 14 * * 1-5)
```
