# MĪZAN — State-of-App Audit

> **Living document.** Re-run every few weeks to track drift between what's built and what's deployed.
> Last audited: 2026-06-30 (updated) · All findings from direct file reads, no guessing.
>
> **2026-06-30 session changes**: (1) **Live full-auto trading went active on a funded account** — `akhan.industries` (is_root) connected a regular **E\*Trade Individual** account (`302ebba3…`, $100 settled cash + **$100 buying power**) after the prior custodial account (`366265e9…`) stayed `buying_power=$0` (E\*Trade blocks API trading on custodial/UTMA accounts). Wired full-auto to it: strategy `e528f2d7` (SPUS breakout, `mode=full`, `position_size_pct=100`) targets `302ebba3` + `account_full_auto(b1403200,302ebba3)=true`. All gates pass → `isFullAuto=true`. (2) **bot-signals now fires every 15 min on weekdays** via a new GitHub Actions workflow (`.github/workflows/cron-bot-signals.yml`, `*/15 * * * 1-5`) hitting `/api/cron/bot-signals` with the `CRON_SECRET` bearer — Vercel Hobby caps native crons at daily, and the repo is public so Actions minutes are free. Verified end-to-end (HTTP 200, strategy evaluated). vercel.json keeps the daily `0 14 * * 1-5` entry as a backstop. (3) **Brokerage cash + buying power fix** (`/api/snaptrade/all`) — was reading `acct.balance.cash.amount`, which most brokers (E\*Trade, Robinhood) don't return (cash + buying_power live on `/accounts/{id}/balances`); funded accounts showed **$0 cash on Overview** and $0 buying power in the Trade panel. Now fetches `/balances` per account in parallel and sources both from there (live on the real-time plan). (4) **SnapTrade force-refresh toast fix** (`/api/snaptrade/refresh`) — real-time/PAYG accounts return 402 or a 4xx whose detail names the real-time plan (only 403+code-1141 was recognized), so a benign no-op surfaced the alarming "rejected the refresh for all connections" 502. Broadened benign detection (402 / 403+1141 / real-time-plan detail), kept 401/404 as hard failures, partial success now reported OK, and the genuine-failure branch now logs per-auth status/code/detail (was a blind 502). (5) **bot-signals scheduler moved to Supabase `pg_cron`** — GitHub Actions' `schedule:` trigger proved unreliable (the new `*/15` workflow registered `active` but went ~1.5h / 5 slots without a single scheduled fire; GitHub scheduled crons are best-effort and routinely drop short-interval jobs — a real risk for a breakout-reactive bot). Replaced it with a Supabase `pg_cron` + `pg_net` job (`bot-signals-15min`, `*/15 * * * 1-5` UTC) that calls `public.trigger_bot_signals()` → reads `CRON_SECRET` from **Supabase Vault** by name (`cron_secret`, plaintext never in the job definition) and `net.http_get`s `/api/cron/bot-signals` with the bearer. The GitHub `schedule:` block is now **commented out** (commit `1b92024`) to prevent two schedulers double-firing the same tick and racing on the lock-less handler (could open two positions); the workflow stays as a manual `workflow_dispatch` backstop, and vercel.json keeps its daily entry. **One operational step pending: the owner must store `CRON_SECRET` in Vault** (`select vault.create_secret('…','cron_secret',…)`); until then the job fires every 15 min but safely no-ops (function returns early when the secret is absent). See [[bot-snaptrade-impact-401]] + [[vercel-hobby-cron-limit]].
>
> **2026-06-30 (cont.) — bot went live + first real fill + tuning**: (1) **Vault secret stored → pipeline live.** `vault.create_secret(CRON_SECRET,'cron_secret')` done; `trigger_bot_signals()` now actually HTTP-calls `/api/cron/bot-signals` (verified `net._http_response` 200). The pg_cron had been "succeeding" but no-opping for days (returned early, missing secret) — `cron.job_run_details` "succeeded" only means the SQL ran, check `net._http_response.status_code` for true end-to-end. (2) **AFFORDABILITY BUG fixed (commit `1d3c42c`)** — the real reason nothing traded: the entry engine picked the highest day-momentum name in the WHOLE universe regardless of price, then floored to whole shares → AMD (+8% @ $582) won the pick on a $100 budget → qty=0 → traded nothing while cheaper qualifying names (SPTE) sat ignored. Adding high-priced halal stocks to a small-account universe starved it. Fix: compute deployable budget first, only consider a candidate if `floor(deployable/price) >= 1`; strongest AFFORDABLE name wins; pricier names activate when capital is raised. (3) **Per-strategy entry threshold** — `params.entry_threshold_pct` (default 1.5%, owner's set to 1.0%) replaces the hardcoded global. (4) **Trailing-stop exit (commit `47ba3a4`)** — high-water in `params.high_water`, arms at `trail_activate_pct` (10%), sells on `trail_pct` (6%) pullback from peak, profit-only. (5) **Universe widened** — owner's SPUS strategy now 6 halal ETFs (SPUS/HLAL/UMMA/SPSK/SPRE/SPTE) + 5 halal blue-chips (NVDA/AMD/AAPL/GOOGL/META, fund-to-activate >$100). (6) **FIRST LIVE AUTONOMOUS FILL** — bought **2 SPTE @ ~$48.81** (~$97.62) on E\*Trade `302ebba3`, status=executed, no error. End-to-end proven. (7) User's strategic conclusion: short-term momentum on slow halal ETFs is a strategy/asset mismatch. **(8) DCA strategy_type BUILT** (commit `7cd25de`, migration `023`) — `strategy_type='dca'` long-term accumulation: buys whole shares of the target on a fixed cadence (`params.dca_cadence_days`, default 7) up to `params.dca_amount`, capped by capital exposure, and HOLDS (own cron branch before the momentum/exit engine — never auto-sold; manual exit ideally >1yr). One-attempt/day guard; cadence advances only on a real fill. Owner DCA strategy `0fd266ae` = SPUS weekly, $100, full-auto, account `302ebba3`; verified the branch runs end-to-end (first test rejected `impact 403: exchanges not open` — market was closed, NOT a bug). **(9) Per-strategy entry threshold** (`params.entry_threshold_pct`), **affordability-filtered pick** (entry now requires `floor(deployable/price) >= 1` — fixed the "picks AMD @ $582 on a $100 budget → trades nothing" bug), and **trailing-stop exit** (`params.trail_pct`/`trail_activate_pct`, high-water in `params.high_water`). **(10) Watchlist auto-syncs all strategy tickers** + client-side `fixTicker()` typo correction. **(11) PENDING: Alpaca data API** (free extended-hours prices + market-hours gate so the bot stops placing orders after-hours; the all-hours `*/15` cron currently no-ops via broker rejection outside RTH). See [[bot-execution-model]], [[bot-snaptrade-impact-401]], [[alpaca-data-pending]].
>
> **2026-06-25 session changes**: (1) **Trading Bot opened to beta users** — migration `022_trading_bot_beta` adds `profiles.trading_bot_enabled` (allowlist, default false, independent of `is_root`) + `profiles.trading_bot_consent_at`. `canUseTradingBot()` = root OR `trading_bot_enabled`; `is_root` still solely gates admin/keys/anomaly. **Full-auto is now root-only and unreachable for beta users** (server rejects `403 full_auto_root_only` on create/edit + per-account opt-in PATCH). **First-use consent gate** (`POST /api/bot/consent`, experimental/not-an-RIA/not-advice) blocks strategy-create / signal-approve / order-place for non-root until accepted; UI hides the builder behind a consent card and shows only Manual/Semi layers. `/api/user/features` now returns `is_root` + `trading_bot_consented`. (2) **In-place strategy editing** — `PATCH /api/bot/strategies/:id` now edits ticker/account/type/universe + all risk params (was create-only), re-enforces the stop-loss gate and read-modify-writes `params`; new pre-filled Edit modal in the UI. (3) **Realized-P&L ledger** — `botRealizedPnl()` (per-ticker avg-cost walk over executed signals) + `GET /api/bot/trades` (aggregate realized + win rate + closed round-trips); new "REALIZED P&L · CLOSED TRADES" tile + per-strategy realized line. **(3b) Bot Activity timeline** — `GET /api/bot/activity` (all signals + outcomes from `pending_signals`, newest-first ≤100) + a "BOT ACTIVITY · ALL ACTIONS" tile in the Signals sub-tab (BUY/SELL, FILLED/PENDING/APPROVED/REJECTED/EXPIRED/FAILED, side/qty/ticker/strategy/price/time + inline error). Reads the bot's own ledger so a full-auto fill shows there the instant the cron runs, before the broker-synced Portfolio → Activity tab. Built after full-auto went live on `akhan.industries` so the user can watch autonomous trades without opening the brokerage. (4) **Overview hero relabeled** "Total Portfolio Value" → **"Net Worth"** (it computes net worth, collided with Portfolio's holdings-only "Market Value"). (5) **First-run fixes** — `demoMode` now **defaults OFF** (new users see real $0 + Welcome card, not the demo persona's ~$41M; demo is opt-in via `mizan_demo=1`); onboarding **CSV/document step removed** (Welcome·Connect·AI·Done); new connection **immediately** `fetchSnapHoldings()` so every tab updates even with zero holdings. (6) **CRON OUTAGE FIXED** — `CRON_SECRET` was never set in Vercel (a typo'd `CRON_SECRE` existed), so the fail-closed `cronUnauthorized()` 401'd **every** cron — nothing ran for the app's life (empty `cron_jobs`, zero `cron.*` audit rows, `cron.stale` alert). Set `CRON_SECRET` in Vercel Production → crons live. Also fixed: bot-signals cron 500'd on `.catch is not a function` (×3 Supabase-builder `.catch()` misuses — expire/reset/dividend-notif), and `cron.sync` success now writes an `audit({action:"cron.sync"})` row so the staleness detector + admin "last sync" have a real signal. NEW ENV (now set): `CRON_SECRET`. (7) **whats-new-banner** project skill added (curates the landing ticker after a commit).
>
> **2026-06-24 session changes**: (1) **Trading Bot** — strategies now SCREEN a halal universe and PICK the ticker (cron `screenSymbol` over `params.universe_tickers` / `HALAL_UNIVERSE_DEFAULT`), size from capital, price from market; buys only from screener, sells only from the exit engine (no shorting); one open position per strategy; exit engine quotes the held ticker. Three layers (manual/semi/full) are now a **per-strategy** choice (`params.layer`, no migration — DB `mode` derived) switched via an inline selector behind an **ack gate**. Order Ticket reframed as ad-hoc manual override. (2) **Sharia screening unified** — new `lib/sharia.mjs` provider seam (Finnhub now, **Zoya** when `ZOYA_API_KEY` set) + `GET/POST /api/screen`; `h.sh_` now flows from the live verdict (`shariaScreen` state via a root effect) with `SHARIA_MAP` only as pre-load fallback, so Screener / Overview compliance / Rebalancer halal-mode / Purification all read ONE verdict. Purification uses a screen-derived non-permissible-income % when the provider supplies it (Zoya). NEW ENV: `ZOYA_API_KEY` (+ optional `ZOYA_API_BASE`) — not yet provisioned.
>
> **2026-06-17 session changes**: Range-aware portfolio gains (1D/1W/1M/3M/YTD/1Y/All); real chart axes (XAxis months+year, YAxis $0→auto); Activity net-flow + range label; TaxPlanner normSym() helper; Screener cache freshness dot; fake sparkline replaced with position count + cost basis. CLAUDE.md rewritten to elite engineering brief (17 sections). Session hooks added (.claude/settings.json) — build check on edit, auto-update audit date on Stop.

---

## ═══ SECTION 1 — ARCHITECTURE & STACK ═══

### Frontend
| Item | Detail |
|------|--------|
| Framework | React 18.3.1 (JSX, not TypeScript) |
| Build tool | Vite 5.4.1 |
| Entry | `src/main.jsx` → `src/App.jsx` → `src/components/MizanApp.jsx` |
| Charts | recharts 2.12.7 |
| Routing | Client-side SPA (no router library — tab state in `useState`) |
| PWA | Service worker at `public/sw.js`, manifest, VAPID push |
| Fonts | Google Fonts: Fraunces (display/stats), IBM Plex Sans (body), IBM Plex Mono (labels) |

**Bundle (from last `npm run build`):**

| Chunk | Uncompressed | Gzip |
|-------|-------------|------|
| `index-*.js` (main app) | 543 KB | ~153 KB |
| `charts-*.js` (recharts) | 547 KB | ~155 KB |
| `supabase-*.js` | 207 KB | ~53 KB |
| `vendor-*.js` (react/react-dom) | 0.03 KB | ~0.05 KB |
| **Total** | **~1.30 MB** | **~361 KB** |

### Backend
- **Runtime**: Node.js (ESM modules)
- **Dev server**: `server.js` (285 lines) — unified Vite middleware + API handler on port 3000
- **Production**: `api/[...path].mjs` — single Vercel catch-all serverless function (Hobby plan, `runtime: "nodejs"`)
- **Route logic**: `lib/handlers.mjs` (4,239 lines — **see Section 7**)
- **Support libs**: `lib/alerts.mjs`, `lib/anomaly.mjs`, `lib/crypto.mjs`, `lib/fetchWithRetry.mjs`, `lib/logger.mjs`, `lib/notify.mjs`, `lib/rateLimit.mjs`, `lib/sentry.mjs`

### Database (Supabase / PostgreSQL)
22 migrations — all sequential (011 gap was patched). Bot tables (020–022) added in the 2026-06-24/25 sessions:

| Table | Key Columns | RLS | Notes |
|-------|-------------|-----|-------|
| `audit_log` | id, user_id, action, target, metadata, ip, user_agent, created_at | ✅ SELECT own | Append-only, service-role writes |
| `user_snaptrade` | user_id (PK), snaptrade_user_id, snaptrade_user_secret_enc, snaptrade_user_secret_nonce | ✅ Full CRUD | **AES-256-GCM encrypted** (plaintext column dropped by mig 017) |
| `user_state` | (user_id, key) PK, value jsonb, updated_at | ✅ Full CRUD | Generic key/value store |
| `user_keys` | user_id (PK), finnhub_key, polygon_key, encrypted boolean | ✅ Full CRUD | `encrypted` column now `true` — keys AES-256-GCM encrypted at application layer |
| `plaid_tokens` | id, user_id, access_token, item_id, institution_name, transactions_cursor | ✅ **No client policy** | access_token server-only (intentional) |
| `plaid_accounts` | id, user_id, item_id, account_id, name, type, subtype, balances | ✅ SELECT own | |
| `plaid_transactions` | id, user_id, item_id, account_id, transaction_id, amount, category_primary/detailed, date, pending, raw_data | ✅ SELECT own | Cursor-based sync |
| `rate_limits` | id, user_id, window_key, count, created_at | ✅ **No client policy** | Service-role only, atomic RPC |
| `profiles` | id (PK = auth.users.id), email, is_root, suspended, suspended_at | ✅ SELECT own | Auto-created on signup via trigger |
| `push_subscriptions` | id, user_id, endpoint, p256dh, auth | ✅ SELECT own | Per-device Web Push endpoints |
| `polygon_cache` | id, ticker, from_date, to_date, timespan, data, cached_at | ✅ **No client policy** | Shared market-data cache, 24h TTL |
| `cron_jobs` | id, job_name, last_run_at, last_status, run_count | ✅ **No client policy** | Scheduler ledger |
| `account_nicknames` | (user_id, account_id) PK, nickname | ✅ Full CRUD | |
| `budgets` | (user_id, category) PK, monthly_limit, currency | ✅ Full CRUD | |
| `goals` | id, user_id, name, target_amount, target_date, account_ids[], track_mode, manual_progress | ✅ Full CRUD | |
| `security_events` | id, ip, event_type, user_id, metadata, created_at | ✅ **No client policy** | **NEW (mig 018)** — DB-backed IP blocks replacing in-memory Map |
| `purification_ratios` | id, ticker, impurity_pct, source, updated_at | ✅ SELECT public | **NEW (mig 019)** — AAOIFI impurity % per ETF; seeded with SPUS/HLAL/UMMA/SPSK/SPRE/SPTE/AMAGX/AMANX |
| `bot_strategies` | id, user_id, ticker, account_id, strategy_type, params jsonb (layer, universe_tickers, entry/exit rules), mode, capital_allocated, profit_target_pct, stop_loss_pct, max_drawdown_pct, time_horizon_days, max_trades_per_day, enabled | owner-gated | **NEW (mig 020)** — owner/beta trading-bot strategies; `params.layer` is the user-facing execution layer, DB `mode` is the full-auto safety gate |
| `pending_signals` | id, user_id, strategy_id, ticker, side, qty, suggested_price, status (pending/approved/executed/expired/rejected), executed_at, expires_at, error_msg | owner-gated | **NEW (mig 020)** — bot BUY/SELL signals; executed rows ARE the realized-P&L ledger (`botRealizedPnl`) |
| `account_full_auto` | (user_id, account_id) PK, enabled (default false), updated_at | owner-only RLS | **NEW (mig 021)** — per-account Layer-3 opt-in; third gate of the full-auto triple-gate (root + master switch + this). PATCH now root-only |
| `profiles` (+cols) | …, `trading_bot_enabled` (default false), `trading_bot_consent_at` | ✅ SELECT own | **NEW cols (mig 022)** — beta bot allowlist (independent of `is_root`) + first-use consent timestamp |

**RLS functions (service-role only):**
- `increment_rate_limit(user_id, window_key, max)` — atomic upsert rate counter
- `get_user_sessions(user_id)` / `revoke_session()` / `revoke_other_sessions()` — bridge to `auth.sessions`

### Auth
- **Method**: Email + password via Supabase Auth (`supabase.auth.signInWithPassword`)
- **MFA**: TOTP (Google Authenticator-style) via Supabase MFA — enroll/unenroll/verify fully implemented in `src/lib/auth.jsx`
- **AAL2 enforcement**: Server-side `requireAAL2()` in `handlers.mjs` gating Plaid link operations — requires MFA-verified session
- **Session handling**: Active sessions panel (list/revoke individual sessions / revoke all others) via `006_sessions.sql` RPCs
- **Admin role**: `profiles.is_root` column (DB source of truth) + `VITE_OWNER_EMAIL` env bootstrap fallback

### Hosting
- **Frontend + Backend**: Vercel (project `mizan`, org `team_1jpYtfQNP39boDKElAshCOOL`)
- **Single function**: `api/[...path].mjs` handles all `/api/*`
- **Cron jobs** (vercel.json):

| Path | Schedule | Purpose |
|------|----------|---------|
| `/api/cron/sync` | `0 6 * * *` (daily 6 AM UTC) | SnapTrade sync across all users |
| `/api/cron/cleanup` | `0 3 * * *` (daily 3 AM UTC) | Data cleanup |
| `/api/cron/nightly-snapshot` | `55 4 * * *` | Net worth snapshot |
| `/api/cron/weekly-digest` | `0 13 * * 1` (Mon 1 PM UTC) | Weekly digest push notification |
| `/api/cron/dividend-check` | `0 11 * * *` | Dividend detection + purification push notification |
| `/api/cron/bill-reminders` | `0 14 * * *` | Bill reminder notifications |
| `/api/cron/bot-signals` | `0 14 * * 1-5` (vercel.json, daily backstop) **+ Supabase `pg_cron` `*/15 * * * 1-5` UTC** (job `bot-signals-15min` → `public.trigger_bot_signals()`) | Trading-bot strategy evaluation + signal generation/execution. Vercel Hobby caps crons at daily, so the every-15-min weekday cadence runs in Supabase: `pg_cron` fires `trigger_bot_signals()`, which reads `CRON_SECRET` from Vault (`cron_secret`) and `pg_net.http_get`s the endpoint with the bearer. Moved off GitHub Actions 2026-06-30 (its `schedule:` was unreliable — see header note (5); the workflow's `schedule:` is now commented out, kept only for manual `workflow_dispatch`). **Requires the `cron_secret` Vault entry** or the job no-ops. |

### File Count & Large File Flags
- **Total source files**: ~120 (excluding node_modules/worktrees)
- **🚨 MizanApp.jsx**: **9,201 lines** — contains ALL views, ALL state, ALL data structures
- **🚨 handlers.mjs**: **4,239 lines** — every API route in one file
- Both are far over the 800-line guideline

---

## ═══ SECTION 2 — EXTERNAL INTEGRATIONS & APIs ═══

| Integration | Status | Endpoints That Call It | Key Env Var | Tier | Prod? |
|-------------|--------|----------------------|-------------|------|-------|
| **SnapTrade** | ✅ Fully wired | `/api/snaptrade/status`, `login`, `accounts`, `all`, `holdings`, `activities`, `disconnect`, `documents`, `refresh`, `trade/impact`, `trade/place` | `VITE_SNAPTRADE_CLIENT_ID` + `VITE_SNAPTRADE_CONSUMER_KEY` | Free sandbox / paid production | Yes |
| **Plaid** | ✅ Fully wired | `/api/plaid/link-token`, `exchange`, `accounts`, `transactions`, `item-status`, `item` (DELETE), `webhook` | `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV` | Paid production | Yes |
| **Anthropic** | ✅ Fully wired | `/api/advisor` (POST), `/api/advisor/count` (POST) | `ANTHROPIC_KEY` | Pay-as-you-go (~$0.01/msg) | Yes |
| **Stooq** | ✅ Fully wired | `/api/metals/spot` (proxies Stooq CSV) | None (free, no key) | Free | Yes |
| **Finnhub** | ✅ Fully wired | `/api/finnhub/earnings`, `dividends`, `profile2`, `metric`, `quote`, `news`; **Sharia screening fundamentals via `lib/sharia.mjs` → `/api/screen`** | `FINNHUB_KEY` / `VITE_FINNHUB_KEY` | Free tier (60 req/min) | Yes |
| **Zoya** | 🔌 Seam ready, not keyed | `lib/sharia.mjs` → `/api/screen` (overrides Finnhub when `ZOYA_API_KEY` set; adds non-permissible-income test + direct verdict; falls back to Finnhub on error) | `ZOYA_API_KEY`, `ZOYA_API_BASE` (opt) | Free (per user — not yet provisioned) | No (provider seam only) |
| **Polygon** | ⚙️ Partially | `/api/polygon/bars` (OHLC for backtester only) | `POLYGON_KEY` | Free tier (5 req/min, 2yr history) | Yes (backtester only) |
| **Alpaca** | ⚙️ Partially | `/api/alpaca/order`, `orders`, `positions` — **paper API only** | `ALPACA_KEY_ID`, `ALPACA_SECRET` | Free paper trading | Backend yes, UI gated |
| **Supabase** | ✅ Fully wired | DB + Auth for entire app | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Paid | Yes |
| **Resend** | ⚙️ Partially | `lib/alerts.mjs` — anomaly alert emails only (no user-facing transactional email) | `RESEND_API_KEY` | Free (3000/mo) | Yes (alerts only) |
| **Sentry** | ✅ Fully wired | Frontend (`@sentry/react`) + backend (`@sentry/node`) v10.52 | `VITE_SENTRY_DSN`, `SENTRY_DSN` | Free tier (5k events/mo) | Yes |
| **Web Push (VAPID)** | ✅ Fully wired | `/api/notifications/subscribe`, `vapid-public-key`, `test` | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | `web-push` library | Yes |

**Not present**: No Alpaca production keys (paper only). No outbound email to users (only owner alert emails via Resend).

---

## ═══ SECTION 3 — FEATURE INVENTORY ═══

### Overview Tab
| Feature | Status |
|---------|--------|
| Total portfolio value (Snap + Plaid combined) | ✅ Built + Deployed |
| Net worth history area chart | ✅ Built + Deployed |
| Asset allocation donut (halal/review/haram/cash) | ✅ Built + Deployed |
| Zakat Due tile (live gold/silver nisab via Stooq) | ✅ Built + Deployed |
| Dividend purification callout (pending owed → Zakat tab CTA) | ✅ Built + Deployed |
| Sadaqah donated total | ✅ Built + Deployed |
| YTD metrics (contributions, dividends, fees, returns) | ✅ Built + Deployed |
| Account cards with PLAID / SNAPTRADE badge | ✅ Built + Deployed |
| Values masking ("privacy mode") | ✅ Built + Deployed |
| Demo mode (fixture data when no accounts connected) | ✅ Built + Deployed |

### Finances Tab (Plaid)
| Feature | Status |
|---------|--------|
| Plaid bank account list with balances | ✅ Built + Deployed |
| Transaction list (cursor sync) | ✅ Built + Deployed |
| Spending by category (Plaid categories) | ✅ Built + Deployed |
| Budget management (monthly caps per category) | ✅ Built + Deployed |
| Bills Calendar (`BillsCalendar.jsx`) | ✅ Built + Deployed |
| "Awaiting data" empty state before first sync | ✅ Built + Deployed |

### Portfolio Tab
| Sub-tab | Status |
|---------|--------|
| Holdings (live Finnhub prices, Sharia status, unrealized P&L) | ✅ Built + Deployed |
| Per-holding news accordion (3 headlines, expandable inline) | ✅ Built + Deployed |
| Per-holding earnings accordion (next/last earnings dates + EPS) | ✅ Built + Deployed |
| Activity (SnapTrade transaction history) | ✅ Built + Deployed |
| Rebalance (target asset class weights, drift suggestions) | ✅ Built + Deployed · halal-mode keys off the live screen (shared `sh_`) |
| Tax (unrealized gains/losses breakdown) | ✅ Built + Deployed |
| Backtest (Polygon OHLC, strategy runner) | ✅ Built + Deployed |
| Screener (AAOIFI 7-framework Sharia screener) | ✅ Built + Deployed · now backed by `lib/sharia.mjs` → `/api/screen` (single source of truth for `sh_`); provider seam ready for Zoya |
| ETFs & Funds catalog | ✅ Built + Deployed |
| Documents (SnapTrade account statements) | ✅ Built + Deployed |

### Goals Tab
| Sub-tab | Status |
|---------|--------|
| Goals (savings goals, progress bars, projected completion, Islamic templates) | ✅ Built + Deployed |
| Goals Overview widget on Goals tab header | ✅ Built + Deployed |
| Zakat & Sadaqah (full Zakat calc with methodology toggles) | ✅ Built + Deployed |
| Dividend Purification (AAOIFI — per-dividend purification log, Mark Purified / Purify All, inline impurity % override) | ✅ Built + Deployed |
| Retirement / FIRE calculator | ✅ Built + Deployed |

### AI Advisor Tab
| Feature | Status |
|---------|--------|
| Claude Sonnet 4 chat with portfolio context injected | ✅ Built + Deployed |
| Server-side Sharia guardrails system prompt | ✅ Built + Deployed |
| Rate limited (60/hr) | ✅ Built + Deployed |
| Token count preflight (`/api/advisor/count`) | ✅ Built + Deployed |

### Settings Tab
| Sub-section | Status |
|------------|--------|
| Connect accounts (SnapTrade OAuth + Plaid Link with MFA gate) | ✅ Built + Deployed |
| Connection health dashboard (`ConnectionHealth.jsx`) | ✅ Built + Deployed |
| Account profile + email change | ✅ Built + Deployed |
| Security (TOTP MFA enroll/disable, active sessions, revoke) | ✅ Built + Deployed |
| Push notifications (subscribe/unsubscribe) | ✅ Built + Deployed |
| Manual assets (gold, silver, cash, real estate, liabilities) | ✅ Built + Deployed |
| Documents (SnapTrade statements) | ✅ Built + Deployed |
| Privacy & Data (export + account delete) | ✅ Built + Deployed |
| About page | ✅ Built + Deployed |
| Admin panel (users, audit log, stats, suspend) — root-only | ✅ Built + Deployed |

### Trade Tab (folded into Portfolio)
| Feature | Status |
|---------|--------|
| Order Ticket UI (buy/sell form, SnapTrade + Alpaca toggle) | ⚙️ Built but **double-gated** — wrapped in both `<ComingSoon>` AND `{false && ...}` |
| Alpaca paper trading backend (`/api/alpaca/order`) | ✅ Built + Deployed (backend only) |
| SnapTrade live trading backend (`/api/snaptrade/trade/*`) | ✅ Built + Deployed (backend only) |
| Sharia precheck blocklist (HARAM_TICKERS) | ✅ Built + Deployed (backend only) |

---

## ═══ SECTION 4 — SECURITY POSTURE ═══

### Data Storage
| Data | Where | Notes |
|------|-------|-------|
| Plaid `access_token` | `plaid_tokens` table (server-only) | No RLS client policy by design — only accessible via service-role key. Never reaches browser. |
| SnapTrade `userSecret` | `user_snaptrade.snaptrade_user_secret_enc` + `_nonce` | **AES-256-GCM encrypted at application layer** (mig 016 added enc columns; mig 017 dropped plaintext column). Key from `APP_ENCRYPTION_KEY` env. |
| Plaid transactions | `plaid_transactions` | RLS SELECT own. Written server-side only. |
| User preferences, watchlist, Zakat settings | `user_state` + localStorage | Supabase-backed with localStorage mirror |
| Per-user API keys (Finnhub, Polygon) | `user_keys` | RLS CRUD own. `encrypted = true` — AES-256-GCM encrypted at application layer |
| Push endpoints | `push_subscriptions` | RLS SELECT own |
| Auth sessions | `auth.sessions` (Supabase internal) | Accessed only via service-role RPCs |
| IP blocks | `security_events` | **DB-backed** — persists across cold starts and Vercel instances |

### Encryption
`lib/crypto.mjs` provides `encryptField(plaintext)` / `decryptField(enc, nonce)` using Node `crypto.createCipheriv('aes-256-gcm', ...)`. Key is `Buffer.from(APP_ENCRYPTION_KEY, 'hex')` — 32-byte hex string from env. Migration `016_encrypt_secrets.sql` added `_enc`/`_nonce` columns; migration `017_drop_plaintext_secrets.sql` dropped plaintext columns.

### Rate Limiting
- **Mechanism**: Supabase DB-backed atomic `increment_rate_limit` RPC (survives cold starts, shared across Vercel instances)
- **Anonymous fallback**: In-memory Map keyed by IP
- **Limits** (per-hour): snaptrade.login: 30, anthropic: 60, plaid: 120, plaid.sync: 10, auth: 20, export: 20, feedback: 10, default: 6000, anon: 300
- **Root bypass**: Admin users skip all rate limits

### Audit Logging
- **What's logged**: `auth.sign_in`, `auth.sign_out`, `auth.signin_failed`, `auth.mfa_enrolled/unenrolled`, `auth.password_changed`, `auth.new_device`, `broker.connect_initiated`, `broker.disconnect`, `plaid.link_completed`, `plaid.item_deleted`, `alpaca.order_placed`, `alpaca.order_blocked`, `goal.created/updated/deleted`, `settings.api_keys_saved`, `account.export`, `account.deleted`, `budget.*`, `cron.sync`, `cron.cleanup`
- **Retention**: No explicit TTL column or cleanup cron targeting audit_log specifically
- **Access**: Users can SELECT their own rows. Admin reads all via service-role

### RLS Coverage
Migration `015_rls_audit_and_select_policies.sql` performed a pre-launch audit and confirmed **no user-scoped table is missing a SELECT policy**. New tables added since: `security_events` (intentionally server-only, no client policy) and `purification_ratios` (public SELECT, no user data).

### MFA / Session Revocation
- TOTP MFA fully implemented and available to all users
- AAL2 enforced server-side for Plaid link operations specifically
- MFA is **not mandatory** globally — only for bank linking
- Full session revocation (individual + "all others") via SQL RPCs

### Anomaly Detection (4 detectors in `lib/anomaly.mjs`)
| Detector | Trigger | Action | Persistence |
|----------|---------|--------|-------------|
| Brute force | 5 auth failures from same IP in 60s | 24h IP block + Resend alert | ✅ **DB-backed** (`security_events` table — survives cold starts) |
| SnapTrade 5xx spike | 10 upstream 5xx in 5 min | Resend alert | ⚠️ In-memory |
| Cron staleness | >25h since last cron.sync or cleanup | Resend alert | DB-backed (reads audit_log) |
| New device sign-in | (IP, UA hash) not in last 20 logins | Resend alert | DB-backed (reads audit_log) |

### CSP Headers (vercel.json)
Present and reasonably strict. Uses `'unsafe-inline'` for `script-src` (Plaid Link requires it) and `style-src` — not nonce-based. `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`. HSTS with preload (2-year max-age).

### Secrets Scan
No hardcoded secrets found in any source file. All keys read from `process.env`. One legacy risk: `.snaptrade-users.json` flat file stores `mizan_primary: <userSecret>` in plaintext (server-filesystem-only, does not survive Vercel restarts, but present in local dev).

---

## ═══ SECTION 5 — DEPLOYED vs BUILT-BUT-NOT-DEPLOYED ═══

### Live in Production
- All 6 nav tabs with all sub-views
- All API routes in `handlers.mjs`
- 6 Vercel cron jobs
- Service worker / PWA install
- Sentry error tracking (frontend + backend)
- All 22 Supabase migrations (020–022 applied in prod via MCP this session)

### Built but NOT Live in UI
- **Order Ticket**: UI code exists in `MizanApp.jsx` but is wrapped in `{false && ...}` (hardcoded dead code). Clicking the tab shows a `<ComingSoon>` tile. Two separate gates to remove before it renders.
- **Alpaca paper trading UI** and **SnapTrade live trading UI**: Both backend API routes fully deployed; no UI path reaches them.

### Demo Mode
A rich 8-figure demo persona lives in hardcoded `DEMO_ACCOUNTS`, `DEMO_BANK_ACCOUNTS`, `DEMO_TRANSACTIONS`, `DEMO_ACTIVITIES`, `DEMO_MANUAL_ASSETS`, `DEMO_SADAQAH`, `DEMO_SHARIA`, `DEMO_PURIFICATION_ITEMS` inside `MizanApp.jsx`. **As of 2026-06-25 demo is OPT-IN, not the default** — `demoMode` initializes from `localStorage.mizan_demo==="1"` only; a new/connection-less user sees their real **$0 + Welcome/Connect** state, never the demo's ~$41M as their net worth. The DEMO toggle (shown while `!hasRealData || demoMode`) flips `mizan_demo` and `fetchSnapHoldings` swaps in/out `DEMO_ACCOUNTS` via the `[demoMode]` effect. (Previously demo defaulted ON for any user without real data, which routed the demo book into the net-worth headline — that was the "$0 → $41M" bug.)

### Backend Endpoints with No Active Frontend Caller
- `/api/alpaca/orders` (GET), `/api/alpaca/positions` (GET) — exist in handlers, no component fetches them
- `/api/debug/sentry-test` — admin-only debug route
- `/api/admin/stats`, `/api/admin/users/:id/suspend`, `/api/admin/users/:id/broker` — callable from AdminPanel (root-only)

---

## ═══ SECTION 6 — FEATURE GAP CHECK ═══

### 1. Dividend Purification Automation
**Status**: ✅ **BUILT + DEPLOYED** (completed 2026-06-16)

`purification_ratios` table seeded with AAOIFI impurity % for 8 tickers (SPUS 1.70%, HLAL 2.80%, UMMA 2.20%, SPSK 0.50%, SPRE 3.80%, SPTE 1.50%, AMAGX 1.20%, AMANX 2.40%). `/api/purification/calculate` endpoint computes `dividend × impurity_pct / 100` per holding. `PurificationPanel` component in Goals → Zakat & Sadaqah shows per-dividend table with Mark Purified / Purify All actions, inline impurity % override, and scholar disclaimer. Overview tile shows CTA with pending purification total. Cron dividend-check triggers push notification when unpurified dividends accumulate.

---

### 2. Islamic Calendar / Hijri Integration
**Status**: ❌ Not present — Zakat calc exists but no calendar

What exists: Full Zakat calculator with nisab gating, live gold/silver prices, methodology toggles. Hawl tracking is conceptual only — no Hijri date, no per-asset hawl start date, no countdown.

What's missing: Hijri date library, per-asset hawl start date storage, Ramadan detection, giving-mode UI, Zakat due date reminder push notification.

Reusable: ZakatSadaqah component, goals table (could store hawl dates), push notifications infrastructure.

**Effort: M**

---

### 3. Goal-Based Investing (Hajj fund, Mahr savings, etc.)
**Status**: ✅ **BUILT + DEPLOYED** (completed 2026-06-16)

Islamic goal templates (Hajj, Mahr, Home down payment, Emergency fund, Education, Business) available as one-tap pre-fills. Goals Overview widget on the Goals tab header shows progress summary.

---

### 4. Per-Holding News & Earnings
**Status**: ✅ **BUILT + DEPLOYED** (completed 2026-06-16)

Expandable accordion row on each holding in the Holdings table. News tab shows 3 latest Finnhub headlines with source + age. Earnings tab shows next/last earnings dates and EPS estimate vs actual. Results cached 30 min client-side.

---

### 5. Manual Monthly Budget Tracker
**Status**: ✅ Substantially built — Muslim categories are the gap

What exists: `Budgeting.jsx` (425 lines), `/api/budgets` CRUD, `budgets` table, per-category monthly caps with progress bars, actual spend pulled from Plaid transaction categories.

What's missing: Muslim-household category presets (Sadaqah, Masjid donations, Islamic school fees, Halal food). Currently uses Plaid's generic category labels.

Reusable: Everything already exists.

**Effort: S**

---

### 6. Shareable Snapshot Links
**Status**: ❌ Not present

No read-only view, no token-based share routes, no anonymization logic.

Reusable: `user_state`, SnapTrade account/holdings structure.

**Effort: M**

---

### 7. Browser Extension
**Status**: ❌ Not present

No extension manifest, no content script, nothing.

Reusable: Sharia screener logic in MizanApp.jsx (AAOIFI categories), Finnhub profile endpoint.

**Effort: L**

---

### 8. Risk-Adjusted Return Metrics (Sharpe, drawdown, volatility vs SPUS)
**Status**: ❌ Not present

Activity tab shows total return and YTD P&L. Backtest shows strategy return vs buy-and-hold. No Sharpe ratio, max drawdown, volatility, or benchmark comparison.

Reusable: SnapTrade activities data, Polygon OHLC bars endpoint, backtester data pipeline.

**Effort: M**

---

### 9. Anonymous Peer Comparison
**Status**: ❌ Not present

No aggregation, no anonymized peer benchmark, no user cohort data.

Reusable: Would need opt-in consent + aggregate query views on `user_state`/balances.

**Effort: L**

---

## ═══ SECTION 7 — DESIGN SYSTEM ═══

### Typography
| Role | Font | Usage |
|------|------|-------|
| Display / Stats | Fraunces (optical-size variable serif) | All hero numbers, stat values, large headings (fontSize ≥ 16 with `tabular-nums`) |
| Body | IBM Plex Sans | All body text, labels, form inputs, descriptions (fontSize 11–15) |
| Mono | IBM Plex Mono | Tickers, chips, pills, code-style labels, buttons |

Loaded via Google Fonts with `display=swap`. `FU` constant = Fraunces, `FP` = IBM Plex Sans, `FM` = IBM Plex Mono.

### Color Palette (dark theme — `data-theme="dark"`)
| Token | Value | Semantic Role |
|-------|-------|---------------|
| `--mz-bg` | `#0d1311` | Page background (forest-green ink) |
| `--mz-surface` | `#111a17` | Elevated surface |
| `--mz-card` | `#15201c` | Card / tile background |
| `--mz-border` | `#2a3a33` | Default border |
| `--mz-borderHi` | `#3a4f45` | Hovered border |
| `--mz-text` | `#b7b3a6` | Body text |
| `--mz-textHi` | `#e9e4d6` | High-emphasis text / paper |
| `T.blue` | `#c9a24b` | Gold — primary accent, buttons, links |
| `T.blueDim` | `#9a7a35` | Gold dim — gradient end for buttons |
| `T.gold` | `#cf9e54` | Amber — warnings, Zakat amounts |
| `T.gain` | `#6fae8e` | Jade — halal / healthy / gain |
| `T.loss` | `#c46a52` | Rust — haram / error / loss |
| `T.slate` | `#7b94a6` | Unscreened holdings |
| `T.violet` | `#9d86b8` | Crypto / alternative assets |

Light theme (`data-theme="light"`) uses warm paper `#f5f2eb` background with matching surface/border adjustments.

### Bento Layout
- `BentoTile` component: 2px top accent bar, 1px tinted left border, hover lift (`translateY(-1px)`), click lift (`translateY(-2px) scale(1.003)`), `box-shadow` from `--sh-md/lg/sm`
- `BentoRow`: CSS grid with fake-gap border technique (1px gap on `--mz-border` background)
- Ambient glows: `body::before` (gold radial, top-right) + `body::after` (jade radial, bottom-left)

### Components with local tokens updated
All satellite components updated to match main design system: Goals.jsx, Budgeting.jsx, ConnectionHealth.jsx, ComingSoon.jsx, BillsCalendar.jsx, BugReportButton.jsx, CommandPalette.jsx, Login.jsx, LegalLayout.jsx.

---

## ═══ SECTION 8 — HONEST ASSESSMENT ═══

### Top 3 Most Production-Ready

**1. Security architecture**
RLS confirmed gap-free across all 17 user-scoped tables. TOTP MFA, session revocation, persistent DB-backed rate limiting, **DB-backed IP blocks** (survives cold starts), four anomaly detectors, audit log covering ~20 action types, Sentry on both sides, CSP headers with HSTS preload. SnapTrade `userSecret` and user API keys now AES-256-GCM encrypted at application layer. Plaid `access_token` server-only.

**2. Plaid integration**
Full cursor-based transaction sync with `MAX_PAGES=200` hard cap, webhook support, MFA (AAL2) enforcement before bank linking, error taxonomy with user-safe messages (12 error codes mapped to human copy), `access_token` architecture correct (never reaches browser). The `syncPlaidItem` function handles added/modified/removed deltas properly.

**3. Islamic finance feature set**
Live Zakat nisab via Stooq (gold/silver spot), AAOIFI dividend purification with per-ticker impurity ratios, full Sharia screener with business activity + financial ratios, halal ETF catalog, Sadaqah log, goal templates (Hajj, Mahr, etc.), FIRE calculator. Comprehensive for an Islamic personal finance app.

---

### Top 3 Weakest / Most Fragile Areas

**1. MizanApp.jsx is 9,201 lines**
A single file contains every view, every data structure (including all demo fixtures), all state management, all chart logic, all Zakat calculation, and all Sharia screening. It has hardcoded `HOLDINGS`, `ACCOUNTS`, `SADAQAH`, `ETF_LIST`, `BROKERS`, `DEMO_ACCOUNTS`, `DEMO_ACTIVITIES`, `DEMO_TRANSACTIONS` arrays. This file is practically untestable and is a serious maintenance liability.

**2. SnapTrade 5xx spike detector is still in-memory**
`_ipBlocks` brute-force blocking is now DB-backed, but the SnapTrade 5xx spike counter (`_snaptradeFailures`) remains an in-memory Map. A Vercel instance restart resets the failure count, so a SnapTrade outage could fail to alert if failures are spread across cold-started instances.

**3. No test suite**
Zero unit tests, zero integration tests, zero E2E tests. Every change is verified manually. The 9,201-line MizanApp.jsx makes retroactive test-writing very difficult. Adding any meaningful test coverage requires component extraction first.

---

### Things Found Broken or Half-Wired

0. **[RESOLVED 2026-06-25] Crons never ran for the app's life.** `CRON_SECRET` was never set in Vercel (a typo'd `CRON_SECRE` had been created). The fail-closed `cronUnauthorized()` (`!CRON_SECRET || bearer mismatch`) therefore 401'd every `/api/cron/*` invocation — empty `cron_jobs`, zero `cron.*` audit rows, recurring `cron.stale` high alert. **Fix: set `CRON_SECRET` in Vercel Production** (Vercel only auto-attaches the cron `Authorization: Bearer` header when that exact var exists). Two code bugs surfaced once crons finally ran and are also fixed: (a) bot-signals 500'd on `.catch is not a function` — three Supabase filter builders chained `.catch()` (which builders don't have); (b) `cron.sync` logged success via `info()` but never wrote an audit row, so the staleness detector + admin "last sync" always read Infinity → now writes `audit({action:"cron.sync"})`. **Watch-outs:** Vercel **Redeploy** reuses the original deployment's env snapshot — a *fresh git build* is required to bind a newly-added env var; and the env-name typo class (`CRON_SECRE`) is silent because nothing reads it.

1. **Order Ticket is double-gated.** The tab renders `<ComingSoon>` for all users. The real UI code is also wrapped in `{false && sub==="order" && ...}` (hardcoded dead code). To re-enable, both the `<ComingSoon>` render AND the `{false && ...}` wrappers must be removed. The backend (`/api/alpaca/order`, `/api/snaptrade/trade/*`) is fully deployed and ready.

2. **Legacy `.snaptrade-users.json` flat file still active.** `lib/handlers.mjs` still reads/writes this file for `mizan_primary` single-user fallback. If it exists on the server, it stores the SnapTrade `userSecret` as unencrypted JSON. Fully deprecating this (Supabase-only path) is partially done but the file-read code path remains active.

3. **Purification `purification_ratios` table needs ongoing maintenance.** Seeded with 8 tickers at launch. New halal ETFs entering the portfolio won't have a ratio and will fall back to 0% (no purification shown). Needs either a data-provider feed or a manual admin UI to add ratios.

4. **`mizan_purification_log` and `mizan_purification_overrides` live in `user_state`/localStorage only.** Unlike Sadaqah entries (which write to `mizan_sadaqah` in user_state via Supabase sync), purification state is only localStorage-mirrored. A new browser/device loses all purification history.
