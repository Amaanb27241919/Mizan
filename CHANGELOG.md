# Changelog

All notable changes to **MĪZAN**, generated from the git history ([Conventional Commits](https://www.conventionalcommits.org)). MĪZAN ships continuously to production, so entries are grouped by **ship date** rather than version tags. Newest first.

**Categories:** Added (features) · Changed (improvements & refactors) · Fixed (bug fixes) · Docs · Maintenance (chore/ci/test).

> Regenerate with `node scripts/gen-changelog.mjs`. Curated release notes with more narrative live in `MIZAN-STATE-AUDIT.md`.


## 2026-07-14

### Added
- **chart:** Candlestick + volume price chart on holdings (`b663d1b`)
- **market:** Impersonal server-side candle + quote data layer (`17a52fc`)

### Changed
- **overview:** Remove TradingView S&P 500 market-sector heatmap (`5af2163`)

### Fixed
- **activity:** Dedupe single-account CSV imports (Robinhood) + recover dropped cash txns (`4a67109`)
- **activity:** Dedupe CSV imports against SnapTrade by account number, not renameable label (`8cdb193`)

### Docs
- Record 2026-07-15 Robinhood/single-account CSV dedupe fix (`143b18b`)
- Record 2026-07-14 — activity dedupe fix + DCA-plan enactment (`fad50a8`)

### Maintenance
- **docs:** Stabilize audit last-audited stamp (2026-07-15 rollover) (`ee83395`)

## 2026-07-13

### Added
- **finances:** Surface usage-based metered spend (e.g. Anthropic) in the tile (`e27a530`)
- **zakat:** Connected-account checklist picker (like Goals) instead of auto-rows (`0d1fe85`)
- **zakat:** Split Sadaqah into its own tab + auto-fill worksheet from connections (`bafa16c`)
- **zakat:** Comprehensive Zakat worksheet modeled on scholar calculators (`0d34a3d`)

### Fixed
- **finances:** Nightly net-worth snapshot derives balance:0 accounts + adds Plaid bank (`c62a7df`)
- **finances:** Compliance box % over screened equity, not net worth (`7051047`)
- **finances:** Supplement Plaid recurring with a fixed-price sub detector (`15700d7`)
- **finances:** Stop hiding mis-tagged subscriptions + cadence-aware "stopped" (`152e8f7`)
- **zakat:** Derive SnapTrade balance from positions + auto-suggest card debt (`87cad13`)

### Docs
- Record 2026-07-13 accuracy pass (Compliance box + net-worth history) (`a75a929`)
- Record 2026-07-13 session (Zakat 401k/credit-cards + recurring subs rebuild) (`7640430`)

## 2026-07-12

### Added
- **auth-email:** Complete the set — all 6 branded Supabase auth templates in one folder (`a15ff38`)
- **auth-email:** Branded Supabase Auth email templates (confirm/invite/magic-link/recovery) (`91b1e28`)
- **admin:** Branded in-app user invites (BACKLOG F8) (`faf556c`)

### Fixed
- **email:** Add UTF-8 charset meta so → and Ī don't garble (`be4de90`)
- **email:** Correct invite footer + add Learn-more button (`3b6e15f`)

### Docs
- Add REBRAND-INVENTORY.md — every place the Mizan name is baked in (`79ea1b6`)
- DMARC added + close BACKLOG F8 + record 2026-07-12 session (`de26a48`)
- **backlog:** F8 — invite email rebrand + spam deliverability (user-reported) (`3368c27`)
- Correct false 'secrets encrypted at rest' claims (verified plaintext in prod) (`9be8736`)

### Maintenance
- Vendor Supabase agent skills (supabase + postgres-best-practices) (`d802a31`)
- Add project-scoped Supabase MCP server config (`011d4a6`)

## 2026-07-10

### Added
- **plaid:** Force a live bank balance pull on manual Sync (`e02dfee`)

### Changed
- **portfolio:** Move ETF Overlap Analyzer to Portfolio > Tools (`da75537`)
- **cleanup:** Stabilize netWorthHistory + mfaListFactors references (`d151126`)

### Fixed
- **sharia:** Restore ratio screening — Finnhub free tier dropped balance-sheet dollars (`b0fd7e9`)
- **overview:** Stop net-worth snapshot spamming localStorage + Supabase every render (`e5f3b09`)
- **goals:** Restore Fraunces display type across the Goals sub-tab (`f0f12d5`)
- **goals:** Stop connection-less users being stuck on "Loading goals…" (`625bc90`)

## 2026-07-08

### Added
- **connections:** Badge each brokerage connection trade-enabled vs read-only (`8fd9e28`)

### Fixed
- **snaptrade:** Gate read-only brokers out of the trade-connect flow (`3689f40`)
- **security:** Scope brute-force IP block to auth surface, shorten to 30m (`207a336`)

### Docs
- **audit:** Record IP-block self-lockout fix (207a336) in 2026-07-08 session block (`74b61b4`)

## 2026-07-07

### Added
- **performance:** Day-weighted average-capital return (Modified-Dietz) (`6f3db36`)

### Changed
- **zakat:** Extract Zakat/nisab math to tested pure lib (`778cdb7`)

### Fixed
- **dividends:** Define mask/fmtUSD in DividendPlanner (crash on render) (`04abbca`)
- **zakat:** Restore Zakat & Sadaqah page — destructure negativeBank (`81b961b`)
- **zakat:** Unify Overview + tab on a signed bank balance (`7403ae7`)
- **bot,finnhub:** Atomic cron claim-lease for duplicate-exec races + Finnhub retry (`0f12c1f`)

### Docs
- **audit:** Record 2026-07-08 session (backlog, maintenance mode, F1/F2/F4/F7, zakat unify, 2 crash fixes + eslint gate) (`a165144`)
- Switch Mizan to maintenance mode (feedback/bug-driven only) (`0826dc2`)
- Add verified backlog (68 items, code-checked) (`4749ec0`)

### Maintenance
- Add crash-focused eslint gate (no-undef) to the build (`840f742`)

## 2026-07-06

### Added
- **trade:** Live quote on symbol + selectable Market/Limit order type (`02db1c0`)
- **goals:** Auto-detect + link recurring debt payments from the bank feed (`0a83a1f`)
- **overview:** Performance analytics — money-weighted return (XIRR), P&L split, risk (`87ece9b`)
- **goals:** Debt payoff planner — snowball/avalanche/riba-first + burn-down (`0dcb37e`)
- **goals:** Flexible debt tracking — creditor, recurring plans, funding accounts (`26c5313`)

### Changed
- **trade:** Dedicated rate-limit bucket for the Order Ticket quote (`a18453a`)

### Fixed
- **overview:** Reconcile cross-metric numbers (demo balance invariant + P&L basis) (`b7fca08`)

### Docs
- Phase 3 start — debt-payment auto-linking (recurring engine) (`e0a509e`)
- Sync roadmap + state-audit + CLAUDE.md for Phase 1/2 + reconciliation (`d73fdf7`)
- Benchmark roadmap — Origin/Copilot + OSS finance apps vs Mizan (`833696e`)

## 2026-07-05

### Added
- **goals:** Debt payoff tracker — balances that count down to $0 (`c1cc295`)
- **ai:** Plain-English Sharia-screening explanations in the verdict modal (`60e86fd`)
- **portfolio:** Dividend Income Planner — forward projection w/ gross→net-of-purification (`dc37b63`)
- **ui:** Collapsible reorg — Finances + Trade (iteration 5, closes the set) (`4c1b566`)
- **ui:** Collapsible reorg — Goals/Zakat tab (iteration 4) (`4fb6552`)
- **ui:** Group Portfolio sub-tabs — 7 → 5 with a Tools group (`df488a8`)
- **ui:** Collapsible reorg — Portfolio Holdings watchlist (iteration 3) (`94fd8ed`)
- **ui:** Collapsible reorg — Overview + Settings (iteration 2) (`7efc096`)
- **ui:** Collapsible-tile primitive + first pass (reorg iteration 1) (`f3717a9`)
- **screener:** Curate all 7 halal ETFs + ticker normalization; bind ALPHAVANTAGE_KEY via fresh build (`13b5b43`)
- **screener:** ETF Overlap Analyzer — halal fund holdings overlap + diversification (incl. Amana funds) (`8e786bf`)

### Fixed
- Address 2 Codex review findings (crypto cache bypass + ETF retry no-op) (`86bb174`)
- **bot:** Engine-verified halal gate on picked candidates — no more hardcoded-only screen (`027b9f8`)
- **sharia:** Holdings labels are 100% engine-driven for real users — kill hardcoded fallbacks (`c0bfbbc`)
- **etf:** Sequential AV fetch + short TTL on ETF curated-fallback rows (`03d0504`)

### Docs
- AI roadmap — pending grounded-AI features tracked (tasks #5-9 + memory ai-roadmap); grounded-AI direction in CLAUDE.md (`f482cd0`)
- State-audit — AI screening-explanations feature + Codex review results (`a85befa`)
- Security audit results + corrections (spike detector is DB-backed not in-memory; migration table 023×2/024; line counts) (`bfba08f`)
- State-audit — screening now 100% engine-driven (labels + bot gate); no hardcoded halal/haram (`2f0e09c`)
- State-audit — trading plan recalibrated to realistic DCA-core (owner buy-and-hold insight) (`56819bc`)
- State-audit — Dividend Planner shipped + halal momentum-core rebuild + July-9 trading plan (`46d8be2`)
- Sync state-audit + CLAUDE.md — AV key live, full tab reorg, CollapsibleTile primitive (2026-07-05) (`839fe32`)
- State-audit + CLAUDE.md — ETF Overlap Analyzer, migration 024, ALPHAVANTAGE_KEY (2026-07-05) (`0018c72`)
- Sync state-audit + CLAUDE.md to 2026-07-03 (Bogleheads picker, persistent session, migration/line-count drift) (`6eeeb53`)

### Other
- Fix advisor auth-bypass (CRITICAL) + 6 hardening wins from audit (`1c34aed`)
- **ui:** Overview Top Holdings + Accounts default to open (`36b234e`)

## 2026-07-03

### Added
- **trade:** One-tap Halal Bogleheads preset picker + DCA weekly-amount (`88c559f`)

### Fixed
- **auth:** Persist session until explicit sign-out (revert per-tab isolation) (`9ee5fa1`)

## 2026-07-02

### Added
- **screening:** Ethical / BDS overlay toggle on the halal screener (`6cdecde`)
- **bot:** Halal Bogleheads DCA basket — selectable per-sleeve options (`7488b5d`)

### Fixed
- Atomic compare-and-swap on bot signal approval to prevent duplicate orders (`eafae77`)
- **activity:** Surface bot fills in the Activity tab so it syncs with the Trade tab (`f2665c2`)

### Docs
- State-audit — Bogleheads basket, BDS overlay, activity sync, changelog+hook (2026-07-02 cont.) (`555cd31`)
- Add generated CHANGELOG.md + gen-changelog script (`4e98ac4`)
- **trade-tab:** Correct gating model — bot is trading_bot_enabled allowlist; full-auto decoupled from is_root to full_auto_enabled allowlist (2026-07-02) (`1d153ce`)
- **CLAUDE:** Resend now sends all Mizan email from verified mizan.exchange (branded shell + logo) (`127577e`)

### Maintenance
- Auto-regenerate CHANGELOG.md via pre-commit hook (`10a8059`)

## 2026-07-01

### Added
- **email:** Use the Mizan logo image in the email header (was a text wordmark) (`9c04238`)
- **bot:** Decouple full-auto from is_root — gate on the full_auto_enabled allowlist (`05e6de0`)
- **trade:** Brokerage trading-support panel — reconnect notice + per-broker capability matrix (`903fec8`)
- **bot:** Market-hours gate — skip signal generation + block orders outside 09:30–16:00 ET (`bd4c639`)

### Fixed
- **email:** Order brand-image CORP rule FIRST so cross-origin actually applies (`6cfaad6`)
- **email:** Allow brand logos to load cross-origin (CORP) so email clients render them (`f586906`)
- **auth:** Scope session to a single tab (sessionStorage), purge stale localStorage token (`1d19884`)

### Docs
- State-audit 2026-07-02 — full-auto allowlist, mmfarooki full-auto, email→mizan.exchange, email logo (`39daea2`)
- Bump audit date — and rebuild to bind updated env (ALERT_FROM=alerts@mizan.exchange + new RESEND_API_KEY) (`cdd7e4a`)
- State-audit 2026-07-01 — market-hours gate, custodial/read-only DCA blocker, beta trader, Trade panel, per-tab sessions (`e27ce91`)

### Maintenance
- **email:** Exact /logo.png CORP rule to isolate match-vs-precedence (`461fb7e`)
- **email:** Default sender to the verified mizan.exchange domain (was mizan.app) (`970b8cc`)

### Other
- **email:** Drop ineffective CORP overrides for brand images (`e0e5603`)

## 2026-06-30

### Added
- **ui:** Read DCA strategies as accumulate-and-hold (no 0% target/stop) (`02cbe00`)
- **bot:** DCA / long-term accumulation strategy_type (`7cd25de`)
- Sync strategy tickers to watchlist + auto-correct ticker typos (`cddf768`)
- **bot:** Trailing-stop exit (locks gains on a winner, one taxable sale) (`47ba3a4`)
- **bot:** Per-strategy entry threshold (params.entry_threshold_pct) (`6adee10`)

### Fixed
- **bot:** Entry engine must pick the strongest AFFORDABLE name (`1d3c42c`)
- **snaptrade:** Source brokerage cash + buying power from /balances, not the bare /accounts object (`f1c43ed`)

### Docs
- Record SnapTrade broker trading/fractional capabilities + pending fractional basket DCA (`6309f36`)
- Sync for DCA strategy + affordability fix + trailing stop + Alpaca-pending (`7c0b91c`)
- **audit:** Record 2026-06-30 cont. — bot live, first fill, affordability fix, trailing stop, universe widen (`4150fa9`)
- Record bot-signals scheduler move to Supabase pg_cron (GitHub Actions schedule disabled) (`17c0b96`)
- Record 2026-06-30 changes (live full-auto, 15-min bot-signals, cash + refresh fixes) (`5a26c5e`)

### Maintenance
- **bot:** TEMP diagnostic log for entry-engine evaluation (revert after) (`467e448`)
- Disable GitHub Actions bot-signals schedule (superseded by Supabase pg_cron) (`1b92024`)
- Drive bot-signals every 15min on weekdays via GitHub Actions (`c311adb`)

### Other
- Migration 023: allow 'dca' strategy_type (applied to prod) (`1fb0ffe`)

## 2026-06-29

### Fixed
- **snaptrade:** Treat real-time/PAYG refresh responses as benign, log genuine failures (`c21229c`)

### Maintenance
- Migrate all hardcoded origins from mizan-puce.vercel.app to app.mizan.exchange (`c70e507`)

### Other
- Add cron job for scheduled backups (`049d3e1`)

## 2026-06-28

### Added
- **digest:** Per-user weekly email digest opt-out (migration 023 + toggle) (`2f29f61`)
- **email:** Branded HTML templates for all user/admin emails + fix weekly-digest link (`9b948d6`)
- **brand:** Real Arabic ميزان watermark via mask-image + new logo-ar (`5981c94`)
- **theme:** Translucent bento tiles + midnight-navy dark theme (`e14dab0`)
- **brand:** New MĪZAN scale logo, favicon & PWA icons (`7f8b89e`)

### Fixed
- **brand:** Open the meem counter in the Arabic watermark mask (`37ee536`)
- **sw:** Harden cacheFirst against HTML MIME-poisoning + bump v7→v8 (`b36de1b`)
- **app:** Restore previous Arabic ميزان + bump SW cache v6→v7 (`ba9e504`)
- **brand:** Correct Arabic ميزان (IBM Plex Sans Arabic) + white-bg favicon (`f76a13f`)

### Docs
- Bump state-audit last-audited date to 2026-06-28 (`1320c07`)
- Update CLAUDE.md theming note for midnight-navy dark + translucent tiles (`d47ed72`)

## 2026-06-27

### Added
- **app:** Premium tile depth — softer layered shadows + working hover deepen (`589706d`)
- **app:** Subtle film-grain atmosphere (CSS-only) (`73ff4a1`)
- **nav+bot:** Documents hub, drop Notifications, Trade leads with Signals, Overview signal banner (`288dcf8`)
- **bot:** Normalize ticker typos in NL strategy parser (`5f75fd3`)

### Changed
- **nav:** Move Assets to Portfolio + reorder sub-tabs; fix demo Cash on Hand (`fb3518f`)

### Fixed
- **overview:** Net Worth chart label + pin chart tip to live total (`0914a0e`)
- **app:** Hotfix white-screen — hoist demoMode above effects that depend on it (TDZ) (`cb7ae02`)

### Maintenance
- **sw:** Bump cache to mizan-v4 to purge stale app assets (`b16268f`)

## 2026-06-26

### Added
- **bot:** User-chosen deployable capital cap + faithful capture of detailed strategies (`3190f2c`)
- **sharia:** Methodology & Governance page (Settings → Methodology) (`cadbd66`)
- **v1:** Onboarding slim-down, progressive-disclosure gating, screening transparency + advice disclaimers (`e6afcf6`)
- **trade+admin:** Connect-for-trading opt-in + admin cron panel (`a2dc43b`)
- **admin:** Owner-only POST /api/admin/run-cron to fire crons on demand (`a0e8139`)
- **prices:** Alpaca + Yahoo fallback for /api/finnhub/quote (`453e002`)

### Changed
- **nav:** Consolidate redundant sub-tabs, drop landing-duplicated About (`b6f62a4`)

### Fixed
- **bot:** NL strategy parser failed on long descriptions (max_tokens truncation) (`dda7cbe`)
- **admin:** Surface errors, full migration probe, fleet-wide cron health (`84897dd`)
- **bot:** Order whole shares only (SnapTrade brokers reject fractional) (`3d1c16e`)
- **snaptrade:** Sort signature keys to match SnapTrade's json.dumps(sort_keys=True) (`5e7d6ac`)
- **bot:** Keep bot-signals cron daily (Vercel Hobby plan limit) (`4b66410`)
- **bot:** Strategy evaluation never ran (silent PostgREST embed failure) (`7842449`)
- **watchlist:** Load live prices on mount and for newly-added tickers (`6e5f508`)

### Maintenance
- **prices:** Log per-source quote counts for fallback observability (`cd126eb`)

## 2026-06-25

### Added
- **bot:** Bot Activity timeline — one real-time log of every bot action (`fc6e4b6`)
- **bot:** Realized-P&L ledger for closed round-trips (`c5fbb9a`)
- **bot:** Per-user beta access + Manual/Semi-only + first-use consent (`a3d3b69`)
- **bot:** In-place strategy editing UI (`ca34464`)
- **bot:** Allow in-place strategy editing on PATCH (`db6bd26`)

### Fixed
- **onboarding+demo:** Real empty state for new users, leaner onboarding, instant refresh on connect (`c60dac3`)
- **cron:** Remove .catch() chained on Supabase query builders (crashed crons) (`7997200`)
- **cron:** Audit cron.sync success so staleness detector has a real signal (`5382e8f`)
- **overview:** Relabel hero 'Total Portfolio Value' → 'Net Worth' (`7cb13fc`)
- **bot:** Brokerage account selector on the NL strategy review screen (`1275831`)
- Cron auth fail-closed + NL strategy builder over-refusal/silent failure (`057b928`)

### Docs
- **trade:** Document the Bot Activity timeline surface (`32f8af1`)
- Sync CLAUDE.md + state audit with 2026-06-25 session (`9ae65cc`)
- **trade:** Document in-place strategy editing flow (`ef1a16c`)
- **trade:** Refresh Trade-tab doc + add per-layer with/without-money execution flowcharts (`33d9c77`)

### Maintenance
- Fresh build to bind CRON_SECRET (Production) (`5fd184a`)
- Force fresh build to bind CRON_SECRET env var (`4cdd6cb`)

## 2026-06-24

### Added
- **trade:** Bind 'g t' keyboard shortcut to Trade (admin-only) (`effe46a`)
- **trade:** Hybrid trading hub + hard non-admin lockdown (`f55b854`)
- **bot:** Surface the 3 execution layers in admin panel + set default for new strategies (`8059dc8`)
- **sharia:** One server-side screening provider governs sh_ everywhere (`51e02c4`)
- **bot:** Strategy screens halal universe + picks ticker; per-strategy layer toggle (`8731870`)
- **bot:** NL strategy builder — reality-check backtest + runtime exits (`bb02dc2`)
- **bot:** Per-account full-auto opt-in (Layer 3 boundary) (`ce42ce4`)
- **bot:** Execute all three layers via SnapTrade (owner-gated, live broker) (`3299910`)
- **bot:** Wire signal execution to the broker (Alpaca paper) (`88ac8e6`)

### Changed
- **ui:** Convert check/x/close marks to SVG icons (incl. Trade tab) (`fe8696f`)
- **ui:** Replace all emoji with palette-colored SVG icons (`4126974`)
- **nav:** Move admin Trade tab next to Portfolio (Settings stays last) (`dfa3573`)

### Fixed
- **advisor:** Retired model id broke AI Advisor — claude-sonnet-4-20250514 -> claude-sonnet-4-6 (`594bd1b`)
- **security:** Verify Plaid webhook signatures (CSO finding #1) (`a247391`)

### Docs
- Record unified screening provider seam + bot ticker-picking (CLAUDE.md, state audit) (`caf7cfb`)
- Bring TRADE-TAB current — per-account full-auto, NL reality-check, exit engine (`b407131`)

### Maintenance
- Redeploy to apply OWNER_EMAIL change (root → akhan.industries@gmail.com) (`030ac45`)

## 2026-06-23

### Added
- **overview:** Real-time 1D and 1W portfolio charts (`a072506`)
- **brand:** Rebrand to light-first canvas/ink with navy accent (`81162fa`)
- **trade:** Add Trade as top-level nav page for admin users (`7e75852`)
- **pwa:** Dynamic Island + home indicator safe-area support (`4be0da1`)
- **trading-bot:** MĪZAN Trading Bot — three-layer gated trading system (`3e8edae`)

### Changed
- **nav:** Remove duplicate tabs and simplify settings (`fa63fe8`)

### Fixed
- **cron:** Bot-signals daily schedule — Hobby plan compatible (`a357947`)

### Docs
- Add Trade tab instructions + technical explanation (`05d502e`)

### Maintenance
- Add icon-generation script, ignore audit screenshots, refresh audit date (`1775e69`)

## 2026-06-18

### Added
- **brand:** Add English and Arabic logo wordmark SVGs (`49fe8f8`)
- **brand:** Balance-scale favicon, new PWA icons, logo files (`aff13d4`)

## 2026-06-17

### Added
- **portfolio:** Move sector allocation to Portfolio Holdings + fix 1D/1W gains (`339c2ee`)
- **overview:** TradingView S&P 500 sector heat map + updated About page (`fa9aafc`)
- **overview:** Chart ranges 1D/1W/1M/3M/YTD/1Y/All + real X/Y axes (`f8f2a73`)
- **overview:** Range-aware portfolio gains + 1W/1M/3M/6M periods (`334b716`)
- **mobile:** MobileHide column flag — trim card tables on small screens (`44466b4`)
- PWA + responsive polish — safe areas, card tables, install prompt, PTR (`fdbaff1`)

### Fixed
- **overview:** Correct TradingView widget DOM structure + broaden CSP (`08bbfdc`)
- **portfolio:** Accurate Activity/Tax/Screener data sync (`7152b9c`)
- **pwa:** Restore Settings TabBar scroll + fix button padding override (`600bfd5`)

### Docs
- Elite CLAUDE.md + session hooks + bento audit script (`b4e4b52`)
- Add CLAUDE.md — project brief, design system, arch rules for Claude Code sessions (`916c0a6`)

### Other
- Fix manifest icons/orientation/categories, viewport-fit=cover, offline fallback (`5d7b9db`)
- Liquid Glass material — chrome-only surface upgrade (`5739710`)

## 2026-06-16

### Added
- AAOIFI dividend purification — ledger, API, UI, and Overview callout (`d75794e`)
- **portfolio:** Expandable per-holding news + earnings accordion (`84cadee`)
- **goals:** Islamic goal templates + Overview widget (`1ac6244`)

### Changed
- Unify bento box UI system across all components (`c4575ff`)

### Docs
- Update state audit to reflect 2026-06-16 session work (`37916a6`)

### Other
- Forest-green editorial theme + IBM Plex / Fraunces type system (`5131419`)
- AES-256-GCM encryption for secrets + Supabase-backed IP blocking (`f600d9d`)
- Add Debt Payments & Transfers bento tile (`a5737bb`)
- Exclude credit card payments and transfers from recurring/spending (`8f59428`)
- Wire Plaid native recurring-transactions API (`165f797`)
- Replace Bills/Budgets tiles with proper Spending + Recurring (`e59c7ad`)

## 2026-05-31

### Other
- Metals/spot: swap Finnhub for Stooq (free, no API key) (`89f2438`)
- Live gold + silver spot via /api/metals/spot (`9df85f6`)
- Nisab standard + investment methodology toggles (`f23a07f`)
- Nisab gate on Overview tile + exclude non-zakatable manual assets (`9891863`)

## 2026-05-30

### Other
- Handle real-time plan 403/1141 as success, not failure (`82f1d7c`)

## 2026-05-29

### Fixed
- Throttle empty-state Plaid auto-sync to stop 429 lockout (`53119bf`)

### Other
- Plaid sync: surface PostgREST errors instead of returning items: 0 (`76a2e9a`)
- Plaid item-status: query both projections and surface .error (`60eb010`)
- Plaid item-status: replace maybeSingle with in-memory match (`60bb43f`)
- Plaid item-status: surface debug context on 404 (`be38162`)
- Per-Item DETAILS diagnostic in Connection Health (`7bc880a`)
- Force Re-sync escape hatch for stuck cursors (`20df5d5`)

## 2026-05-26

### Maintenance
- Regenerate package-lock for @vercel/functions (`74302ab`)

## 2026-05-25

### Other
- Prompt caching + pre-flight token counting (`2378c01`)
- Redirect non-US visitors to /us-only (Plaid is US-only) (`540ffda`)
- RLS audit: SELECT policies on every user-scoped table (`dc8c484`)

## 2026-05-23

### Fixed
- Transactions never load when Plaid initial pull is slow (`8c6c25e`)

### Other
- Connection Health page + in-app Bug Report button (`5dd4509`)

## 2026-05-18

### Other
- Plaid auto-sync on webhook + Net Worth dedup fix (`29130bd`)
- Merged into Holdings as a section (`652f5b6`)

## 2026-05-17

### Other
- Nav consolidation: 8 tabs → 6, redistribute Trade + drop ETFs (`8971cdd`)
- Finances empty-state + Coming Soon banner for Order Ticket (`12f1929`)
- Goals/Budgets/Nicknames: graceful "migration pending" + bundled SQL (`61eb70f`)

## 2026-05-15

### Fixed
- Cash on Hand zeroed out by credit-card debt + manual transactions resync (`dc4dbf2`)
- Transactions stop loading on Finance tab for pre-cursor users (`23ee798`)

### Other
- Per-account + net-worth target tracking + projections (`ea8d866`)
- CSV export: transactions + holdings + activity (`5ef2c01`)
- Account nicknames: rename UI + RLS-scoped table (`70f2597`)
- List view + 3-day push reminders cron (`27775fe`)
- Per-category monthly caps + progress UI (`3db6af5`)
- Search + filter + load-more pagination (`262ce6c`)
- Move service-worker registration into main.jsx (`e6893d5`)
- Plaid error code mapping + auto re-auth surfacing (`f78abe3`)
- Security hardening pass on Plaid persistence layer (`4054566`)
- Fix overlapping action buttons + source badge on Overview account cards (`1734b8c`)
- Unify SnapTrade + Plaid accounts across all tabs (`1ede474`)
- Error code mapping + re-auth surfacing (`76d6a13`)
- Transactions sync cursor + persistence (`18cf010`)
- Remove silent sandbox fallback (production-readiness checklist) (`62c0a91`)
- Plaid production-readiness: webhook + update mode + duplicate detection (`ff645e9`)
- Defensive guards: protect against divide-by-zero and missing fields (`47cca7e`)
- Math fixes: chain backtest returns, refine purification estimate, base YTD realized on cost basis, deduct debt from zakat, align Overview zakat tile (`3c7a2b7`)
- 6 cosmetic / consistency fixes in MizanApp (`0ff33c6`)
- Extend eye-toggle masking across Overview + Holdings (`b0eec4f`)
- Overview / Portfolio: eye toggle + stale-broker cleanup + bank cash unification (`e4a48ae`)
- OAuth redirect_uri + resume flow for production banks (`f6874b5`)
- Plaid Link: relax Permissions-Policy for accelerometer + encrypted-media (`2452d87`)
- Fix Rules of Hooks crash when react-plaid-link finishes loading (`2bca16d`)

## 2026-05-14

### Other
- Restore the missing Contact.jsx that broke the last deploy (`8957f28`)
- Gate Login -> MizanApp transition on AAL2 satisfaction (`fe19558`)
- SnapTrade migration tooling: test/wipe scripts + runbook (`f701cec`)

## 2026-05-13

### Other
- Surface legal docs on the public site + iPhone Settings TabBar polish (`669b396`)
- Plaid app: signup consent + DATA_RETENTION_POLICY + MFA evidence (`1c804c3`)
- Enforce AAL2 (MFA-verified session) before Plaid Link is surfaced (`9ec4129`)
- Legal docs: ACCESS_CONTROLS_POLICY + contact email switch + per-device signOut (`2b523e6`)
- Plaid prep + SnapTrade fixes: legal pages, SECURITY.md, cron refresh, structured errors (`7b53265`)

## 2026-05-12

### Other
- Frontend integration: CSV export, command palette, shortcuts, push UI, Alpaca, skeleton (`5915da2`)
- Tier 1+ batch: Sentry, Vitest, fetchWithRetry, cron jobs, push, Alpaca, polygon cache, shared frontend components (`1e342cd`)
- Sessions panel + email change + 4 anomaly detectors w/ Resend alerts (`b67f001`)
- Rate limits: scale defaults up ~50x for hourly windows + root bypass (`1d14a8d`)

## 2026-05-11

### Docs
- PLAID_SETUP.md — end-to-end Plaid wiring guide (`f28d871`)
- Rewrite README with current architecture + deploy flow (`84b2b34`)

### Other
- Admin users list: read from profiles, not auth.admin.listUsers (`0f04abe`)
- Audit log: enrich rows with profiles.email so the User column shows the actual address (`d5c9e8a`)
- Client isRoot reads profiles.is_root from Supabase (no rebuild on owner change) (`b6b67d0`)
- Admin panel bugfixes — audit-log pager, stats counts, advisor audit event (`ad934ff`)
- Structured JSON logging + DB rate limits + admin tab + account export/delete (`0f75cee`)
- Env audit + Supabase migrations + /api/admin/db-status (`baaf054`)
- Drift math against rebalanceable slice, not total NAV (`0b068c5`)
- Rebalance panel + 2FA "Site URL improperly formatted" fix (`abc7fe2`)
- Demo richness: $2.7M cash across 7 accts, $1M+ donations across 30+ orgs (`7541c27`)
- Demo parity: banks, donations, manual assets, zakat + Schwab/Vanguard/Webull (`0b41ec0`)
- "Replay tour" button to re-run the onboarding modal (`b7f6a7e`)
- 5-step onboarding modal for first-time users (`702c45d`)
- Method+account capture, inline edit, 5-axis filter bar (`01b07c2`)
- Plaid banking integration: Finances tab + 5 endpoints + schema (`2f7490e`)
- Silence Vite chunk warning + split supabase into its own vendor chunk (`6c02d0a`)
- Fix Fidelity-as-Coinbase: broker in fingerprint + smarter retag (`01759b4`)
- Capture per-row Account column (Fidelity multi-account fix) (`a42dd2f`)
- Remove owner-seed constant from the client bundle (privacy fix) (`fbe131e`)
- Bentoize remaining tabs: About, Tax Planner, FIRE, AAOIFI Screener (`e24ba6a`)
- Auto-detect CSV broker on import + retag tool for legacy imports (`9abf35e`)
- Fix CSV parser: handle quoted cells with embedded newlines (`4165b86`)
- Loosen activity dedupe fingerprint (`131d103`)
- Bentoize Settings (profile hero + API keys + brokers + manual assets) (`419fa4f`)
- Bentoize AI Advisor: context bar + prompt cards + bubble avatars (`e068ef2`)
- Persist active tab across reloads + remove Markets, fold Watchlist into Portfolio (`809d9cc`)
- Documents upload + Sadaqah restore + CSV import (`6352068`)
- Bentoize Trade & Bot tab (Order Ticket + Backtest + Sharia) (`d83ee37`)
- Bentoize Markets tab: Top Movers + watchlist + quotes (`2988c73`)
- Fix dedupe: cross-source matching + sticky across auto-sync (`295c767`)
- Bentoize Portfolio tab (Holdings + Activity) (`5d221c5`)
- Bento Overview: hero card + glass tiles + custom data viz (`2e42703`)
- Wide pass: tokens + new primitives across tables/tabs/chat/forms (`3d5a002`)
- Strip Markets tab: news + earnings + extra quote columns gone (`0f3afb5`)
- Design-system finalization: SF Pro Display + tokens + headline components (`64a9a69`)
- Fix force-refresh: per-authorization endpoint, not /snapTrade/manualRefresh (`41d0459`)
- Force broker refresh button (SnapTrade manualRefresh) (`b315284`)
- 90s auto-sync + move Documents from Portfolio to Settings (`050f461`)
- Move Sadaqah/Zakat from Settings to Portfolio + keep stat on Overview (`3459289`)
- 2FA / TOTP via Supabase Auth (enrollment + sign-in challenge) (`af88182`)
- Audit log for sensitive actions (`e640c2e`)
- Rate limit /api/* (anon/IP, auth/user, /api/advisor) (`39f11f8`)
- Security hardening: CSP + server-side vendor API proxying (`0e7da68`)
- CRITICAL privacy fix: rip hardcoded owner data + Root-only API Keys (`d238ec6`)
- Add daily SnapTrade auto-sync cron job (Sharesight pattern) (`10a1190`)
- Add Dedupe history button + fix Portfolio/Markets on mobile Safari (`b7ceab3`)
- CSV import dedup + mobile fixes for all tabs + Savium palette swap (`ce22325`)
- Switch auth from magic-link to email + password (ARIA-style) (`57dbfc8`)
- Privacy fix pt2: scope BroadcastChannel per user + surface auth errors (`547ab6e`)
- Fix critical privacy leak: clear stale localStorage on user change (`07826c9`)
- Fix new-user empty state + clean URL after magic link (`086d117`)
- Cross-device state sync + sign-up/login UI (`60bcdb0`)
- Thousands separators, local time fix, smart demo auto-hide (`df305e4`)

## 2026-05-10

### Other
- Vercel-ready: extract route logic to shared handler (`be7f5f2`)
- Multi-user MIZAN with full feature set (`cf8f2c4`)
- First commit (`c2ca9c8`)
