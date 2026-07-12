# MĪZAN — Elite Engineering Brief

> **SESSION PROTOCOL**: Read this file at the start of every session. Read `MIZAN-STATE-AUDIT.md` when you need architecture, schema, or feature status depth. Update `MIZAN-STATE-AUDIT.md` (last-audited date + any new findings) when you discover drift from what's documented. This file is the source of truth for how to work on Mizan correctly.

> **⚙️ OPERATING MODE — MAINTENANCE (owner decision, 2026-07-07).** Mizan is feature-complete for now. **Do NOT build net-new features or "improvements" on your own initiative.** Only do work that is one of: (1) driven by **real user feedback**, (2) a fix for **something actually broken or incorrect**, or (3) **explicitly requested by the owner**. The deferred feature backlog lives in `BACKLOG.md` (buckets `N`/`M`/`P` are parked; bucket `F` = fixes, the only class green-lit by default). When you notice a possible improvement, **add it to `BACKLOG.md` and move on — do not implement it and do not pitch it** unless it fixes a real defect. The goal is a stable app the owner isn't perpetually extending.

---

## 1. WHAT THIS APP IS

**MĪZAN** is a Sharia-compliant personal finance platform for Muslim investors. It is not a generic fintech app that happens to have a halal filter — Islamic compliance is the core product, not a feature.

**Core value propositions (in order of importance):**
1. Sharia-compliant portfolio screening (AAOIFI methodology, Finnhub data)
2. Zakat calculation with live nisab (gold/silver via Stooq)
3. Dividend purification tracking (impurity ratios per ETF, per-dividend log)
4. Unified brokerage + bank view (SnapTrade + Plaid)
5. AI with Islamic finance guardrails (Claude Sonnet via `/api/advisor` — **auth-gated**, per-user 60/hr): the chat advisor + **grounded-AI features** (fed only real data, explain-don't-judge, never invent a number). Shipped: plain-English Sharia-screening explanations. Roadmap: see memory `ai-roadmap` (Zakat guidance, portfolio insights, AI digest, per-token crypto). Reuse `/api/advisor` — don't build new AI plumbing.
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
src/components/MizanApp.jsx   — 11,400+ lines. ALL views, ALL state, ALL charts.
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
src/components/Budgeting.jsx   — Budget tab (extracted component)
src/components/BillsCalendar.jsx — Bills calendar
src/components/ConnectionHealth.jsx — Account connection status
src/components/ComingSoon.jsx  — Coming soon placeholder
src/components/BugReportButton.jsx — Bug report widget
src/components/CommandPalette.jsx — Cmd+K command palette
src/components/Login.jsx       — Auth page
src/components/LegalLayout.jsx — Legal pages
src/lib/auth.jsx               — Supabase Auth wrapper (TOTP MFA, session revocation)
src/lib/performance.js         — Pure portfolio analytics (XIRR/money-weighted return,
                                 realized/unrealized split, max drawdown/volatility/Sharpe).
                                 No React/DOM/storage. Tested: src/test/performance.test.js.
src/lib/recurring.js           — Pure recurring-transaction detection + debt-payment matching
                                 (normalize payee, cadence from median gap, score debt↔stream).
                                 Powers Goals debt-payment auto-linking. Tested: recurring.test.js.
src/lib/userState.js           — localStorage ↔ Supabase state sync (mizan_debts is a TRACKED_KEY)
src/lib/useKeyboard.js         — Global keyboard shortcuts
```

### Backend
```
api/[...path].mjs              — Vercel catch-all. Routes to lib/handlers.mjs.
lib/handlers.mjs               — 6,100+ lines. Every API route in one file.
lib/sharia.mjs                 — Sharia screening service (provider seam: Finnhub now, Zoya when ZOYA_API_KEY set). screenSymbol/screenBatch power /api/screen → governs h.sh_ app-wide
lib/crypto.mjs                 — AES-256-GCM encrypt/decrypt. Env var is `ENCRYPTION_KEY` (NOT APP_ENCRYPTION_KEY). ⚠️ 2026-07-12: verified against prod DB — this is BUILT but DORMANT. `ENCRYPTION_KEY` is not set, so `ENC_ENABLED` is false and every write falls back to plaintext. Result: user_snaptrade.snaptrade_user_secret is PLAINTEXT (8/8 rows), secret_ciphertext empty; plaid_tokens.access_token has NO encryption at all; user_state is plaintext. The landing page's "admin-blind"/"secrets encrypted at rest" claims were FALSE and were corrected (mizan-landing 6ae5b88). To activate: set ENCRYPTION_KEY, backfill existing rows, then finish 017.
lib/anomaly.mjs                — 4 anomaly detectors (brute force, 5xx spike, cron staleness, new device)
lib/alerts.mjs                 — Resend email: owner anomaly alerts + user emails (digest, re-auth, bug reports, invites) via a branded HTML shell (renderBrandedEmail, logo header). From = ALERT_FROM on the verified mizan.exchange domain
lib/rateLimit.mjs              — DB-backed rate limiting (increment_rate_limit RPC)
lib/fetchWithRetry.mjs         — Retry wrapper with exponential backoff
lib/logger.mjs                 — Structured logging
lib/sentry.mjs                 — Sentry backend init
server.js                      — Dev server (Vite middleware + API on :3000)
```

### Database (24 Migrations — all applied in prod)
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

### Zakat
- **Nisab threshold**: Minimum wealth before Zakat is due. Two standards: gold (87.48g) or silver (612.36g). User can toggle.
- **Hawl**: One lunar year must pass before Zakat is due on accumulated savings (not yet implemented — tracked in gap list).
- **2.5% rate** applies to most zakatable assets.
- Live gold/silver prices from Stooq via `/api/metals/spot`.
- Zakat is calculated on: cash, equity holdings (market value), gold/silver manual assets. Business inventory rules apply differently — not currently implemented.

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
- **Add external npm packages** — ask first. Bundle is already 360KB gzipped. Every dependency must justify itself.
- **Add new Supabase migrations** — schema changes require explicit ask. Always discuss before adding columns/tables.
- **Rename CSS classes** — `.bento`, `.glass`, `.glass-strong`, `.btn-primary`, `.btn-ghost` etc. are used throughout. Renaming breaks unrelated components.
- **Introduce TypeScript** — this is intentional JavaScript. Type safety comes from JSDoc and runtime validation.
- **Add analytics/tracking code** — no event tracking without explicit user instruction.
- **Change the CSP headers in vercel.json** — security configuration needs deliberate review.
- **Remove the `{false && ...}` Order Ticket gate** — both gates (ComingSoon wrapper + false wrapper) must be removed together when order ticket is activated. Never remove just one.

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

2. **Tax cost basis uses average cost** — SnapTrade doesn't provide lot-level cost basis. `missingBasisCount` in the Tax tab already surfaces this with a warning to users.

3. **YTD realized gains use current avg cost as sell basis** — because we don't have historical cost basis per lot. This is disclosed in-UI.

4. **Sharia screening runs through one provider seam** (`lib/sharia.mjs`): Finnhub fundamentals today, Zoya when `ZOYA_API_KEY` is set (Zoya adds the non-permissible-income test + a direct verdict; Finnhub can't supply revenue-segment data so that one test is sector-only). Verdicts cache per-day. `h.sh_` now flows from this — `SHARIA_MAP` is only the pre-load fallback. The Zoya adapter's response mapping is best-effort and must be confirmed against the live API when the key is provisioned (it falls back to Finnhub on any shape mismatch, so it can't break prod).

5. **~~SnapTrade 5xx spike detector is in-memory~~ — CORRECTED 2026-07-05**: this was stale. `trackSnapTradeError` (`lib/anomaly.mjs:110-132`) is **DB-backed** via `security_events`, same as the brute-force/IP-block detector — no cold-start reset. (Verified in the 2026-07-05 security audit.)

6. **Purification history is localStorage-mirrored** — unlike Sadaqah (backed by `user_state` in Supabase), purification state lives in localStorage + user_state but the purification LOG isn't in a dedicated table. New devices lose the purification history.

7. **Finnhub rate limit** — Free tier is 60 req/min. The holdings accordion fetches news + earnings per holding on expand. Expanding many holdings quickly can hit the rate limit. Known tradeoff of using free tier.

8. **Hawl tracking (Zakat)** — Hijri calendar integration and per-asset hawl start dates are NOT implemented. The Zakat calculator assumes you manage hawl tracking yourself.

9. **Order Ticket is double-gated** — `{false && ...}` in JSX AND `<ComingSoon>` wrapper. Alpaca paper trading backend is deployed and functional. Both gates must be removed simultaneously to activate.

---

## 11. EXTERNAL INTEGRATIONS — QUICK REFERENCE

| Integration | What It Does | Key Env Vars | Notes |
|-------------|-------------|--------------|-------|
| SnapTrade | Brokerage aggregation | `VITE_SNAPTRADE_CLIENT_ID`, `VITE_SNAPTRADE_CONSUMER_KEY` | ⚠️ userSecret is PLAINTEXT in DB today (encryption built but dormant — see crypto.mjs note; ENCRYPTION_KEY unset). Was documented as encrypted; corrected 2026-07-12. **Trading varies by broker** (gate on the `/brokerages` object's `allows_trading` flag, NOT `authorization_types` which is unreliable): Fidelity = read-only (no orders); **Robinhood = READ-ONLY via SnapTrade — `allows_trading:false`, a `connectionType:"trade"` login returns 400 code 1012 "does not support trade authorizations" (corrected 2026-07-08; it does NOT trade)**; E\*Trade = trade-enabled but whole-shares only. See memory `snaptrade-broker-capabilities`. Trading needs `connectionType:"trade"`; the connect modal now badges non-trading brokers "Read-only" and blocks trade selection. |
| Plaid | Bank accounts + transactions | `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV` | access_token server-only, never reaches browser |
| Anthropic | AI Advisor chat | `ANTHROPIC_KEY` | claude-sonnet-4-6, 60/hr rate limit, streaming |
| Stooq | Gold/silver spot prices | None (free) | CSV proxy — no API key needed |
| Finnhub | News, earnings, profile, dividends, quote, **Sharia screening fundamentals** | `FINNHUB_KEY` / `VITE_FINNHUB_KEY` | 60 req/min free tier |
| Zoya | Sharia screening (optional provider — overrides Finnhub when keyed) | `ZOYA_API_KEY`, `ZOYA_API_BASE` (opt) | NOT yet provisioned. When set, `lib/sharia.mjs` routes screening to Zoya (adds non-permissible-income test + direct verdict); falls back to Finnhub on any error. Adapter response-mapping must be verified against the live API. |
| Polygon | OHLC bars (backtester only) | `POLYGON_KEY` | 5 req/min free, 2yr history |
| Alpha Vantage | ETF constituent holdings (ETF Overlap Analyzer) | `ALPHAVANTAGE_KEY` | **LIVE (set in Vercel 2026-07-05, verified — HLAL returned 210 holdings).** Free tier **25 req/day** → fetch server-side ONLY + cache ~24h in `etf_holdings_cache` (7 halal ETFs = 7 calls/day). The overlap route fetches symbols **sequentially** (concurrent bursts get throttled → curated fallback). `ETF_PROFILE` returns full holdings + weights + sectors. **ETF-only** (Amana mutual funds use curated snapshots in `lib/etfHoldings.mjs`; all 7 ETFs also curated-seeded as fallback). Stored **Sensitive**, so `vercel env pull` shows it empty — verify via `etf_holdings_cache.source`. |
| Alpaca | Paper trading | `ALPACA_KEY_ID`, `ALPACA_SECRET` | Paper only — no production keys |
| Supabase | DB + Auth | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Paid plan |
| Resend | All Mizan email (owner alerts + user emails) | `RESEND_API_KEY`, `ALERT_FROM` | Sends owner anomaly alerts AND user emails (weekly digest, Plaid re-auth, bug-report receipts, trade invites) via `lib/alerts.mjs` (branded HTML shell w/ logo). **From = `ALERT_FROM`, which MUST be on the verified `mizan.exchange` domain** (set to `alerts@mizan.exchange` in Vercel; code default `MIZAN <no-reply@mizan.exchange>`). Was `mizan.app` — migrated 2026-07-02. Supabase **Auth** emails (signup/reset/magic-link) send separately via Supabase custom SMTP → Resend, sender `no-reply@mizan.exchange`. **2026-07-12:** user **invites** are now app-side + branded via `POST /api/admin/invite` (Admin → Users form) → `generateLink` + `renderBrandedEmail` (NOT Supabase's default). All 6 branded Supabase Auth templates live in `supabase/email-templates/` (apply via `scripts/push-auth-email-templates.mjs`). **DMARC** was missing (the spam cause) — added to Vercel DNS (`mizan.exchange` NS = `*.vercel-dns.com`; manage via `vercel dns`). See memory `email-sender-domain`. |
| Vercel Cron | Scheduled jobs auth | `CRON_SECRET` | **Required.** `cronUnauthorized()` is fail-closed (`!CRON_SECRET` → all crons 401). Vercel auto-attaches `Authorization: Bearer $CRON_SECRET` to cron paths ONLY when this exact var is set. Set in Vercel Prod 2026-06-25 after it was missing (crons hadn't run). Note: a Vercel **Redeploy** reuses the old env snapshot — bind new env vars with a fresh git build. |
| Sentry | Error tracking | `VITE_SENTRY_DSN`, `SENTRY_DSN` | Frontend + backend, v10.52 |
| Web Push | Push notifications | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | VAPID, per-device subscriptions |

---

## 12. CRON JOBS (vercel.json)

| Path | Schedule (UTC) | Purpose |
|------|---------------|---------|
| `/api/cron/sync` | Daily 6 AM | SnapTrade sync for all users |
| `/api/cron/cleanup` | Daily 3 AM | Data cleanup |
| `/api/cron/nightly-snapshot` | Daily 4:55 AM | Net worth snapshot → net_worth_history |
| `/api/cron/weekly-digest` | Mon 1 PM | Weekly portfolio digest push notification |
| `/api/cron/dividend-check` | Daily 11 AM | Dividend detection + purification push notification |
| `/api/cron/bill-reminders` | Daily 2 PM | Bill reminder push notifications |
| `/api/cron/bot-signals` | Vercel `0 14 * * 1-5` (daily backstop) **+ GitHub Actions `*/15 * * * 1-5`** | Trading-bot strategy eval + signal generation/execution. The 15-min weekday cadence is driven by `.github/workflows/cron-bot-signals.yml` (Vercel Hobby = daily-only; public repo = free Actions minutes), hitting the endpoint with the `CRON_SECRET` bearer. |

---

## 13. DEMO MODE

**Demo is OPT-IN, not the default (changed 2026-06-25).** `demoMode` initializes from `localStorage.mizan_demo==="1"` only — a new or connection-less user sees their **real $0 + Welcome/Connect** state, never the demo persona as their net worth. The DEMO toggle (visible while `!hasRealData || demoMode`) flips `mizan_demo`; `fetchSnapHoldings` swaps `DEMO_ACCOUNTS` in/out via the `[demoMode]` effect. Do NOT restore demo-by-default — routing the demo's ~$41M into a real user's net-worth headline was a reported bug. When opted in, the app shows a rich 8-figure demo persona (Muslim professional, diversified halal portfolio). All demo data is hardcoded arrays inside MizanApp.jsx:

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

**Demo balance invariant (added 2026-07-06).** Immediately after the `DEMO_ACCOUNTS` literal, a normalizer sets each account's `balance = cash + Σ(position price × units)` — the invariant every real SnapTrade account satisfies. The hand-authored `balance:` literals had drifted from their positions, which made Net Worth (built from `balance`) disagree with Allocation / Market Value / the Performance panel (built from positions). **Do not hardcode a `balance` that contradicts an account's `cash + positions`** — the normalizer will overwrite it anyway, and any surface that cross-references balances vs positions (like the RETURN & RISK panel) will surface the mismatch. Demo net worth is ~$58M (was mis-stated ~$44M before the fix). `DEMO_ACTIVITIES` deposit amounts are sized off `balance`, so they scale with it automatically.

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
| Muslim budget categories (Sadaqah, Masjid, Halal food) | S | Plaid categories already working — need Islamic presets |
| Shareable snapshot links | M | Read-only token-based view |
| Risk metrics (Sharpe, max drawdown, volatility) | M | Reuses Polygon OHLC + existing backtester pipeline |
| Order Ticket activation | S | Remove two gates — backend already deployed |
| Anonymous peer comparison | L | Requires opt-in + aggregate queries |
| Browser extension (Sharia checker) | L | No extension manifest yet |

---

## 17. FILE SIZE WARNINGS

🚨 **MizanApp.jsx** (~11,400 lines) — intentionally monolithic. Do not split without explicit instruction. When adding code here, prefer compact patterns and keep functions under 50 lines.

🚨 **handlers.mjs** (~6,100 lines) — same rule. When adding a new API route, follow the existing pattern precisely (requireAuth → checkRateLimit → business logic → audit log → response).

Both files exceed the 800-line guideline by design — this is a known, accepted tradeoff for this project phase.
