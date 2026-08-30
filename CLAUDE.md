# MĪZAN — Elite Engineering Brief

> **SESSION PROTOCOL**: Read this file at the start of every session. Read `MIZAN-STATE-AUDIT.md` when you need architecture, schema, or feature status depth. Update `MIZAN-STATE-AUDIT.md` (last-audited date + any new findings) when you discover drift from what's documented. This file is the source of truth for how to work on Mizan correctly.

> **⚙️ OPERATING MODE — BOUNDED PUSH (owner decision, 2026-08-12).** Maintenance mode is **temporarily lifted for one defined push**, then resumes. Scope of the push, and nothing wider:
> 1. **Verification infrastructure** — Playwright E2E + visual snapshots. `@playwright/test` was installed and never configured, `@testing-library/react` has zero render tests, and there is no test account. Consequence: five user-facing surfaces shipped to production in one week without a human or a machine ever seeing them render, and a 320px clipping bug was caught by reading CSS rather than looking. **This is the first task and it gates the rest** — fixing UI without it repeats the same blind shipping, faster.
> 2. **UI/UX + accessibility** — audit against §5/§9 and fix what's real. The owner's goal is "user-friendly + UI".
> 3. **Read-only sweeps** — backlog triage (docs here over-claim; a prior sweep reclassified 5 "pending" items as shipped), security, quality.
>
> **Still out of scope during the push:** net-new features from the `N`/`M`/`P` buckets, anything touching the compliance boundary (§1 — no surface may ever emit a personalized buy/sell/hold recommendation), schema migrations (§8), and CSP changes. Those still need an explicit ask.
>
> **Return condition:** when the push's scope is delivered, restore the MAINTENANCE banner below verbatim and record the date. Do not let "bounded push" quietly become permanent open season — the maintenance discipline is what surfaced the two real bugs of 2026-08-10 (a dividend cron that had never once worked, and crypto being auto-blessed as halal), both found by looking rather than building.
>
> **⚙️ PRIOR MODE — MAINTENANCE (owner decision, 2026-07-07), resumes after the push.** Mizan is feature-complete for now. **Do NOT build net-new features or "improvements" on your own initiative.** Only do work that is one of: (1) driven by **real user feedback**, (2) a fix for **something actually broken or incorrect**, or (3) **explicitly requested by the owner**. The deferred feature backlog lives in `BACKLOG.md` (buckets `N`/`M`/`P` are parked; bucket `F` = fixes, the only class green-lit by default). When you notice a possible improvement, **add it to `BACKLOG.md` and move on — do not implement it and do not pitch it** unless it fixes a real defect. The goal is a stable app the owner isn't perpetually extending.

---

## 1. WHAT THIS APP IS

**MĪZAN** is a Sharia-compliant personal finance platform for Muslim investors. It is not a generic fintech app that happens to have a halal filter — Islamic compliance is the core product, not a feature.

**Core value propositions (in order of importance):**
1. Sharia-compliant portfolio screening (AAOIFI methodology, Finnhub data)
2. Zakat calculation with live nisab (gold/silver via Stooq)
3. Dividend purification tracking (impurity ratios per ETF, per-dividend log)
4. Unified brokerage + bank view (SnapTrade + Plaid)
5. AI with Islamic finance guardrails (Claude Sonnet via `/api/advisor` — **auth-gated**, per-user 60/hr): the chat advisor + **grounded-AI features** (fed only real data, explain-don't-judge, never invent a number). Shipped: plain-English Sharia-screening explanations. Roadmap: see memory `ai-roadmap` (Zakat guidance, portfolio insights, AI digest, per-token crypto). Reuse `/api/advisor` — don't build new AI plumbing. **Compliance boundary (2026-07-15):** the advisor is now governed by an in-code boundary drawing the read-only line at *personalization of advice* — it explains impersonal facts + the user's own data but must never generate a buy/sell/hold recommendation or suitability judgment. Enforced by `lib/compliance/advisor-prompt.mjs` (hardened prompt) + `advisor-filter.mjs` (output backstop). Any new AI feature MUST stay inside the three tiers — see `docs/COMPLIANCE.md` + memory `compliance-boundary-and-price-chart`. **Required gate — no exceptions:** before shipping ANY new grounded-AI feature (pending set: Zakat/purification guidance, portfolio insight card, AI weekly digest, per-token crypto screening, security-event explainer), it MUST pass a compliance-tier review — classify its output into the three tiers, route it through the hardened advisor prompt + `advisor-filter.mjs`, and confirm it emits no personalized buy/sell/hold recommendation or suitability judgment. **Owner posture (2026-07-15): stay COMPLIANT, NOT an RIA.** The trading-bot NL strategy generator + the Rebalancer are **self-directed** (`890d147`): the NL generator only structures user-named tickers (open-ended asks → impersonal model presets, never invented picks), the Rebalancer shows neutral your-target math (not "SELL — trim"), both carry a self-directed disclaimer. **Never let any surface emit a personalized pick.** Beta users trade LIVE semi-auto (they approve every real order = self-directed = compliant); **full-auto (discretionary) stays owner-allowlist-only via `canUseFullAuto` — never extend it to beta users (that is the RIA line).** See BACKLOG O23.
6. Goal templates rooted in Muslim financial life (Hajj, Mahr, Waqf, Emergency)

**Tone**: Professional, trustworthy, elegant. This is a tool for financially literate Muslims who care about both returns and deen. The design reflects that — light-first paper canvas with navy accents (green/red reserved for compliant/loss semantics), editorial typography, no noise.

**Stack:**
```
Frontend:  React 18 (JSX, not TypeScript) · Vite 5 · Recharts · Single-file SPA
Backend:   Node.js ESM · Vercel serverless (api/[...path].mjs) · lib/handlers.mjs
Database:  Supabase (PostgreSQL + Auth + RLS) · 24 migrations applied
Hosting:   Vercel (team: mizan-s-projects2) · prod URL: app.mizan.exchange (mizan-puce.vercel.app)
External:  SnapTrade · Plaid · Anthropic · Finnhub · Polygon · Stooq · Alpaca (paper)
```

---

## 2. ARCHITECTURE — WHAT LIVES WHERE

### Frontend (the monolith)
```
src/components/MizanApp.jsx   — 13,200+ lines. ALL views, ALL state, ALL charts.
                                 DO NOT split unless explicitly asked.
src/components/Goals.jsx       — Goals tab (extracted). Savings goals + DEBT PAYOFF TRACKER
                                 (manual/recurring/balance-linked debts, counting down to $0)
                                 + PAYOFF PLANNER (snowball/avalanche/riba-first, amortization,
                                 inline-SVG burn-down) + DEBT-PAYMENT AUTO-LINKING (detects a
                                 recurring payment via src/lib/recurring.js, links it, auto-advances
                                 paydown from posted transactions). Debts persist to mizan_debts.
                                 NOTE: personal debts live here; credit-card subscriptions/bills
                                 stay categorized in the Finances tab (don't move them into Goals).
src/components/PerformancePanel.jsx — Overview "RETURN & RISK" panel: money-weighted return
                                 (XIRR), realized/unrealized P&L split, risk metrics. Pure math
                                 in src/lib/performance.js.
src/components/Budgeting.jsx   — TOP-DOWN budget, on the Finances → Budget sub-tab.
                                 ONE monthly number, with category limits inside it:
                                   income = save + budget
                                   budget = Σ category limits + Everything else
                                   left   = budget + carried-in − spent
                                 Math in src/lib/budgetPlan.js (pure, tested); the
                                 month/category/pace primitives in src/lib/budgetCategories.js.
                                 ⚠️ REPLACED the ENVELOPE (zero-based) model on 2026-08-30, on
                                 the owner's explicit call after "the budgeting UI doesn't make
                                 sense to me very confusing". Envelope led with To Budget
                                 (income − everything assigned), which only means anything once
                                 you have accepted the method, and it was the biggest figure on
                                 the page. Origin/Copilot/Monarch all lead with the pair people
                                 actually ask about: what did I plan, what have I spent. Do NOT
                                 reintroduce To Budget or per-category carryover — the chain
                                 functions were DELETED, not left dormant, so there is exactly
                                 one definition of "what's left".
                                 **Everything else** is what makes this work on real data: the
                                 remainder of the budget is itself a bucket, so spending in a
                                 category nobody named still appears. Under envelope it was
                                 invisible unless you created a category for it.
                                 The monthly total + the rollover switch live in the TRACKED_KEY
                                 `mizan_budget_plan` ({rollover, months:{[m]:{total}}}) — NOT in
                                 budget_months, which has only manual_income; a column there is
                                 a migration and those need an explicit ask (§8). Category
                                 limits stay in budget_entries (migration 027); its `carryover`
                                 column is now vestigial and always written false. The flat
                                 `budgets` table and /api/budgets remain SUPERSEDED.
                                 ⚠️ Rollover is PATH-DEPENDENT: compute from the first planned
                                 month, never a mid-history window, or you get a plausible wrong
                                 balance. /api/budget returns the whole history for this reason.
                                 Rollover is ONE switch for the whole budget, not one per row —
                                 per-category carryover was seven decisions a month for a
                                 question most people answer once.
                                 A budget set in August is still the plan in September until
                                 changed (inheritedTotal), so a new month never opens empty.
                                 A ROW IS A STATUS LINE, NOT A FORM: icon + name + "$602 of
                                 $600" + bar, everything editable behind the row's own
                                 disclosure. The previous version put ROLL and EDIT on every row
                                 and three labelled inputs behind EDIT, which made the resting
                                 state of the screen data entry.
                                 Colour stays SEMANTIC and is PACE, not raw usage
                                 (budgetCategories.js paceStatus): 80% spent on the 3rd is an
                                 emergency, the same 80% on the 28th is fine, and a plain ratio
                                 paints both amber. Amber rows state the run-rate ("on pace for
                                 $413"); a finished month never projects. Category identity is
                                 carried by a GLYPH (categoryIcon), never a per-category colour
                                 — handing out green/red/amber as decoration would make a row's
                                 colour argue with its own bar (§5).
                                 Layout: summary rail beside the list at ≥900px, stacked below.
                                 Both live in THEME_CSS (.mz-budget-grid / .mz-brow) — an
                                 inline grid-template-columns outranks a media query and
                                 silently pinned desktop to one column once already.
                                 Budget figures go through mask().
                                 mizan_category_rules overrides the provider's taxonomy
                                 (merchant key beats provider category); mizan_category_groups
                                 groups rows for display (SORT → By group). Both TRACKED_KEYs,
                                 both store the RULE not the result, so a re-sync cannot undo a
                                 decision. Group subtotals are always the sum of their rows.
src/components/BillsCalendar.jsx — Bills calendar
src/components/ConnectionHealth.jsx — Account connection status
src/components/ComingSoon.jsx  — Coming soon placeholder
src/components/BugReportButton.jsx — Bug report widget
src/components/charts/PriceChart.jsx — Per-holding candlestick + volume price chart
                                 (lightweight-charts v5, dynamic-imported → own async chunk).
                                 Fed by the IMPERSONAL /api/market/candles. Timeframes 1D–5Y,
                                 optional live-quote line, neutral SMA/EMA/volume toggles labeled
                                 "DATA, NOT SIGNALS". HARD RULE: no buy/sell markers, no
                                 target/entry/exit price lines, no signal annotations.
src/components/charts/holdingsOverlay.js — Pure (no I/O). The user's executed BUY/SELL trades
                                 for a symbol → neutral chart markers. Powers the ACCOUNT_SERVICING
                                 overlay (+ a "Your average cost" line) on PriceChart. Display-only,
                                 privacy-gated, no judgments. See docs/COMPLIANCE.md.
src/components/CommandPalette.jsx — Cmd+K command palette
src/components/GuidedTour.jsx   — Interactive spotlight onboarding tour (replaced the old static
                                 FeatureTour). Guided lap through all 6 tabs: spotlight the nav
                                 button → navigate → spotlight a real on-tab element. Opens with a
                                 "Tour with sample data" (flips demo ON for the tour then restores the
                                 exact prior state; a module-load guard scrubs demo if a mid-tour
                                 tab-close orphans it — never persists demo for a real user) vs
                                 "Tour my account" choice. Gentle one-time TourNudge on Overview
                                 (yields to onboarding + name nudge); also launchable from the "?"
                                 dock / Cmd+K palette / Settings "Replay tour". Anchored via data-tour
                                 attrs in MizanApp.jsx (nav buttons, net-worth tile, Screener/Zakat
                                 tabs, advisor input, connect CTA) + a dataTour passthrough on
                                 BentoTile; seen-state synced via TRACKED_KEY mizan_tour_seen.
src/components/Login.jsx       — Auth page
src/components/LegalLayout.jsx — Legal pages
src/lib/auth.jsx               — Supabase Auth wrapper (TOTP MFA, session revocation)
src/lib/performance.js         — Pure portfolio analytics (XIRR/money-weighted return,
                                 realized/unrealized split, max drawdown/volatility/Sharpe).
                                 No React/DOM/storage. Tested: src/test/performance.test.js.
src/lib/recurring.js           — Pure recurring-transaction detection + debt-payment matching
                                 (normalize payee, cadence from median gap, score debt↔stream).
                                 Powers Goals debt-payment auto-linking. Tested: recurring.test.js.
src/lib/netWorth.js            — Pure net-worth composition (netWorthParts / hasSnapshotableData /
                                 isBrokeragePlaid) + mergeNetWorthHistory + NW_HISTORY_CAP. THE
                                 definition of net worth: brokerage + net bank + manual assets (Plaid
                                 investments only when SnapTrade is absent, or a dual-linked broker
                                 double-counts). Called by BOTH the Overview headline and the daily
                                 history snapshot — they used to each carry their own version and
                                 disagreed by $1.5k–$9.9k per user. **Also imported by
                                 lib/handlers.mjs** (the one client→server shared module) so the
                                 nightly cron and the in-app snapshot merge history identically.
                                 Any new net-worth surface calls this, never re-sums accounts.
                                 Tested: src/test/netWorth.test.js.
src/lib/notifications.js       — Pure in-app notification store + detectors (addNotifications /
                                 unreadCount / markRead / relativeTime / shariaChangeNotifications /
                                 dividendNotifications / priceAlertNotifications). Feed lives in the
                                 synced TRACKED_KEY `mizan_notifications`, rendered by the header
                                 bell (NotificationBell in MizanApp.jsx). **Detection must never be
                                 gated on Notification.permission** — it was, so users who never
                                 granted browser permission got no compliance/dividend/price alerts
                                 at all AND the dividend path never seeded its "seen" set. The OS
                                 toast is an optional extra channel built from the same copy.
                                 A notification's `nav` MUST be in NAV_TARGETS (top-level tabs only);
                                 sub-tab names render a blank page. Tested: notifications.test.js.
src/lib/ethicalOverlay.js      — Shared ethical/BDS overlay preference (useEthicalOverlay) +
                                 ethicalFlag(holding, on). Mirrors useScreenStandard: localStorage
                                 + a window event, so Screener, Holdings and Overview show the same
                                 flag. It was Screener-local `useState` until 2026-08-20, which is
                                 why `mapPosition` computed `h.bds_` for every holding and NOTHING
                                 read it. Don't convert it back to component state. See §4.
src/lib/userState.js           — localStorage ↔ Supabase state sync (mizan_debts is a TRACKED_KEY).
                                 `persistUserState` upserts the WHOLE value = last writer wins. For
                                 append-only keys use **`persistMergedUserState(key, mergeFn, local)`**,
                                 which re-reads the stored row and merges into it. A tab open since
                                 before the nightly cron once wrote its stale array back and discarded
                                 two months of backfilled net-worth history (2026-07-30).
src/lib/useKeyboard.js         — Global keyboard shortcuts
```

### Backend
```
api/[...path].mjs              — Vercel catch-all. Routes to lib/handlers.mjs.
lib/handlers.mjs               — 7,600+ lines. Every API route in one file.
lib/sharia.mjs                 — Sharia screening service (provider seam: Finnhub now, Zoya when ZOYA_API_KEY set). screenSymbol/screenBatch power /api/screen → governs h.sh_ app-wide
lib/market/candles.mjs         — Pure (no I/O): validation (symbol regex, resolution whitelist,
                                 bounded window) + Polygon→chart normalization for the price chart.
                                 Powers /api/market/candles. Unit-tested (market-endpoints.test.js).
                                 NB: the chart uses POLYGON for OHLC — Finnhub free tier has no /stock/candle.
lib/market/symbolSearch.mjs    — Pure (no I/O): query validation + Finnhub /search
                                 normalization for the Screener's ticker TYPEAHEAD.
                                 Powers /api/market/symbols (auth-gated, IMPERSONAL, own
                                 `marketdata.search` rate bucket, 6h response cache since
                                 company names are static). Finnhub /search IS on the free
                                 tier — verified live 2026-08-10, unlike the dividend
                                 calendar. Keeps dotted class shares (BRK.A). Name coverage
                                 is partial (a "toyota" search returns nothing), so
                                 suggestions degrade to empty and typing the ticker still
                                 works. **Never attach halal verdicts to the suggestion
                                 list** — a dropdown of names each stamped "Halal ✓" is a
                                 curated buy list, not a lookup. Tested: symbolSearch.test.js.
lib/compliance/policy.mjs      — The compliance boundary, in code. Three data tiers
                                 (IMPERSONAL / ACCOUNT_SERVICING / PROHIBITED), the prohibited-pattern
                                 list, and assertImpersonal(). Single source of truth for docs/COMPLIANCE.md.
lib/compliance/advisor-prompt.mjs — Hardened, server-owned /api/advisor system prefix
                                 (explain-don't-recommend; refuses personalized advice). Imported by
                                 /api/advisor AND /api/advisor/count. Replaced the old inline prefix.
lib/compliance/advisor-filter.mjs — Deterministic post-generation backstop: scans advisor output for
                                 personalized-advice patterns and rewrites to the compliant redirect;
                                 wired into /api/advisor; every flag audited as compliance_filtered.
lib/crypto.mjs                 — AES-256-GCM encrypt/decrypt. Env var is `ENCRYPTION_KEY` (NOT APP_ENCRYPTION_KEY). ✅ 2026-07-27: ACTIVATED in prod — `ENCRYPTION_KEY` is set (`ENC_ENABLED` true) and ALL 10 `user_snaptrade.snaptrade_user_secret` rows are encrypted at rest (ciphertext triple populated) with the plaintext column cleared to NULL (0 plaintext remaining, verified). `extractUserSecret` reads ciphertext-first; the plaintext fallback is now unused. Remaining hygiene: the now-empty `snaptrade_user_secret` column can be DROPPED (migration 017) after a small ciphertext-only code change (SNAP_SECRET_COLS / extractUserSecret / encryptedSecretFields still name it) — LOW priority since no plaintext values remain. ⚠️ STILL PLAINTEXT: `plaid_tokens.access_token` has NO encryption path (needs a new migration adding ciphertext cols to plaid_tokens + encrypt-on-store/decrypt-on-read) and `user_state`. (Prior finding, now superseded: 2026-07-12 the key was unset and SnapTrade secrets were plaintext.)
lib/anomaly.mjs                — 6 detectors: brute force, SnapTrade 5xx spike, cron staleness,
                                 new device, DATA_FEEDS (an upstream source dying quietly), and
                                 CONFIG_CHECKS/checkConfig — the credential preflight. That last one
                                 covers the outages no test or build can catch because the fault is
                                 configuration, not code: ALERT_FROM on an unverified domain (Resend
                                 403'd every email for days), an out-of-credits Anthropic account
                                 (Assistant down), an unset CRON_SECRET (fail-closed → whole fleet
                                 401s). It verifies the sender domain against the live Resend
                                 /domains list and spends ONE Anthropic token to prove the key is
                                 valid AND funded — presence alone proved nothing. All six run daily
                                 from /api/cron/cleanup and surface in Admin → db-status.
lib/alerts.mjs                 — Resend email: owner anomaly alerts + user emails (digest, re-auth, bug reports, invites) via a branded HTML shell (renderBrandedEmail, logo header). From = ALERT_FROM on the verified mizan.exchange domain
lib/rateLimit.mjs              — DB-backed rate limiting (increment_rate_limit RPC)
middleware.ts                  — Vercel Routing Middleware (repo ROOT, outside src/ and lib/ —
                                 easy to miss when grepping). Since 2026-05-25 (`540ffda`) it
                                 rewrites EVERY non-US visitor to /us-only.html on
                                 `matcher: "/:path*"` — a Canadian never reaches the app. The
                                 stated reason is Plaid, but the block is far wider than its
                                 cause. **A narrowing that blocks nothing (plus a currency guard
                                 and a US-only Tax-tab gate, adding lib/geo.mjs + src/lib/region.js)
                                 is BUILT AND TESTED on branch `region/canada-narrowing`** — parked,
                                 not merged: the owner deferred Canada on 2026-08-01 under
                                 maintenance mode. Production is still US-only. Do not rebuild it
                                 from scratch; check out that branch. See BACKLOG F10–F13/P3/U2.
lib/fetchWithRetry.mjs         — Retry wrapper with exponential backoff
lib/logger.mjs                 — Structured logging
lib/sentry.mjs                 — Sentry backend init
server.js                      — Dev server (Vite middleware + API on :3000)
```

### Verification (what actually proves the app works)
```
npm test              — Vitest, 644 unit tests. Pure functions + static contracts. Fast (~10s).
npm run test:e2e      — Playwright. Renders the real production build. NOT in `npm run build`.
npm run test:all      — both
npm run lint          — crash-focused ESLint (config/eslint.mjs). Wired INTO `npm run build`.

playwright.config.js  — 3 projects: desktop 1440x900, mobile-320 (320x720), phone-landscape
                        (667x375). The two phone projects set hasTouch:true — that is what makes
                        Chromium report `pointer: coarse`; without it every touch-target rule is
                        dead in the test browser and the suite passes by never evaluating them.
                        `serviceWorkers: "block"` is LOAD-BEARING — see §5 PWA notes.
                        Runs against `vite preview` over dist/, so what's tested is what ships.
e2e/support/app.js    — Boots the app SIGNED IN with zero credentials: seeds a fake Supabase
                        session into localStorage and answers every /api/** call from fixtures.
                        No test account, no rate-limit burn, no chance of writing to prod.
e2e/smoke.spec.js             — the app boots and renders
e2e/responsive.spec.js        — overflow/clipping across login + every tab + every SUB-tab at real
                                phone sizes, dock fit, header leaf-overlap, landscape sub-tab
                                height, --mz-vh resolution. See §5 Responsive.
e2e/mobile-and-privacy.spec.js— the two P0s from the 2026-08-13 UI audit (320px clipping, privacy
                                mode being decorative)
e2e/screener.spec.js          — the "screen any ticker" lookup + typeahead
e2e/budget.spec.js            — the top-down budget (setup state, Everything else absorbing
                                uncapped spend, row controls staying behind their disclosure,
                                privacy mode) + the five Finances destinations. Its fixtures and
                                assertions derive their month from the clock: hardcoding one
                                made the suite fail on the 1st for reasons unrelated to budgeting
src/test/*.test.js            — 32 files. Pure logic (zakat, netWorth, performance, recurring,
                                notifications, compliance…) plus two contract suites:
                                demoFixtures.test.js  — demo data is deterministic and self-consistent
                                pwaManifest.test.js   — manifest + iOS meta + splash matrix (§5)

scripts/generate-pwa-screenshots.mjs — manifest install screenshots (needs a preview server)
scripts/generate-ios-splash.mjs      — iOS launch images + their <link> tags; `--check` verifies
```
**The lesson that produced most of this** (2026-08-15): the fixture layer above had never worked — a service worker was bypassing `page.route()`, so specs passed *because* fixtures were inert. When you add a fixture-dependent test, **break the fixture once and confirm the test goes red.** A test that passes identically with and without its fixtures is not testing what it claims. Same applies to the guards themselves: every responsive and PWA guard here was mutation-tested, and that process caught a real hole (the responsive spec initially walked only top-level tabs and passed against a reverted sub-tab bug).

### Database (26 Migrations — all applied in prod)
```
001_init.sql                   — Core tables: user_snaptrade, user_state, user_keys, profiles
002_plaid.sql                  — plaid_tokens, plaid_accounts, plaid_transactions
003_ratelimit.sql              — rate_limits table + increment_rate_limit RPC
004_push.sql                   — push_subscriptions
005_polygon.sql                — polygon_cache (OHLC shared cache)
006_sessions.sql               — Session management RPCs (list/revoke)
007_cron.sql                   — cron_jobs ledger
008_nicknames.sql              — account_nicknames
009_budgets.sql                — budgets table
010_goals.sql                  — goals table
011_fix_plaid_cursor.sql       — Added transactions_cursor column (was missing, caused silent sync failures)
012_audit_log.sql              — audit_log table (append-only, 20+ action types)
013_rls_hardening.sql          — RLS gap patch
014_rls_hardening2.sql         — RLS gap patch 2
015_rls_audit_and_select_policies.sql — Pre-launch RLS audit confirming full coverage
016_encrypt_secrets.sql        — Added ciphertext/iv/auth_tag columns to user_snaptrade + user_keys (columns exist, but NEVER POPULATED — see crypto.mjs note above; ENCRYPTION_KEY unset so encryption never ran)
017_drop_plaintext_secrets.sql — INTENDED to drop plaintext secret cols, but the plaintext `snaptrade_user_secret` still exists AND is the only populated one. Effectively NOT in force. Do not trust "AES-256-GCM only now".
018_security_events.sql        — security_events table (DB-backed IP blocks)
019_purification.sql           — purification_ratios table (AAOIFI impurity %)
020_trading_bot.sql            — bot_strategies + pending_signals (owner/beta trading bot)
021_full_auto_per_account.sql  — account_full_auto (per-account Layer-3 opt-in, default false)
022_trading_bot_beta.sql       — profiles.trading_bot_enabled (beta allowlist) + trading_bot_consent_at
023_bot_strategy_type_dca.sql  — allow 'dca' (long-term accumulation) strategy_type in bot_strategies CHECK
023_email_digest.sql           — (note: TWO files share the 023 prefix — dca + email_digest)
024_etf_holdings_cache.sql     — service-role-only holdings cache for the ETF Overlap Analyzer
025_messages.sql               — in-app two-way support thread (user↔operator); service-role writes, RLS select-own. Powers Settings → Messages + Admin → Messages
027_envelope_budgeting.sql     — budget_entries + budget_months. CHECK pins `month` to the
                                 1st so one month can never split into two buckets. Supersedes
                                 013_budgets.sql. NB the filename: the envelope model it was
                                 written for was retired 2026-08-30 (see Budgeting.jsx above).
                                 The tables carry the top-down model's CATEGORY LIMITS
                                 unchanged; `carryover` is vestigial and always false. The
                                 monthly total lives in user_state, not here.
026_user_names.sql             — profiles.first_name + last_name (nullable) + handle_new_user trigger now copies them from auth metadata. Signup collects the name; every pre-026 account gets the `NameNudge` — a GENTLE bottom-right toast on Overview only (owner call: never a blocking modal), skippable 3× then skip-less. Skip count = synced TRACKED_KEY `mizan_name_prompt_skips`, so it's per-user not per-device. Writes go through POST /api/user/profile (service role — profiles has no user UPDATE policy, and one would expose is_root/suspended on the same row)
028_nav_usage.sql              — per-user destination counters (see §5 Information architecture)
029_alpaca_user_keys.sql       — per-user Alpaca PAPER credentials on `user_keys`: ciphertext
                                 triples for BOTH halves + `alpaca_key_last4` (cleartext, display
                                 only) + `alpaca_paper`. **There is deliberately NO plaintext
                                 `alpaca_secret` column** — finnhub/polygon keep one for pre-016
                                 backward compat, Alpaca has no such history, so an unencrypted
                                 trading credential has nowhere to land. `PUT /api/alpaca/keys`
                                 refuses when `ENCRYPTION_KEY` is unset rather than degrading to
                                 plaintext, and verifies the pair against paper-api before storing
                                 (a live key pair is rejected by the endpoint itself). Replaced the
                                 old Settings → API Keys Alpaca fields, which wrote to the
                                 **plaintext** `mizan_keys` blob in user_state that the server never
                                 read for Alpaca. Credentials are managed in Trade → Order Ticket.
                                 Guarded by src/test/alpacaKeys.test.js.
```

---

## 3. DATA FLOW — HOW INFORMATION MOVES

```
SnapTrade  ──→  /api/snaptrade/accounts + holdings + activities
               ──→  snapAccounts + snapActivities state  ──→  localStorage cache
               
Plaid      ──→  /api/plaid/accounts + transactions (cursor-based sync)
               ──→  plaidAccounts + bankBalance state  ──→  localStorage cache

Supabase   ──→  auth session (via src/lib/auth.jsx)
               ──→  user_state (goals, zakat settings, watchlist, purification log)
               ──→  net worth history snapshots (nightly cron)

Live prices ──→  Polygon WebSocket + Finnhub polling
                ──→  live[] state
                ──→  merged into positions via mapPosition()

Finnhub    ──→  /api/finnhub/* (news, earnings, profile, dividends, quote)
               ──→  holdings accordion data (cached 30min client-side)

Stooq      ──→  /api/metals/spot (CSV proxy)
               ──→  Zakat nisab calculation

Anthropic  ──→  /api/advisor (POST, streaming)
               ──→  AI Advisor chat with portfolio context injected
```

**Critical rules:**
- ALL API calls go through `apiFetch()` — never raw `fetch()` (apiFetch injects auth headers)
- Live price state is shared at the top of MizanApp.jsx — never fetch prices inside sub-components
- All localStorage reads/writes for user state go through `src/lib/userState.js`

---

## 4. ISLAMIC FINANCE DOMAIN KNOWLEDGE

Understanding these concepts is required to work on Mizan correctly. Financial engineers unfamiliar with Islamic finance often get these wrong.

### Sharia Compliance
- **Riba**: Interest. Prohibited. This is why we screen bonds, REITs with debt, and check financial ratios.
- **Halal screening** has two layers:
  1. **Business activity screen**: Does the company earn revenue from prohibited sectors (alcohol, pork, weapons, gambling, tobacco, adult entertainment, conventional finance)?
  2. **Financial ratio screen**: Is the company's debt ratio below the AAOIFI threshold (debt/market cap < 33%)? Impermissible income ratio < 5%?
- **`h.sh_` field** in holdings state = Sharia status: `"halal"` / `"review"` / `"haram"` / `"unlisted"`
- **Single screening source of truth**: `h.sh_` is governed by the server screening service (`lib/sharia.mjs` via `/api/screen` — provider-dispatched: Finnhub now, Zoya when `ZOYA_API_KEY` is set). A root effect screens real holdings into `shariaScreen` state; `mapPosition` reads the live verdict (hardcoded `SHARIA_MAP` is only the instant fallback while it loads). Screener tab, Overview compliance, Rebalancer halal-mode, and Purification all read this one verdict — no more divergence.
- **Crypto is never auto-classified.** `screenSymbol` returns `review` (not `halal`) for known tokens with NO standard marked pass, because the AAOIFI ratio engine has nothing to evaluate on an asset with no balance sheet. It used to return `halal` with all seven standards green; the client masked that for HELD crypto only, so any path without connector data (the ad-hoc lookup) saw the raw verdict. Fixed at the source 2026-08-10 — don't reintroduce a client-side-only override. Per-token verdicts are BACKLOG N6.
- **The Screener screens ANY ticker, not just holdings** (2026-08-10, from user feedback). `/api/screen?symbol=` has always taken an arbitrary symbol; the Screener tab now has a lookup box for symbols the user doesn't own. It is IMPERSONAL (Tier 1) and must stay that way: **one symbol in, one verdict out.** Never add ranking, sorting by desirability, or a curated "picks" list — that converts an impersonal fact into a personalized recommendation and crosses the RIA line. Lookup results are deliberately kept OUT of the holdings `results` cache (it feeds the freshness label and the compliance-change notification baseline).

### Zakat
- **Nisab threshold**: Minimum wealth before Zakat is due. Two standards: gold (87.48g) or silver (612.36g). User can toggle.
- **Hawl**: One lunar year must pass before Zakat is due on accumulated savings (not yet implemented — tracked in gap list).
- **2.5% rate** applies to most zakatable assets.
- Live gold/silver prices from Stooq via `/api/metals/spot`.
- **Comprehensive worksheet (2026-07-13)**: the Zakat tab is a full asset-by-asset worksheet mirroring the authoritative scholar calculators (DarusSalam Seminary, Sacred Learning). It has a **connected-account checklist** (like the Goals account picker) where the user ticks which brokerage/retirement/bank accounts count toward Zakat and unticks any they don't; plus manual rows for anything not connected: cash on hand, stocks/funds elsewhere, retirement, gold & silver, business assets/inventory, resale property, accounts receivable, loans receivable — minus short-term debts, long-term debt due, salaries owed. `Net zakatable = assets − liabilities`, ×2.5% once above nisab. Stored in `mizan_zakat_worksheet` (synced TRACKED_KEY; the picker's unticked ids live in `worksheet.excludedAccounts`); seeded once from existing manual assets. The **Overview ZAKAT DUE tile and the tab read the same worksheet + same picker selection** via `computeZakatWorksheet` (`src/lib/zakat.js`) and the shared `zakatConnectedAccounts()` / `zakatSelectedTotals()` helpers, so they never diverge. Credit/loan accounts are excluded from the picker (they're liabilities → the debt rows); investment-class accounts (brokerage + retirement + investments) get the factor, bank/depository counts as full-value cash.
- **Tab layout (GoalsHub)**: the "Plan" nav tab has sub-tabs **Goals · Zakat · Sadaqah · Retirement/FIRE**. Zakat and Sadaqah were split (2026-07-13) — one `ZakatSadaqah` component driven by a `view="zakat"|"sadaqah"` prop, mounted twice by GoalsHub. Zakat view = hero + worksheet + methodology + purification; Sadaqah view = given/pledged tiles + charity log. Dividend Purification stays under Zakat (its "Mark Purified" still writes to the `mizan_sadaqah` log the Sadaqah tab reads).
- **Default investment method is now `full` value** (was `longterm_30`), matching those scholar calculators which count shares AND vested retirement at full value. The 30% long-term rule is still available via the methodology toggle (opt-in, applies only to investment-class rows: brokerage + stocks + retirement). Cash, metals, receivables, business assets always count at full value.

### Ethical / BDS overlay (shipped 2026-07-02, hardened 2026-08-20)
An **optional, opt-in** layer that flags holdings named on third-party divestment lists. It is **not a Sharia ruling** and must never become one — it never touches `h.sh_`, never enters `halalPct`, and never enters the allocation donut. Folding it into the compliance number would restate one methodology as another.

- **Attribution is the whole design.** `ETHICAL_EXCLUSIONS` in `lib/sharia.mjs` maps ticker → `{ sources[], activity }`, and `ETHICAL_SOURCES` carries each body's name/url/version. Every `reason` string reads "*activity* — listed by *body*". **Never reword an entry into Mizan's own voice, and never add a ticker without a citable listing.** A wrong ticker here is a false public claim about a real company — that is the only failure mode that actually matters, and `src/test/ethicalScreen.test.js` fails the build if any entry loses its attribution.
- **Sources:** [UN OHCHR settlement-business database](https://www.ohchr.org/en/business/bhr-database) (Sept 2025 update — 158 enterprises, 11 countries) and [AFSC "Investigate"](https://investigate.afsc.org/). Neither is machine-readable, so **this cannot be crond.** Instead `ETHICAL_RECONCILED` + `ETHICAL_REVIEW_DAYS` (180) drive `checkEthicalListReview()` in the daily cleanup sweep, which emails the owner once it lapses — same pattern as `checkLegalReview`.
- **Reconciling means removing, not just adding.** OHCHR dropped 15 enterprises in one pass for ceasing the listed activity. A name left on after it is de-listed is worse than a name missing.
- **Deliberate omission:** OHCHR is majority Israeli-domiciled banks/telecoms/transport. Some have US listings, but unverified name→ticker mappings are omitted rather than guessed.
- Surfacing: Screener (pill + attributed banner), Holdings (pill beside the Sharia tag), Overview (count on the CONFIRMED HALAL tile). Default **off**; the pref is `mizan_ethical_overlay`, a TRACKED_KEY. Guarded by `e2e/ethical-overlay.spec.js`, including the overlay-OFF direction.

### Dividend Purification
- When a halal company earns a small portion of revenue from haram sources, the dividend is "impure" by that percentage.
- **Purification** = donate `dividend × impurity_pct / 100` to charity, not to yourself.
- `purification_ratios` table has per-ticker impurity percentages (seeded for 8 ETFs).
- `PurificationPanel` in Goals tab shows per-dividend log with "Mark Purified" / "Purify All" actions.
- Scholar disclaimer: "Purification amounts are estimates based on AAOIFI guidelines. Consult a qualified scholar for your specific situation."

### Goal Templates
- Hajj, Mahr (bridal gift — Islamic obligation), Home, Emergency Fund, Education, Business, Waqf (charitable endowment).
- These are pre-filled goal templates. The underlying `goals` table is generic — the templates just pre-populate name + suggested target.

---

## 5. DESIGN SYSTEM — NON-NEGOTIABLE

### Color Tokens (from `const T` in MizanApp.jsx)
```javascript
T.blue     = "#1e4e8c"   // Navy — primary accent, CTAs, links, active states (NOT blue-named-but-gold anymore — rebranded 2026-06-24)
T.blueDim  = "#15396b"   // Navy dim — gradient ends, secondary buttons
T.gold     = "#b8842a"   // Amber — warnings, Zakat amounts, Sadaqah ONLY (no longer the brand accent)
T.gain     = "#117a52"   // Green — halal / positive / gain / compliant
T.loss     = "#b23a3d"   // Red — haram / error / loss / negative
T.slate    = "#6b7b88"   // Slate — unscreened / neutral / pending
T.violet   = "#7e6ba8"   // Violet — crypto / alternative assets
T.textHi              // High-emphasis text (paper white in dark mode)
T.text                // Body text
T.muted               // Low-contrast captions, secondary labels
T.dim                 // Borders, dividers
T.surface             // Card/tile background
T.bg                  // Page background
T.border              // Standard border color
```

**Rule**: Never introduce new hex values. Every color decision must reference `T.*`. If a color doesn't exist in T, use the closest semantic match.

### Typography
```
FU = "Fraunces"       — Display: hero numbers, big stat values, section headings
FP = "IBM Plex Sans"  — Body: descriptions, paragraphs, form labels
FM = "IBM Plex Mono"  — Labels: ALL tickers, chips, pills, eyebrows, numbers in tables,
                         percentages, dates, badges, button text, nav labels
```

**Font usage rules** (these are absolute):
- `FM` on EVERY label, eyebrow, tag, ticker, numeric in a table — gives the app its editorial financial feel
- `FU` on hero stats only (portfolio total, large percentage gains, section headings ≥20px)
- `FP` on all readable prose — descriptions, tooltips, explanatory copy
- `fontVariantNumeric: "tabular-nums"` on ALL numeric displays to prevent layout shift

### Spacing
All spacing uses `T.s1`–`T.s12` (4px–48px scale). Never hardcode `padding: 16px` etc. Use `T.s4`, `T.s6`, etc.

### Components
```
<BentoTile>         — Every content tile/card. 2px top accent bar, hover lift, click press.
                       DO NOT use raw <div> as a card container.
<CollapsibleTile>   — A BentoTile with an always-visible title+subtitle header that folds its
                       body (state persists per storageKey in localStorage as mizan_ct_<key>).
                       Use for SECONDARY/advanced panels so long views stay short but every
                       feature stays discoverable by its header. `flat` variant = header bar,
                       no card wrapper — for wrapping a panel that already renders its own card(s).
                       Defined right after BentoTile in MizanApp.jsx. Used across all 6 tabs.
<BentoRow>          — Grid row within a bento layout. CSS grid with border-gap technique.
className="glass"   — Chrome only: nav bar, tab bar, modals, floating overlays
className="glass-strong" — Stronger blur: modal overlays
className="bento"   — Layout container for bento tiles
className="btn-primary" — Primary CTA button (gold gradient)
className="btn-ghost"  — Ghost button (transparent, bordered)
```

**Glass rule**: `glass` and `glass-strong` are for chrome surfaces ONLY. NEVER apply to data tables, stat cards, charts, or bento tiles containing financial data.

### Responsive & touch (added 2026-08-15)
Mizan is an installable PWA used on phones. Two rules drive everything here:

**1. Viewport height goes through `var(--mz-vh)` — never a bare `100vh`.** On a phone `100vh` is the URL-bar-*retracted* height, so a `100vh` box is always taller than the visible area and every `calc(100vh - X)` budget under-reserves. `--mz-vh` is `100vh` upgraded to `100dvh` via `@supports`, declared in **both** THEME_CSS and `index.html` (Login, the legal pages and the error boundary render outside MizanApp, so THEME_CSS never loads for them). Also: **min-height beats max-height in CSS** — don't pair a viewport-relative floor with a viewport-relative cap, they will contradict each other on some screen size (`minHeight:60vh` + `maxHeight:calc(100vh-280px)` made the cap dead on every phone under 700px tall).

**2. Touch rules key on `@media (pointer: coarse)`, NOT on width.** A landscape phone is **568–932px wide with 320–430px of height**, so it sails past every `max-width` breakpoint while still being a fingertip. Width-keyed rules are why sub-tabs measured 40px in portrait and 33px in landscape on the same device. There is a `@media (max-height: 500px) and (orientation: landscape)` block for the short-viewport case.

Helper classes (all no-ops on a mouse):
```
.mz-tap        min-height:44px on touch — for a small inline-styled control
.mz-chip-row   applies it to every button inside a filter/chip row
.mz-range-row  the net-worth chart's range chips (wraps at narrow widths)
.mz-ctrl-row   a control group that must wrap rather than overflow
```
**Do NOT "expand the hit area" with a 44px `::after` while leaving the box small.** It was tried and reverted: in a chip row — especially a wrapping one — the invisible regions overlap and the last-painted one wins, so chips got 8–20px of usable reach (less than their own box) and taps landed on the wrong chip. Give controls real height.

Two traps that make defects here invisible: `html{overflow-x:clip}` means over-wide content is **silently clipped, never scrollable** (no scrollbar to notice), and flex parents can report honest non-overlapping rects while their *children* paint on top of each other. Both must be measured, not eyeballed. `e2e/responsive.spec.js` guards all of it across login + every tab + every sub-tab; `playwright.config.js` sets `hasTouch: true`, which is **what makes Chromium report `pointer:coarse`** — without it the touch rules never evaluate and the suite passes by not testing them.

### Legal documents (added 2026-08-18)
**The web page is the source of truth. The PDF is a rendering of it.** They used to be maintained separately and drifted — see the audit doc for what that cost.

- **All five** policies are React pages — `/privacy`, `/terms`, `/security`, `/data-retention`, `/access-controls` (`src/components/Privacy.jsx`, `Terms.jsx`, `Security.jsx`, `DataRetention.jsx`, `AccessControls.jsx`). **Edit these.** The old `/legal/*.pdf` URLs still resolve, so anything linking to them (Plaid's compliance review) keeps working.
- `legal/*.pdf` + `public/legal/*.pdf` for Privacy and Terms are **generated, never hand-edited**: `npm run build && npx vite preview --port 4173 --strictPort &` then `npm run gen:legal-pdfs`. Both copies are written together, since they must not diverge.
- The "last updated" date comes from **`LEGAL_LAST_UPDATED` in `src/lib/legal.js`**, which the pages render *and* the review reminder reads. Don't hardcode a date into a page; two dates that can disagree eventually do.
- **Quarterly review** (90 days) runs inside the daily `/api/cron/cleanup` sweep via `checkLegalReview()` and emails the owner when overdue. It rides the daily cron because the Vercel plan allows only daily schedules, and because a reminder derived from the document's own date can't drift from it.
- `src/test/legal.test.js` asserts the claims that can be checked mechanically. **When a feature changes what data is collected, stored or sent to a third party, update the policy in the same commit** — the 2026-08-18 review found the policy claiming transactions weren't stored while 2,039 rows sat in the database, and omitting Anthropic while the Assistant sent holdings to it. Both were features shipping after the policy was written.

### Type scale — fluid, and in rem (added 2026-08-18)
**Never write a bare px font size.** Use the `--fs-*` tokens in THEME_CSS (`--fs-2xs` … `--fs-6xl`); all 1,260 call sites were migrated off px. Each is a `clamp()` interpolating between a 320px and a 1440px viewport, so type is in tune at every width instead of jumping at breakpoints.

They are in **rem, not px, and that is load-bearing**: a px clamp adapts to the viewport but ignores the reader. Measured — `--fs-2xs` goes 11.06px → 13.75px when the root moves 16px → 20px, while a hardcoded 10px stays 10px forever. "Readable on any device" includes someone using iOS Dynamic Type.

**The floor is 11px** (`--fs-2xs`). The app used to render 39% of its type at 9–10px, under the ~11px Apple and Google both treat as the minimum for secondary text — that, more than any layout bug, is why it read as dense. `e2e/responsive.spec.js` walks every tab asserting nothing renders below 10.9px. If the dock or a strip overflows once labels reach the floor, **fix it with padding, never by shrinking type back under the floor.**

**One deliberate exception:** the iOS focus-zoom rule (`.field`, `input,select,textarea`) stays a literal `16px`. Safari zooms whenever a focused field computes under 16px, and a rem token drops below that the moment a reader *lowers* their OS text size. That is a browser behaviour threshold, not a design token — don't "tidy" it into the scale.

### Information architecture (added 2026-08-18)
6 top-level tabs · 25 destinations · **max depth 2**. Guarded by `e2e/responsive.spec.js`.

- The **"Plan"** tab's nav id is still `goals`. The label changed; the id must not — `localStorage.mizan_nav`, the `?tab=` deep link, the manifest shortcut, `nav_usage` paths and every `data-tour` hook are keyed on it.
- **Portfolio is one flat strip of 9.** It used to end in "Tools", which revealed a second strip — the app's only depth-3 branch, behind a label describing none of its five unrelated contents. Do not reintroduce nesting; the strip scrolls with snap.
- **Finances is a strip of 5** (Accounts · Budget · Spending · Recurring · Transactions), split 2026-08-25 from a single scroll of SEVEN stacked sections, each with its own state and several with their own modals. Grouped the way Copilot and Monarch group the same surface. **A section that becomes a destination owes the reader an empty state** — on one scroll an empty section simply did not appear; behind a tab it is a blank screen you clicked into. Recurring, Spending and Transactions each gained a `<ComingSoon pending>` fallback for exactly this, and `e2e/budget.spec.js` fails if any pane renders under ~80 characters.
- `nav_usage` (migration 028) counts destinations per user — **counters, not an event log**, so there is no timeline and nothing financial. Use it to answer whether Backtest / ETF Overlap earn their slots rather than deciding by taste.
- **Every `<TabBar>` needs a `track` prefix** (`track="portfolio"` → records `portfolio/backtest`). Without it that strip is silently uncounted. This is not hypothetical: for its first day `recordNavView` was wired only into the top-level `setNav`, so sub-tabs recorded nothing and the feature could not answer its own question. `e2e/responsive.spec.js` guards it.

### PWA install surface (added 2026-08-15)
`public/manifest.webmanifest` + the iOS meta block in `index.html`. Guarded by `src/test/pwaManifest.test.js` — read its failure messages before changing either file.

**Three rules that are easy to break silently:**
1. **`id` must stay byte-identical to `start_url` (`/?source=pwa`).** With `id` absent the computed identity IS start_url, so every existing install is keyed on that string. "Tidying" it to `"/"` makes Chrome treat this as a *different app*: existing installs stop updating and reinstalling creates a duplicate.
2. **Never restore `apple-mobile-web-app-status-bar-style: black-translucent`.** It forces the status bar's clock/battery/signal to render white over the page background, and the default face is the paper canvas — an invisible status bar for every light-theme user on iOS. Apple has deprecated the value too.
3. **Screenshots are load-bearing.** Chrome's richer install UI needs ≥1 `screenshots` entry per form factor, same aspect ratio within a factor, both dimensions 320–3840px, longest side ≤2.3× shortest. Break any of it and Chrome *silently* drops to the plain prompt. Regenerate with `npm run build && node scripts/generate-pwa-screenshots.mjs` (runs in demo mode deliberately — the alternative is install screenshots of three empty states).

**iOS launch images** live in `public/splash/` (22 files, ~836KB) and are referenced by 22 `apple-touch-startup-image` tags in `index.html`. Android needs no equivalent — Chrome synthesises a splash from `background_color` + icon; iOS synthesises nothing, so without them an installed app shows a blank white screen until React paints. **Generated, never hand-edited:** `node scripts/generate-ios-splash.mjs` writes the PNGs and prints the tags; `--check` verifies existing files. Safari matches a launch image only if its media query fits the device *exactly*, so a wrong-sized or missing file is ignored in silence — the test parses each query and holds the file to it. Portrait only (landscape would double the matrix for a case that barely happens and degrades to a plain background). Dark variants key off `prefers-color-scheme`, which follows the **system** appearance while Mizan's theme lives in localStorage — a user forcing the app dark on a light phone still gets the light splash, and that is unavoidable.

Manifest `shortcuts` depend on the **`?tab=` reader** in MizanApp's `nav` initialiser, which validates against the real tab list and strips the param with `replaceState`. Add a shortcut for a tab that reader doesn't accept and it silently lands on whatever localStorage held — the test pins this.

**`serviceWorkers: "block"` in `playwright.config.js` is not optional.** The suite runs against the production build, which registers `/sw.js`, and **SW-issued requests bypass `page.route()`** — with it removed, every `/api/**` fixture in `e2e/support/app.js` goes to the real server, returns `index.html` via the SPA rewrite, and each surface falls back to its empty state. That was the actual state of the suite until 2026-08-15: fixtures inert, most specs passing *because* of it. If you ever need to test the SW itself, do it in a dedicated spec that opts back in.

### Theming
Both light and dark themes must work. **Light is the default/primary face** = `data-theme="light"` (paper canvas `#faf8f4` bg, ink `#1c1b19` text). Dark = `data-theme="dark"` (**midnight-navy** base `#0e1626` — the cool inverse of the warm paper, aligned to the navy accent; warm-ivory `#f4f2ec` text). The old warm "ink/chocolate" dark base (`#1c1b19`) was replaced 2026-06-28. New users default to light (`themeMode="light"`). When adding a new UI surface, test both themes mentally — most `T.*` tokens adapt automatically. Note: `T.blue`/`T.gold`/`T.gain`/`T.loss` are hex *literals* (the codebase composes opacity as `${T.blue}40`), so they're tuned for the light theme; navy-as-small-text on the navy dark theme is still the weak spot (would need a var refactor to make accents per-theme — the brand mark itself is now fixed via the theme-swapped `mark-light.png`). **Bento tiles use a translucent fill** (`--mz-tile-fill`) so the fixed `ميزان` canvas watermark reads through them — don't restore an opaque tile background.

---

## 6. STATE MANAGEMENT PATTERNS

### Global State (in MizanApp.jsx)
```javascript
// Source of truth for portfolio data
snapAccounts      // SnapTrade accounts array
snapActivities    // SnapTrade transaction history
plaidAccounts     // Plaid bank accounts
bankBalance       // Plaid total balance
live              // Live price quotes { [ticker]: { c, pc, dp } }
user_state        // Supabase key/value store (goals, settings, purification)

// Derived in useMemo hooks — never stored separately
merged            // Holdings with live prices merged in via mapPosition()
tot               // Total portfolio value
gain / gpc        // Unrealized gain / gain percent
```

### The `mapPosition()` Pattern
Merges stored SnapTrade positions with live Finnhub/Polygon quotes:
```javascript
const merged = useMemo(() => snapAccounts
  .flatMap(a => a.positions || [])
  .map(h => mapPosition(h, live))
, [snapAccounts, live]);
```
`mapPosition()` resolves: quantity, current price (from `live[]` or stored), market value, cost basis, P&L. NEVER compute these inline — always use `mapPosition()`.

### Symbol Normalization
SnapTrade symbols come in three shapes. Always use the helpers:
```javascript
// Inside ActivityPanel:
fmtSym(activity)           // Resolves string | {symbol:"X"} | {symbol:{raw_symbol:"X"}}

// Inside TaxPlanner:
normSym(symbol)            // Same logic, local to TaxPlanner

// NEVER do: activity.symbol.symbol or activity.symbol?.raw_symbol directly
```

### Financial Formatters (ALWAYS use these)
```javascript
fmtUSD(n)          // "$1,234.56" — standard currency
kf(n)              // "1.2K" / "1.2M" — compact notation for large numbers
f$(n)              // Short dollar format for display tiles
fp(n)              // Percentage formatter
mask(value)        // Apply privacy mode — REQUIRED on all portfolio values shown to user
```

**Rule**: Never use `n.toFixed(2)` in JSX. Never show raw numbers. Use the formatters. Use `mask()` on every financial value the user can see.

---

## 7. PROACTIVE ENGINEERING BEHAVIORS

Do these WITHOUT being asked:

**Code correctness:**
- After every edit to MizanApp.jsx, run `npm run build`. If it fails, fix before reporting done.
- When fixing a calculation, grep for all other places the same calculation exists — it often lives in Overview, Holdings, and a sub-component separately.
- Check both `live[sym]` and the stored `h.price` fallback whenever touching price logic — live prices may not have loaded yet.

**Data integrity:**
- Flag synthetic/fake data displaying as real. Audit any `sparkline`, `trend`, or `chart` that might be fabricated.
- When adding a range filter, update: (1) chart cutoff, (2) gain calculation, (3) UI label — all three must stay consistent.
- Any Supabase query must destructure `{ data, error }` and check `error`. Silent failures are production bugs.

**Design consistency:**
- Before adding any color, verify it exists in `T.*`.
- Before adding any font reference, verify it uses `FU`, `FP`, or `FM`.
- Every new tile is `<BentoTile>`, not a raw div.
- Every new number goes through a formatter and `mask()`.

**Security:**
- New API routes must call `apiFetch()` from the client.
- Server handlers must check auth before processing (follow the `const { user } = await requireAuth(req)` pattern in handlers.mjs).
- Never log user tokens, secrets, or access tokens.

**Progressive disclosure:**
- Empty states: every data panel must have a loading state and an empty state (no blank white areas).
- Error states: network errors should show a retry button, not just disappear.

---

## 8. WHAT CLAUDE MUST NOT DO WITHOUT EXPLICIT INSTRUCTION

These are architectural commitments. Undoing them would break the app or violate the design contract:

- **Split MizanApp.jsx** — it is intentionally monolithic. If extraction is needed for a specific component, user will ask explicitly.
- **Change the font stack** — Fraunces + IBM Plex Sans + IBM Plex Mono is intentional and final.
- **Add new color tokens** — use existing `T.*` palette. The paper-canvas + ink + navy (accent) + green/red (semantics) palette is the brand, with amber/gold reserved for Zakat & warnings only.
- **Use Tailwind or CSS Modules** — all styling is inline with `T.*` tokens + the THEME_CSS string injected at mount.
- **Add external npm packages** — ask first. Bundle is already 360KB gzipped. Every dependency must justify itself. (Approved additions to date: `lightweight-charts` v5, 2026-07-15, for the holdings price chart — dynamic-imported so it stays out of the initial bundle; `@vercel/speed-insights` v2, 2026-07-20, mounted in `src/main.jsx` via the `/react` entry — same-origin beacon, no CSP change, ~0.8KB gz.)
- **Add new Supabase migrations** — schema changes require explicit ask. Always discuss before adding columns/tables.
- **Rename CSS classes** — `.bento`, `.glass`, `.glass-strong`, `.btn-primary`, `.btn-ghost` etc. are used throughout. Renaming breaks unrelated components.
- **Introduce TypeScript** — this is intentional JavaScript. Type safety comes from JSDoc and runtime validation.
- **Add analytics/tracking code** — no event tracking without explicit user instruction.
- **Change the CSP headers in vercel.json** — security configuration needs deliberate review.
- **Order Ticket gating** — ⚠️ CORRECTED 2026-08-19: the `{false && ...}` wrapper described here **no longer exists** (0 occurrences in the file). The ticket now gates on `!isAdmin && <ComingSoon>` at `MizanApp.jsx:7098`, i.e. **it already renders live for admin users**. Do not go looking for a second gate to remove — there is one, and it is the admin check. Activating for everyone means changing that condition deliberately, not deleting a dead `false`.

---

## 9. QUALITY GATES — EVERY TASK

A task is not done until ALL of these pass:

### Build check
```bash
npm run build   # Must exit 0 with no errors
```

### UI quality checklist
- [ ] All colors from `T.*` — no hardcoded hex
- [ ] All fonts are `FU` / `FP` / `FM` — no system fonts on financial data
- [ ] All numbers go through `fmtUSD()` / `kf()` / `fp()` and `mask()`
- [ ] `fontVariantNumeric: "tabular-nums"` on all numeric displays
- [ ] Loading state handled (skeleton or spinner)
- [ ] Empty state handled (no blank div)
- [ ] Error state handled (user-visible message, not silent)
- [ ] Works in both light and dark theme
- [ ] No NaN, undefined, or "[object Object]" visible to user

### Responsive / touch checklist (added 2026-08-15)
Run `npm run test:e2e` — it covers all of this automatically. Check by hand only when adding a surface the specs don't reach yet.
- [ ] Nothing overflows at **320px** — `html{overflow-x:clip}` means over-wide content is silently CLIPPED, never scrollable, so this is invisible by eye
- [ ] Control groups `flex-wrap` rather than relying on `flexShrink:0`; grid cells that hold inputs get `minWidth:0` (a grid item won't shrink below its content's min-content width, and Chrome gives `<input type=date>` a big one)
- [ ] Viewport heights use `var(--mz-vh)`, never a bare `100vh`; never pair a viewport-relative min-height with a viewport-relative max-height
- [ ] Landscape checked — a landscape phone is **568–932px wide with 320–430px of height**, so it escapes every `max-width` breakpoint
- [ ] Touch targets ≥44px via `@media (pointer: coarse)` (`.mz-tap` / `.mz-chip-row` for small inline-styled controls) — not via a `::after` hit-area hack, see §5
- [ ] New tab or sub-tab: confirm the responsive spec walks it

### Financial accuracy checklist
- [ ] Values match what the underlying data source provides
- [ ] No synthetic/fabricated data that could be mistaken for real portfolio data
- [ ] Range filters affect all three: chart, gain display, and label
- [ ] Sharia status uses `h.sh_`, which now flows from the live `/api/screen` verdict (`shariaScreen` state) with `SHARIA_MAP` as fallback — all surfaces share it

### Security checklist (for new API routes)
- [ ] Auth check via `requireAuth()` before any data access
- [ ] Rate limit applied via `checkRateLimit()`
- [ ] Input validated before DB query
- [ ] No secrets or tokens logged

---

## 10. KNOWN LIMITATIONS — DO NOT RE-SURFACE AS BUGS

These are documented constraints, not undiscovered issues:

1. **Chart granularity is range-dependent** (Overview hero chart):
   - **1D** = real-time 24h curve from a **client-side rolling buffer** (`mizan_intraday` in localStorage). The capture effect appends the live `tot` (throttled ~2min, capped to last 24h) and seeds point 0 from yesterday's nightly snapshot. Only accrues while the app is open; gaps are bridged by the line. Never captures in demo mode.
   - **1W** = real-time daily curve for the current week (Sunday → today) built from `mizan_networth_history` daily snapshots, with today's point pinned to the live `tot`.
   - **1M / 3M / YTD / 1Y / All** = **monthly buckets** from deposit activity + nightly net-worth snapshots (no sub-month granularity for long ranges — this is intentional).
   - The X-axis + tooltip formatters adapt per range (time → weekday → month).
   - **All ranges share ONE bank-inclusive series** (`NW_HISTORY_KEY` = `mizan_networth_history`, entries `{date, total}`), written by both the client snapshot effect and the nightly cron via `src/lib/netWorth.js`. Fixed 2026-07-30: the client used to write brokerage-only totals while the tip was pinned to the bank-inclusive `tot`, so the whole non-brokerage balance landed in the range gain. **Never introduce a second net-worth series, and never gate a snapshot on `total > 0`** — negative net worth (debt > investments) is legitimate and those users need the line most.
   - The shape *between* snapshot points is interpolated from **brokerage** deposit activity only — `canonicalActivityType` normalizes SnapTrade cash-in (`CONTRIBUTION` → `DEPOSIT`), but Plaid bank transactions do not feed the contribution model. Affects the curve between real points, not the totals.

2. **Tax cost basis uses average cost** — SnapTrade doesn't provide lot-level cost basis. `missingBasisCount` in the Tax tab already surfaces this with a warning to users.

3. **YTD realized gains use current avg cost as sell basis** — because we don't have historical cost basis per lot. This is disclosed in-UI.

4. **Sharia screening runs through one provider seam** (`lib/sharia.mjs`): Finnhub fundamentals today, Zoya when `ZOYA_API_KEY` is set (Zoya adds the non-permissible-income test + a direct verdict; Finnhub can't supply revenue-segment data so that one test is sector-only). Verdicts cache per-day. `h.sh_` now flows from this — `SHARIA_MAP` is only the pre-load fallback. The Zoya adapter's response mapping is best-effort and must be confirmed against the live API when the key is provisioned (it falls back to Finnhub on any shape mismatch, so it can't break prod).

5. **~~SnapTrade 5xx spike detector is in-memory~~ — CORRECTED 2026-07-05**: this was stale. `trackSnapTradeError` (`lib/anomaly.mjs:110-132`) is **DB-backed** via `security_events`, same as the brute-force/IP-block detector — no cold-start reset. (Verified in the 2026-07-05 security audit.)

6. **Purification history is localStorage-mirrored** — unlike Sadaqah (backed by `user_state` in Supabase), purification state lives in localStorage + user_state but the purification LOG isn't in a dedicated table. New devices lose the purification history.

7. **Finnhub rate limit** — Free tier is 60 req/min. The holdings accordion fetches news + earnings per holding on expand. Expanding many holdings quickly can hit the rate limit. Known tradeoff of using free tier.

8. **Hawl tracking (Zakat)** — Hijri calendar integration and per-asset hawl start dates are NOT implemented. The Zakat calculator assumes you manage hawl tracking yourself.

9. **Order Ticket gating, and the Alpaca backend's real state** — corrected 2026-08-19, corrected again 2026-08-20. The old `{false && ...}` wrapper is gone; the only gate is `!isAdmin`. Note `isAdmin` in the frontend is **not** root — it is set from `d.trading_bot` (`MizanApp.jsx:12729`), i.e. the `profiles.trading_bot_enabled` beta allowlist, which is the *same* gate `/api/alpaca/*` uses server-side. **So enabling a trading tester is one SQL flag flip, not a code change.** ⚠️ **The previous claim here — "Alpaca paper trading backend is deployed and functional" — was HALF TRUE and is withdrawn.** The code is deployed; `ALPACA_KEY_ID` / `ALPACA_SECRET` **are absent from Vercel production** (verified 2026-08-20 via `vercel env ls production`), so every Alpaca route returns `503 Alpaca not configured` and `fetchAlpacaQuotes` has never returned a single quote in production. Memory `alpaca-data-pending` was the accurate record. Nothing Alpaca-related works until those two keys are set.

10. **Price chart granularity/history are Polygon-bound** — the holdings price chart (`PriceChart.jsx`) uses Polygon for OHLC because Finnhub's free tier has no `/stock/candle`. Polygon free tier = 5 req/min + ~2yr history, so the **5Y** timeframe is capped to what Polygon returns and intraday (**1D/1W**) depends on Polygon minute/hour bars. Bars cache 24h in `polygon_cache`. A symbol with no Polygon coverage (some crypto/OTC) renders the chart's **"No chart data"** empty state — intentional, not a bug.

---

## 11. EXTERNAL INTEGRATIONS — QUICK REFERENCE

| Integration | What It Does | Key Env Vars | Notes |
|-------------|-------------|--------------|-------|
| SnapTrade | Brokerage aggregation | `VITE_SNAPTRADE_CLIENT_ID`, `VITE_SNAPTRADE_CONSUMER_KEY` | ✅ userSecret is ENCRYPTED AT REST as of 2026-07-27 (AES-256-GCM; `ENCRYPTION_KEY` set, 10/10 rows ciphertext, plaintext column nulled — see crypto.mjs note). **Trading varies by broker** (gate on the `/brokerages` object's `allows_trading` flag, NOT `authorization_types` which is unreliable): Fidelity = read-only (no orders); **Robinhood = READ-ONLY via SnapTrade — `allows_trading:false`, a `connectionType:"trade"` login returns 400 code 1012 "does not support trade authorizations" (corrected 2026-07-08; it does NOT trade)**; E\*Trade = trade-enabled but whole-shares only. See memory `snaptrade-broker-capabilities`. Trading needs `connectionType:"trade"`; the connect modal now badges non-trading brokers "Read-only" and blocks trade selection. |
| Plaid | Bank accounts + transactions | `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV` | access_token server-only, never reaches browser |
| Anthropic | AI Advisor chat | `ANTHROPIC_KEY` | claude-sonnet-4-6, 60/hr rate limit, streaming |
| Stooq | Gold/silver spot prices | None (free) | CSV proxy — no API key needed |
| Finnhub | News, earnings, profile, dividends, quote (incl. `/api/market/quote` chart live-line), **Sharia screening fundamentals** | `FINNHUB_KEY` / `VITE_FINNHUB_KEY` | 60 req/min free tier. **No `/stock/candle`** on free tier → the price chart uses Polygon for OHLC |
| Zoya | Sharia screening (optional provider — overrides Finnhub when keyed) | `ZOYA_API_KEY`, `ZOYA_API_BASE` (opt) | NOT yet provisioned. When set, `lib/sharia.mjs` routes screening to Zoya (adds non-permissible-income test + direct verdict); falls back to Finnhub on any error. Adapter response-mapping must be verified against the live API. |
| Polygon | OHLC bars — backtester (`/api/polygon/bars`) **+ holdings price chart** (`/api/market/candles`, auth-gated + IMPERSONAL); both share `getPolygonBars()` (24h `polygon_cache` + backoff + stale-on-failure) | `POLYGON_KEY` | 5 req/min free, 2yr history |
| Alpha Vantage | ETF constituent holdings (ETF Overlap Analyzer) | `ALPHAVANTAGE_KEY` | **LIVE (set in Vercel 2026-07-05, verified — HLAL returned 210 holdings).** Free tier **25 req/day** → fetch server-side ONLY + cache ~24h in `etf_holdings_cache` (7 halal ETFs = 7 calls/day). The overlap route fetches symbols **sequentially** (concurrent bursts get throttled → curated fallback). `ETF_PROFILE` returns full holdings + weights + sectors. **ETF-only** (Amana mutual funds use curated snapshots in `lib/etfHoldings.mjs`; all 7 ETFs also curated-seeded as fallback). Stored **Sensitive**, so `vercel env pull` shows it empty — verify via `etf_holdings_cache.source`. |
| Alpaca | Paper trading **+ market data (IEX)** | `ALPACA_KEY_ID`, `ALPACA_SECRET` | ⚠️ **NEITHER KEY IS SET IN PRODUCTION** (verified 2026-08-20) → every route 503s and `fetchAlpacaQuotes` is dead code until they are. Paper only — `ALPACA_BASE` is `paper-api.alpaca.markets`, so no real money is reachable. Routes gated on `canUseTradingBot` (the `trading_bot_enabled` beta allowlist). **Per-user paper credentials shipped 2026-08-20 (migration 029)** — `getAlpacaCreds(user)` resolves the user's own encrypted pair first and falls back to the shared env pair, exposing `source: "user" \| "shared"` so a tester always knows whose blotter they are on. It **fails closed** on a decrypt error rather than dropping the user onto the shared account. **Data tier:** free/Basic = **IEX feed only, ~2% of market volume**; extended-hours coverage specifically improves on the paid SIP plan ($99/mo Algo Trader Plus). Surface that limitation in-UI rather than presenting an IEX pre-market print as *the* price. Market clock + extended-hours order rules live in `lib/market/sessions.mjs`. |
| Supabase | DB + Auth | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Paid plan |
| Resend | All Mizan email (owner alerts + user emails) | `RESEND_API_KEY`, `ALERT_FROM` | Sends owner anomaly alerts AND user emails (weekly digest, Plaid re-auth, bug-report receipts, trade invites) via `lib/alerts.mjs` (branded HTML shell w/ logo). **From = `ALERT_FROM`, which MUST be on the verified `mizan.exchange` domain** (set to `alerts@mizan.exchange` in Vercel; code default `MIZAN <no-reply@mizan.exchange>`). Was `mizan.app` — migrated 2026-07-02. Supabase **Auth** emails (signup/reset/magic-link) send separately via Supabase custom SMTP → Resend, sender `no-reply@mizan.exchange`. **2026-07-12:** user **invites** are now app-side + branded via `POST /api/admin/invite` (Admin → Users form) → `generateLink` + `renderBrandedEmail` (NOT Supabase's default). All 6 branded Supabase Auth templates live in `supabase/email-templates/` (apply via `scripts/push-auth-email-templates.mjs`). **DMARC** was missing (the spam cause) — added to Vercel DNS (`mizan.exchange` NS = `*.vercel-dns.com`; manage via `vercel dns`). **⚠️ 2026-07-20: `ALERT_FROM` had regressed to the unverified `alerts@omni-flow.net` → Resend `403` on EVERY email (invites/digest/re-auth/broadcasts) — corrected back to `MIZAN <alerts@mizan.exchange>`. If email "isn't arriving," check `ALERT_FROM`'s domain against `api.resend.com/domains` FIRST (single point of failure). Set it via the Vercel REST API as `type:encrypted` — the CLI `env add` now creates write-only `sensitive` vars that read back empty. Every `sendUserEmail` now sets `reply_to=OWNER_EMAIL`; the in-app Messages thread (migration 025) is the contact channel since there's no inbound mailbox.** See memory `email-sender-domain`. |
| Vercel Cron | Scheduled jobs auth | `CRON_SECRET` | **Required.** `cronUnauthorized()` is fail-closed (`!CRON_SECRET` → all crons 401). Vercel auto-attaches `Authorization: Bearer $CRON_SECRET` to cron paths ONLY when this exact var is set. Set in Vercel Prod 2026-06-25 after it was missing (crons hadn't run). Note: a Vercel **Redeploy** reuses the old env snapshot — bind new env vars with a fresh git build. |
| Sentry | Error tracking | `VITE_SENTRY_DSN`, `SENTRY_DSN` | Frontend + backend, v10.52 |
| Web Push | Push notifications | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | VAPID, per-device subscriptions |

---

## 12. CRON JOBS (vercel.json)

| Path | Schedule (UTC) | Purpose |
|------|---------------|---------|
| `/api/cron/sync` | Daily 6 AM | SnapTrade sync for all users |
| `/api/cron/cleanup` | Daily 3 AM | Data cleanup **+ the automated health sweep**: `checkDataFeeds` (upstream feeds), `checkConfig` (credential preflight), `checkCronStaleness` (the whole cron fleet). Each emails the owner on failure. Staleness used to run ONLY inside the admin panel, i.e. only while someone was already looking |
| `/api/cron/nightly-snapshot` | Daily 4:55 AM | Net-worth snapshot → `user_state.mizan_networth_history` (`NW_HISTORY_KEY`) — brokerage + net bank, the SAME series the in-app chart draws. Also merges the legacy `networth_history` key forward (one-time, self-healing) |
| `/api/cron/activation` | Daily 3 PM | Activation nudge: one email, ever, to users 1–45 days old with nothing connected, skipping anyone who signed in within 7 days. Deduped on the `user.activation_nudge` audit row |
| `/api/cron/weekly-digest` | Mon 1 PM | Weekly portfolio digest push notification + email. Reads `NW_HISTORY_KEY` so it can never quote a different net worth than the app shows |
| `/api/cron/dividend-check` | Daily 11 AM | Dividend detection + purification push notification |
| `/api/cron/bill-reminders` | Daily 2 PM | Bill reminder push notifications |
| `/api/cron/bot-signals` | Vercel `0 14 * * 1-5` (daily backstop) **+ GitHub Actions `*/15 * * * 1-5`** | Trading-bot strategy eval + signal generation/execution. The 15-min weekday cadence is driven by `.github/workflows/cron-bot-signals.yml` (Vercel Hobby = daily-only; public repo = free Actions minutes), hitting the endpoint with the `CRON_SECRET` bearer. Writes a `cron_jobs` heartbeat on EVERY invocation **including the market-closed early return** — the thing being monitored is "is the scheduler still firing", not "did it trade", and GitHub Actions schedules silently drop fires. Stale after 60h (clears the ~48h weekend gap). |

---

## 13. DEMO MODE

**Demo is OPT-IN, not the default (changed 2026-06-25).** `demoMode` initializes from `localStorage.mizan_demo==="1"` only — a new or connection-less user sees their **real $0 + Welcome/Connect** state, never the demo persona as their net worth. The DEMO toggle (visible while `!hasRealData || demoMode`) flips `mizan_demo`; `fetchSnapHoldings` swaps `DEMO_ACCOUNTS` in/out via the `[demoMode]` effect. Do NOT restore demo-by-default — routing the demo's ~$41M into a real user's net-worth headline was a reported bug. When opted in, the app shows a believable ~$435k demo persona (Muslim professional, diversified halal portfolio — rescaled 2026-07-15 from the old ~$55M mockup-scale figure). All demo data is hardcoded arrays inside MizanApp.jsx:

```javascript
DEMO_ACCOUNTS        // SnapTrade brokerage accounts
DEMO_BANK_ACCOUNTS   // Plaid bank accounts
DEMO_TRANSACTIONS    // Bank transactions
DEMO_ACTIVITIES      // Brokerage transaction history
DEMO_MANUAL_ASSETS   // Gold, silver, real estate
DEMO_SADAQAH         // Sample charity donations
DEMO_SHARIA          // Sample Sharia screening results
DEMO_PURIFICATION_ITEMS // Sample dividend purification items
```

Demo mode is detected by checking if real accounts exist. The toggle shows/hides real accounts. Demo data must not leak into authenticated user views — check all conditional paths that gate on demo mode.

**Demo balance invariant (added 2026-07-06).** Immediately after the `DEMO_ACCOUNTS` literal, a normalizer sets each account's `balance = cash + Σ(position price × units)` — the invariant every real SnapTrade account satisfies. The hand-authored `balance:` literals had drifted from their positions, which made Net Worth (built from `balance`) disagree with Allocation / Market Value / the Performance panel (built from positions). **Do not hardcode a `balance` that contradicts an account's `cash + positions`** — the normalizer will overwrite it anyway, and any surface that cross-references balances vs positions (like the RETURN & RISK panel) will surface the mismatch. **Demo net worth is ~$435k as of 2026-07-15** (`107763e` — the entire persona was rescaled from ~$55M to a believable upper-middle-class household: brokerage $264k + bank $58k + manual $113k = $435,481; accounts 11→6; transactions/sadaqah rescaled to match; do NOT restore the 9-figure figure). `DEMO_ACTIVITIES` deposit amounts are sized off `balance`, so they scale with it automatically.

---

## 14. SESSION CONTINUITY RULES

These rules ensure progress is never lost across sessions:

1. **Read `MIZAN-STATE-AUDIT.md`** when you need to understand what's deployed vs. built, schema details, or feature status. It's the living record.

2. **Update `MIZAN-STATE-AUDIT.md`** when you:
   - Add a new migration (update the migrations table)
   - Change a feature status (update Section 3 Feature Inventory)
   - Fix something listed as broken in Section 7 (mark it resolved)
   - Discover a new gap or risk (add to the appropriate section)

3. **Check memory files** (`/Users/amaankhan/.claude/projects/-Users-amaankhan-Documents-mizan-app/memory/`) for user preferences and project-specific learned feedback before starting work.

4. **After every deploy**: Run `vercel ls` or check Vercel MCP to confirm the deployment reached READY state before reporting success.

5. **Commit cadence**: One logical commit per feature/fix. Conventional commits format: `feat:`, `fix:`, `refactor:`, `chore:`. Descriptive messages focused on why, not what.

---

## 15. DEPLOYMENT WORKFLOW

```bash
# 1. Build check (must pass before commit)
npm run build

# 2. Commit
git add -p                           # Stage selectively
git commit -m "type: description"

# 3. Push → Vercel auto-deploys
git push origin main

# 4. Verify deploy reached READY
vercel ls                            # Check latest deployment status
# or use Vercel MCP: list_deployments with team_1jpYtfQNP39boDKElAshCOOL

# 5. Smoke test live site
curl -sI https://app.mizan.exchange   # Should return 200
```

**Vercel project**: `mizan` in team `mizan-s-projects2` (`team_1jpYtfQNP39boDKElAshCOOL`).
**Production URL**: `https://app.mizan.exchange`

---

## 16. FEATURE GAPS (PRIORITIZED)

Current gaps in order of user value (from MIZAN-STATE-AUDIT.md Section 6):

| Gap | Effort | Notes |
|-----|--------|-------|
| Hijri Calendar / Hawl tracking | M | Reuses ZakatSadaqah component + push notifications |
| Shareable snapshot links | M | Read-only token-based view |
| Risk metrics (Sharpe, max drawdown, volatility) | M | Reuses Polygon OHLC + existing backtester pipeline |
| Order Ticket activation | S | Remove two gates — backend already deployed |
| Anonymous peer comparison | L | Requires opt-in + aggregate queries |
| Browser extension (Sharia checker) | L | No extension manifest yet |

---

## 17. FILE SIZE WARNINGS

🚨 **MizanApp.jsx** (~13,200 lines) — intentionally monolithic. Do not split without explicit instruction. When adding code here, prefer compact patterns and keep functions under 50 lines.

🚨 **handlers.mjs** (~7,600 lines) — same rule. When adding a new API route, follow the existing pattern precisely (requireAuth → checkRateLimit → business logic → audit log → response).

Both files exceed the 800-line guideline by design — this is a known, accepted tradeoff for this project phase.
