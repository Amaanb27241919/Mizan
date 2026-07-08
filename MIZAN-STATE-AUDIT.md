# MĪZAN — State-of-App Audit

> **Living document.** Re-run every few weeks to track drift between what's built and what's deployed.
> Last audited: 2026-07-08 (updated) · All findings from direct file reads, no guessing.
>
> **2026-07-08 session changes**: (1) **Verified backlog + MAINTENANCE MODE (commits `4749ec0`, `0826dc2`)** — swept the last 7 days of session notes + memory + audit/roadmap docs into **`BACKLOG.md`** (68 items, each **verified against real code** — the sweep reclassified 5 "pending" items as already shipped and 2 as obsolete). Owner decision: **stop self-initiated feature building** — an OPERATING MODE banner at the top of `CLAUDE.md` now restricts future work to user-feedback / real-bug / explicit-ask; parked features go to `BACKLOG.md` (add-and-move-on). See [[maintenance-mode]]. (2) **Fixes F1/F2/F4/F7 (commits `778cdb7`, `6f3db36`, `0f12c1f`)** — **F1**: extracted the Zakat/nisab math out of the monolith into a pure, unit-tested **`src/lib/zakat.js`** (+35 Vitest cases; behavior-preserving). **F2**: closed the lock-less `/api/cron/bot-signals` duplicate-execution races #3–#6 via a per-strategy **atomic claim-lease** on `bot_strategies.updated_at` (new pure `lib/botLease.mjs`, +8 tests, same CAS idiom as `eafae77`) + terminal `'rejected'` resolution for ambiguous full-auto fills — no migration. **F4**: day-weighted **average-capital return (Modified-Dietz/ROAI)** added to `performance.js` + a panel stat (+9 tests). **F7**: routed the 4 Finnhub proxy endpoints through `fetchWithRetry` (429/Retry-After-aware). (3) **Zakat calc unified on a SIGNED bank balance (commit `7403ae7`)** — the Overview ZAKAT DUE tile and the Zakat tab disagreed for nonzero bank balances (Overview added cash but ignored overdrafts; tab deducted overdrafts but omitted cash). `computeZakat` now treats the bank balance with its natural sign (positive cash zakatable + added, negative deducted as short-term debt) and BOTH surfaces route through it. Effect: tab rises for cash holders (fixes undercount), Overview falls for overdraft users (fixes overcount). (4) **TWO runtime crashes fixed + a lint gate to prevent recurrence (commits `81b961b`, `04abbca`, `840f742`)** — the F1 extraction left `negativeBank` referenced in the Zakat-tab JSX but no longer declared → `ReferenceError` **crashed the Zakat & Sadaqah page** (fixed by destructuring it from `computeZakat`). A crash-focused **ESLint gate** was then added (`config/eslint.mjs`, referenced via `npm run lint`, wired into `npm run build` so a `no-undef` fails the build AND the Vercel deploy) — running it caught a **second, pre-existing crash**: the **Dividend Income Planner** referenced `mask`/`fmtUSD` never defined in its scope, so that shipped tool had been throwing on render since 2026-07-05 (fixed). Config lives at `config/eslint.mjs` not the default filename because a global config-protection hook guards `eslint.config.*`. Only crash-class rules (no style noise); 134 Vitest cases pass; all deploys verified READY on `app.mizan.exchange`. See [[eslint-crash-gate]]. (5) **Brute-force IP-block self-lockout FIXED (user-reported bug, commit `207a336`)** — owner reported "Plaid Connection error — Temporarily blocked due to suspicious activity." Root cause was **Mizan's own** guard, not Plaid: `isIpBlocked()` at the top of `_handle()` (`lib/handlers.mjs`) 429'd **every** endpoint for a 24h window whenever an IP crossed the brute-force threshold, and the owner's own IP (`45.31.92.200` — verified via `audit_log`: **458 successful sign-ins** + `admin.run_cron`) tripped it with 5 failed logins in 31s (a mistyped password). Deeper flaw: the client self-reports its own failed logins (`src/lib/auth.jsx` → `/api/auth/track-failure`) and real sign-in is client→Supabase, so the guard gave **~zero protection against real attackers** (they never call the reporter) and **only ever fired on honest users**. Immediate fix: expired the live `ip_block` row in Supabase `security_events` (kept for forensics) → owner regained access with a refresh, no deploy needed. Permanent fix (owner chose "scope + shorten"): the `isIpBlocked` gate now applies **only to `/api/auth/*`** (a valid session always reaches its independently-auth-checked data endpoints — a password typo can't lock a user out of Plaid/portfolio), `BLOCK_HOURS 24→0.5` (30 min), `BRUTE_THRESHOLD 5→10` (`lib/anomaly.mjs`). Build green (lint-gated); deploy `dpl_2kRR…` verified READY on `app.mizan.exchange`, zero downtime. See [[ip-block-self-lockout]].
>
> **2026-07-06 session changes**: (1) **Debt payoff tracker SHIPPED, then made flexible (commits `c1cc295` → `26c5313`)** — new **Debts** section in the Goals tab (`Goals.jsx`), an Origin/Copilot-style tracker where each debt counts DOWN to $0. Three track modes: **manual** (log payments any time), **recurring** (a set amount on a cadence paid from a funding account — autopay auto-counts each period, else one-click "Confirm"), and **balance-linked** (reads a Plaid credit/loan account's live balance). An **`creditor` "owed-to"** field lets a debt be owed to a bank OR a person; **interest-free (qard hasan) is the default**, APR optional (framed for an overdue interest-bearing card). Overview "Savings Goals" widget gained a compact total-debt strip. Persists to `localStorage mizan_debts` (added to `TRACKED_KEYS` — cross-device via `user_state`, **no migration**). Standalone tracker; does NOT feed net worth (linked accounts already counted via Plaid). (2) **Phase 1 — Debt payoff PLANNER (commit `0dcb37e`)** — a `computePayoffPlan()` pure simulation (month-by-month, pays each debt its minimum, funnels an optional extra + freed-up minimums to the priority debt, accrues interest) → debt-free date, total interest, payoff order, inline-SVG **burn-down chart** (no Recharts). Three strategies: **riba-first** (clear interest-bearing debt fastest — Islamic default), avalanche, snowball. Amortization (`monthsToPayoff`) makes interest-bearing debts project a real date. Verified in demo: $400/mo extra under riba-first cut payoff 13y8mo→1y4mo, interest $9,696→$453. (3) **Phase 2 — Performance analytics (commits `87ece9b` + `b7fca08`)** — new Overview **`RETURN & RISK`** panel (`PerformancePanel.jsx`, collapsed by default, shown only when holdings exist) backed by a pure, dependency-free **`src/lib/performance.js`** (16 Vitest cases, 64 total pass): **money-weighted return (XIRR)** (Newton's + bisection, Excel-fixture validated — the IRR Ghostfolio's code stubs out), **realized/unrealized P&L split**, and **risk metrics** (max drawdown / annualized volatility / Sharpe at a 0% riba-free rate, flow-adjusted so deposits don't read as gains, gated behind ≥20 daily snapshots). (4) **Cross-metric number reconciliation (part of `b7fca08`)** — the panel was the first surface to cross-reference deposits, balances, and positions, exposing that **demo account `balance` literals had drifted from `cash + Σ(positions)`** (the real SnapTrade invariant), understating Net Worth ~$13.8M vs Allocation/Market-Value/panel. Now a normalizer after `DEMO_ACCOUNTS` derives each balance from cash+positions (can't drift; demo net worth ~$44M→~$58M, previously mis-stated low). Panel **Total P&L is position-derived** (realized+unrealized) so it equals the Position-P&L tiles AND the hero's Total Return exactly; Allocation total = Market Value + Cash; Cash on Hand = broker cash + bank. All reconcile. (5) **Verified NON-bug: cost-basis-reset** — research had flagged a possible missing reset on full position close. Traced all 3 P&L paths: unrealized uses the broker's per-position avg cost (broker resets on close), YTD-realized is a disclosed avg-cost approximation (Known Limitation #3), and the only self-accumulating book — the bot's `botRealizedPnl` (`lib/handlers.mjs:1301`) — already resets at line 1338. Nothing to fix. (6) **Benchmark roadmap doc (`MIZAN-BENCHMARK-ROADMAP.md`, commit `833696e`)** — source-level study of Origin, Copilot Money, Maybe (→ fork `we-promise/sure`), Firefly III, Actual, Ghostfolio (+paisa/wealthfolio/investbrain) mapping how each models debt/payoff + other features vs Mizan. Key findings: Origin & Copilot have debt *visibility* but no payoff planning (Mizan now beats them); nobody ships true TWR/IRR/risk (so Mizan's avg-cost is industry-normal, and XIRR+risk put it ahead). Tracks Phase 3 (rules engine + Islamic categories + recurring detection → debt-payment auto-linking) and Phase 4 (materialized balance table + reverse calculator — unblocks dense risk curves) as NEXT. All Phase 1/2 deploys verified READY on `app.mizan.exchange`. (7) **Phase 3 (start) — debt-payment auto-detection + linking (commit `0a83a1f`)** — new pure **`src/lib/recurring.js`** (11 Vitest cases): detects recurring outflows from transactions (Actual's find-schedules: normalize payee, ≥2 occurrences, cadence from median gap), adapts Plaid's native `/recurring` streams, and scores/matches a stream to a tracked debt by creditor + amount — the step Copilot skips (it detects recurrings but never links them to a liability). Goals debt cards now show "Detected a recurring $X/mo payment to <merchant> — Link payments"; linking imports the stream's posted payments and a reconcile effect keeps pulling new ones (idempotent via a stable `extId`) so paydown auto-advances from the bank feed — the owner's "sync monthly statements" ask. Recurring-debt autopay is disabled on link (no double-count); Unlink reverts. Real reads `/api/plaid/recurring` → falls back to detecting from `/api/plaid/transactions`; demo uses a Guidance Residential stream matching the Auto Financing debt. **Boundary held per owner:** personal debts live in Goals; credit-card subscriptions/bills stay finance-categorized (Finances untouched). No migration. Verified in demo: detect → link ($14,500→$10,900, 3 payments) → unlink (reverts). *Remaining Phase 3:* rules engine + Islamic budget categories (§16 gap); apply the recurring engine to the Finances subscriptions view. See [[benchmark-roadmap-phases]].
>
> **2026-07-05 session changes**: (1) **ETF Overlap Analyzer SHIPPED (commit `8e786bf`, migration `024`)** — first of a set of "features non-Muslim finance apps have, adapted for halal investors." A new Screener-tab panel compares 2–4 halal ETFs / Amana funds to expose duplicated holdings (the halal fund universe is small + heavily overlapping — verified SPUS vs HLAL = **62.8% overlap across 20 shared names** even on top-25 data, so "diversified across three funds" is often one bet in a trench coat). **`lib/etfHoldings.mjs`** (new): 11-symbol universe = 7 halal ETFs (SPUS/HLAL/UMMA/SPWO/SPTE/SPRE/SPSK) + **4 Amana mutual funds** (AMANX/AMAGX/AMDWX/AMAPX — added at owner's request; he holds them + many seasoned Muslim investors do), curated bootstrap holdings, an Alpha Vantage `ETF_PROFILE` parser, and the pure overlap engine (overlap % = Σ min(wₐ,w_b); equity-vs-sukuk flagged not-comparable). **Backend:** `GET /api/etf/universe` + `GET /api/etf/overlap?symbols=…` (any signed-in user, not trading-gated) with a **cache → Alpha Vantage → curated fallback** in `getHoldingsRecord()`. New table **`etf_holdings_cache`** (migration 024, service-role-only RLS, same pattern as `polygon_cache`). ETFs served by Alpha Vantage `ETF_PROFILE` (free tier **25 req/day** → holdings fetched server-side only + cached ~24h; 7 ETFs = 7 calls/day, well under cap); the 4 Amana funds are curated (AV is ETF-only; MFs report holdings only quarterly via N-PORT). SPUS/HLAL are also curated-seeded so the analyzer works BEFORE the key is set — AV overwrites daily once keyed. **Frontend:** `ETFOverlapPanel` in the Screener tab (`sub==="screener"`) — fund pickers, headline overlap % (amber ≥50% = redundancy warning / navy / slate), shared-holdings table, per-fund source provenance, both themes. **NEW ENV (pending): `ALPHAVANTAGE_KEY`** — owner adding to Vercel prod; until then ETFs beyond curated SPUS/HLAL show "awaiting data source." Verified: overlap engine unit-tested (SPUS×HLAL 62.8%, SPUS×AMAGX 31.4%, AMAGX×AMANX 25.9%, SPUS×AMDWX 0% EM, SPUS×AMAPX not-comparable sukuk); build green; migration applied; deploy READY; both routes 401 unauth. See [[etf-overlap-analyzer]]. (2) **`ALPHAVANTAGE_KEY` went LIVE + verified (commits `13b5b43`, `03d0504`)** — owner set the key in Vercel; a fresh git build bound it. First live run confirmed AV covers the niche tickers with FULL lists (**HLAL returned 210 holdings** from `alphavantage`). Two fixes surfaced by that run: the overlap route now fetches symbols **SEQUENTIALLY** (AV's free tier throttles concurrent bursts, which made the 2nd symbol fall back to curated — SPUS did while HLAL got AV), and a curated row for an **ETF** now expires in **~1h** (`ETF_CURATED_FALLBACK_TTL_MS`), not the 90-day mutual-fund TTL, so a transient throttle can't pin an AV-covered ETF to stale curated data for months. Also: **all 7 ETFs curated-seeded** (permanent fallback if AV can't serve one) + **`normTicker()`** strips exchange prefixes (`AMS: ASML`→`ASML`, `KRX: 005930`→`005930`) so international funds cross-match (UMMA×SPWO catches Samsung/TSM/ASML = 22.1%). GOTCHA: `vercel env pull` shows `ALPHAVANTAGE_KEY` (+ `PLAID_SECRET`) as empty because they're **Sensitive** vars the CLI can't read back — NOT actually empty; verify via `etf_holdings_cache.source`. (3) **TAB REORG — collapsible sections across all 6 tabs (commits `f3717a9` → `4c1b566`)** — owner: long vertical tile-stacks bury features. New **`<CollapsibleTile>`** primitive (MizanApp.jsx, right after `BentoTile`): a BentoTile whose title + one-line subtitle header is ALWAYS visible while the body folds — so the stack of headers is a scannable table-of-contents (discoverability) while views stay short (compactness). Per-section open state persists in `localStorage` (`mizan_ct_<key>`); a **`flat`** variant (header bar, no card wrapper) wraps multi-tile panels without card-in-card. Applied: **Overview** (Top Holdings + Accounts default-open per owner, Market Heatmap collapsed w/ lazy `open`-gated TradingView build), **Settings** (Security/Privacy/CSV/Legal collapse; Connections + Broker Docs open), **Portfolio** (Watchlist + ETF Overlap collapse) **+ sub-tabs grouped 7→5** — top row Holdings · Screener · Activity · Assets · **Tools**, where Tools reveals a slate-accented secondary `TabBar` (Rebalance/Tax/Backtest); `sub` keeps its per-tool values, `topActive` is derived, no render branches changed. **Goals/Zakat** (Methodology + Sadaqah log collapse; Zakat hero + Dividend Purification open), **Finances** (Spending/Debt/Subscriptions analytics collapse w/ month+total in subtitle; bank hero + accounts + Recent Transactions open), **Trade** (Bot Activity + Realized P&L collapse; Refresh buttons moved into body — can't nest a button in the header). Principle: primary stays open, secondary folds under a visible header. See [[tab-reorg-collapsible]]. (4) **Dividend Income Planner SHIPPED (commit `dc37b63`)** — new `DividendPlanner` under **Portfolio → Tools → Dividends** (the Tools group also gained this 5th tool). Forward-projects annual dividend income from a starting balance + monthly contributions + DRIP + price growth over a 5–30y horizon, with the Mizan-unique **gross → minus purification → net you keep** view (only the purified portion is reinvested). Starting yield blends from the user's real halal-fund holdings (`ETF_LIST` published yields) when known. Gross-vs-net area chart + assumptions panel + purification-owed total. (5) **Trading: recalibrated to a REALISTIC DCA-core plan + July-9 activation** — owner first wanted momentum-core targeting $5–20/wk, then recalibrated after realizing his Robinhood +5–10% gains come from **capital + whole shares + holding 2+ yr** (buy-and-hold), NOT trading. Plan flipped to **DCA-core long-term halal accumulation** (primary) with momentum as a **tiny optional sleeve**. Honest expectation: low-double-digit % over 1–2+ yr on invested capital, scaling with deposits — NOT weekly income ($5–20/wk was impossible; ≈$15–25/yr on ~$200). Universe = **broaden to halal STOCKS, keep the Sharia screen** (no code change needed — bot universe already has halal large-caps; affordability filter picks them as capital grows). Dormant momentum `43c1b866` (acct `302ebba3`) had a **crypto-miner universe** (MARA/RIOT/CLSK — NL builder picked non-halal names despite a "halal" description); REBUILT halal + demoted to `deploy_pct:25`, `enabled=false`. July-9 checklist: sell 2 SPTE at break-even + retire `e528f2d7`, create the DCA core (SPUS + SPSK smoother, weekly, hold), momentum optional. See [[trading-july9-plan]]. (6) **Screening wired 100% engine-driven — killed hardcoded halal/haram (commits `c0bfbbc`, `027b9f8`)** — owner caught crypto (DOGE/XRP) showing "halal" on his Robinhood import. Root cause was `mapPosition`'s fallback chain (`live || SHARIA_MAP || crypto?"halal"`), NOT the engine. Fixes: (a) real users' `sh_` resolves ONLY from the live `/api/screen` verdict, else "review"; the demo persona's hardcoded `SHARIA_MAP` is now demo-mode-only (no leak). (b) Crypto is flagged "review" (token-specific + scholar-dependent) by the **connector's asset type**, not a hardcoded coin list — no more auto-halal. (c) The **bot's** halal gate was ALSO hardcoded (`HARAM_TICKERS` blocklist + curated universe, marked `sharia_passed:true` without screening) — now the entry engine screens each picked candidate via `screenSymbol` and blocks a definitive "haram" (audit-logged), while still trading halal ETFs (which screen review/unknown — halal by construction, so it blocks only haram, never review/unknown). `HARAM_TICKERS` is now a cheap pre-filter safety net, not the authority. Screening is now engine-driven end-to-end. See [[sharia-screening-source-of-truth]]. (7) **Security hardening from a read-only audit (commit `1c34aed`)** — a `security-reviewer` pass verified the core is solid (RLS coverage, IDOR scoping, AES-256-GCM secrets, admin gating, Plaid webhook ES256 sigs, no SSRF/SQLi) and found: **CRITICAL** — `/api/advisor` + `/api/advisor/count` had NO auth gate (`verifyUser` ran only afterward for audit), so anyone could bill Claude to Mizan / use it as a free relay → added `verifyUser→401` before any Anthropic call (also tightens the rate bucket to the per-user 60/hr cap). **HIGH** — `npm audit fix` patched form-data (CRLF, via plaid) + opentelemetry (DoS, via sentry) + undici, all prod deps (esbuild/vite left — dev-only, needs breaking vite@8). **MEDIUM** — CSV formula-injection guard in `csvEscapeCell` (=/+/-/@ → prefixed `'`); tight `marketdata` rate bucket (150/hr) for the public Finnhub/Stooq/Polygon proxies + anon now respects `min(action,anon)` caps; gated `/api/alpaca/*` behind `canUseTradingBot` (shared paper account). **LOW** — removed dead `full_auto_enabled` from strategy-PATCH allowlist; constant-time `CRON_SECRET` compare. **Deferred (needs care):** move CSP `script-src` off `'unsafe-inline'` to a nonce-based policy (compounds the localStorage-JWT exposure; CLAUDE.md §8 gates CSP changes). (8) **AI feature #1 — plain-English Sharia-screening explanations (commit `60e86fd`)** — the Screener "Why →" verdict modal now has an "✦ Explain in plain English" button: feeds Claude ONLY the verdict facts (status, industry, AAOIFI ratio tests + numbers vs thresholds, non-permissible income %, crypto asset-type) → warm 3–5 sentence explanation (why, which test, practical meaning). It explains, never re-judges; told never to invent a number. Reuses the auth-gated `/api/advisor`. First grounded-AI feature beyond the chat advisor. (9) **Codex second-opinion review of the whole session (`codex exec review --base 9ee5fa1`, fixes `86bb174`)** — no critical/security findings (advisor auth, rate-limits, bot halal-gate all passed); caught 2 real bugs Claude missed: crypto could still show "halal" from a same-day CACHED verdict (override only ran for stale tickers → now forced regardless of freshness, idempotent) and the ETF Overlap "Retry" was a no-op (`setSel([...s])` left `sel.join(",")` unchanged → added a `retryN` nonce). **NEXT — AI roadmap (memory `ai-roadmap`, tracked as pending tasks #5–9): grounded-AI features on the auth-gated `/api/advisor` — Zakat/purification guidance, proactive portfolio insight card, AI-written weekly digest, per-token crypto screening, security-event explainer. Also pending: July-9 trading activation ([[trading-july9-plan]]); CSP nonce hardening (deferred security).** (4) **Landing-page SEO + competitor intel (`mizan-landing` repo — marketing site, NOT app code; commits `cae8b2c`/`bd01886`/`a6742e5`)** — investigated **joinmizan.com = Mizan Markets LLC** (Floral Park NY; founders Yusuf & Eesa Samad; claims RIA + Alpaca Securities), a *same-name* halal-investing competitor that is **PRE-LAUNCH / waitlist-only** (no product, no App Store, `#`-placeholder contact, broken signup). Countered by SEO-optimizing the landing head to own "Mizan halal" search intent while they're pre-launch: `<title>` now "Mīzan — **Halal Investing** & Sharia-Compliant Portfolio Management" (word "halal" was absent from title/meta before — brand was spelled "Mīzan" with a macron nobody types), meta description leads with plain "Mizan" + "halal investing", added `SoftwareApplication` **JSON-LD** (`alternateName:"Mizan"`), `robots.txt` + `sitemap.xml`, and fixed `canonical`/`og:url`/`og:image` to the **resolving `www.mizan.exchange` host** (apex `mizan.exchange` 308-redirects to www; the old `og:image` on `mizan-landing-one.vercel.app` had started 301-redirecting → broke social scrapers). All verified live. PENDING (owner clicks): submit sitemap in Search Console + re-scrape social debuggers. Brand "Mizan" is crowded in Islamic finance → wordmark likely unregistrable broadly; a cheap USPTO clearance search advised before any TM spend. #3 (halal-investing content pages for ranking) was scoped but **parked** — plan/discuss before build. See [[joinmizan-competitor]], [[mizan-landing-prod-url]].
>
> **2026-07-03 session changes**: (1) **Halal Bogleheads frontend picker SHIPPED (commit `88c559f`)** — completes the "frontend selector = follow-up" left open on 2026-07-02. New `GET/POST /api/bot/bogleheads` endpoint (single source of truth, `canUseTradingBot`-gated): GET returns the `HALAL_BOGLEHEADS_SLEEVES` menu, POST `{account_id, sel}` returns a server-validated `buildBogleheadsPreset`. The Trade builder now shows a "Halal Bogleheads" **Quick Preset** tile with per-sleeve pickers (core US/Intl/Sukuk radios + optional tech/REIT toggles) that builds into the EXISTING `nlResult` review→Activate flow (no new modal). Added a **WEEKLY AMOUNT** field in the review for `dca` strategies (writes `params.dca_amount`) so the basket DCAs per-period instead of lump-summing the full allocation — fixes both the picker and the NL-bogleheads path, which previously left `dca_amount=0` (cron fell back to `capital_allocated` = deploy-all-at-once). **Gating model confirmed & preserved:** the Trade UI + `/api/bot/strategies` + `/api/bot/bogleheads` are gated to trading-enabled users (frontend `isAdmin` = `d.trading_bot`), while `/api/cron/bot-signals` executes for ALL enabled strategies with no admin gate (backend for all users). Owner's DCA `0fd266ae` was converted to the basket (SPUS 0.50 / SPWO 0.30 / SPSK 0.20) but stays `enabled=false` on the read-only custodial `366265e9` — dormant until funds land (~2026-07-08, see [[bot-snaptrade-impact-401]]). See [[bot-execution-model]]. (2) **Persistent auth session RESTORED (commit `9ee5fa1`)** — reverted the 2026-07-01 per-tab `sessionStorage` experiment (`1d19884`). `src/lib/supabase.js` now stores the Supabase session in **`localStorage`** (the SDK default, `persistSession:true`) so a login survives refreshes, new tabs, new windows, and browser restarts, ending ONLY on an explicit `signOut()` (or token expiry with no refresh). Owner's request: "each tab/session stays logged in until the user actually signs out." **Critical:** the one-time `sb-*-auth-token` localStorage purge that the sessionStorage config added was REMOVED in the same commit — it ran on every load and would have wiped the persistent session, logging users straight back out. SW `CACHE_NAME` bumped v10→v11. One-time effect: anyone still holding a sessionStorage-only session re-logs-in once, then it persists. No incognito leak (private windows always get isolated storage). Both deploys verified READY in prod. See [[per-tab-session-storage]]. **Do NOT re-introduce per-tab scoping as a "fix."**
>
> **2026-07-02 session changes**: (1) **Full-auto decoupled from `is_root` → `full_auto_enabled` ALLOWLIST (commit `05e6de0`)** — `canUseFullAuto()` now gates on the owner-controlled `full_auto_enabled` flag (set only via SQL, no self-serve) instead of root; strategy create/edit full-auto layer + the per-account opt-in PATCH now call `canUseFullAuto` (were `isRoot`). Done on the owner's explicit, informed decision to let a permission-granted **family** beta tester auto-trade their OWN account. The in-code COMPLIANCE comment was rewritten, not deleted (keep the allowlist to accounts the owner is personally authorized to trade; revisit before any compensated/commercial arrangement). Allowlist now: `akhan.industries` (root), `khanstyle02` (owner's own secondary — flag was already stale-true, so decoupling ACTIVATED its full-auto), `mmfarooki@outlook.com` (family). See [[trading-bot-beta-access]]. (2) **`mmfarooki` enabled for Trade + full-auto** — `trading_bot_enabled=true` + `full_auto_enabled=true`; still needs consent + a trade-permission reconnect + a funded **non-custodial** account + a `mode='full'` strategy before anything executes. Sent a branded invite email (4 setup steps + pros/cons + explicit no-guarantee-of-profit disclaimer). (3) **Email fully migrated to the verified `mizan.exchange` domain** — was leaking from the old `mizan.app`/omni-flow config. `ALERT_FROM` code default → `MIZAN <no-reply@mizan.exchange>` (commit `970b8cc`); owner set the Vercel `ALERT_FROM` env → `alerts@mizan.exchange` + rotated the Resend key; Supabase Auth custom SMTP sender → `no-reply@mizan.exchange` via Resend. Verified: auth-email links resolve to `app.mizan.exchange` (no omni-flow leak, via admin `generateLink`), app emails send from `alerts@mizan.exchange` (live test to owner + real invite to mmfarooki, both HTTP 200). NO `omni-flow`/`mizan.app` refs remain in `lib/` or `src/`. (4) **Email header logo (commit `9c04238`)** — `renderBrandedEmail` now shows `/logo.png` (navy scales + MĪZAN lockup) instead of the CSS text wordmark, `alt="MĪZAN"` for image-blocking clients; covers all app emails. Note: the site-wide `Cross-Origin-Resource-Policy: same-origin` header blocks the hosted logo in a raw `file://`/browser cross-origin load, but real email clients proxy images server-side (CORP is browser-only) so it renders in inboxes. Per-asset CORP overrides in `vercel.json` did NOT take effect (Vercel serves static assets same-origin regardless of rule order/source — tested 3 ways) and were reverted as moot (commit `e0e5603`); the clean single-rule hardened header config is restored. See [[per-tab-session-storage]]. (5) **Halal Bogleheads DCA basket (commit `7488b5d`)** — the `dca` strategy_type now supports a weighted multi-ETF basket (`params.basket`), the Islamic three-fund lazy portfolio with SELECTABLE per-sleeve options: US (SPUS|HLAL) · International/World ex-US (SPWO|UMMA) · Sukuk (SPSK) + optional tech (SPTE) / REIT (SPRE) tilts. `HALAL_BOGLEHEADS_SLEEVES` + `bogleheadsBasket()`/`buildBogleheadsPreset()`/`bogleheadsSelectionFromText()` in handlers.mjs. Cron buys the most-underweight AFFORDABLE member each period (rebalance via new contributions — whole shares, never sells; tax-efficient + halal). NL builder short-circuits on "bogleheads/three-fund/lazy portfolio" → returns the preset (any option ticker named fills its sleeve); response carries the sleeve menu for a review-UI selector (frontend selector = follow-up). Directly answers Amal Invest's "halal ETFs are expensive/underperform" critique with a low-cost DIY index basket. See [[bot-execution-model]]. (6) **Ethical / BDS screening overlay (commit `6cdecde`)** — optional layer ON TOP of the AAOIFI verdict; never changes `sh_`. `ETHICAL_EXCLUSIONS` (curated divestment-target list) + `ethicalScreen()` in `lib/sharia.mjs`; every `/api/screen` verdict carries `ethical:{excluded,reason,list}`; `mapPosition` exposes `h.bds_`. Screener has an "Ethical/BDS ON/OFF" toggle (pref `mizan_ethical_overlay`, default off) → red "BDS" pill + explainer. FOLLOW-UP: apply to the bot buy-universe. See [[sharia-screening-source-of-truth]]. (7) **Activity tab ↔ Trade tab sync (commit `f2665c2`)** — the Activity tab now merges the bot's executed fills (from `/api/bot/activity`), tagged "BOT", deduped against the broker feed by ticker+side+units within ~4 days so the authoritative SnapTrade row wins once it syncs. Display-only (NOT merged into `snapActivities`, so net-worth/flow/dividend calcs stay broker-sourced). Executed-fills-only by design. (8) **CHANGELOG + auto-regen (commits `4e98ac4`, `10a8059`)** — added `CHANGELOG.md` (Keep-a-Changelog, generated from Conventional-Commit history, grouped by ship date) + `scripts/gen-changelog.mjs` generator + a `.githooks/pre-commit` hook (wired via `core.hooksPath=.githooks`, auto-set by the package.json `prepare` script) that regenerates + stages CHANGELOG on every commit (best-effort, skips rebase/merge; one commit behind by design). Curated narrative stays here in the state-audit.
>
> **2026-07-01 session changes**: (1) **Market-hours gate (commit `bd4c639`)** — the bot only places MARKET orders, which the broker rejects outside RTH (`impact 403` code **1019** "Outside market hours" — the reason a DCA SPUS buy failed firing at 00:00 UTC). New `usMarketStatus()` in `lib/handlers.mjs` (America/New_York wall-clock via `Intl`, DST-safe, + hardcoded 2026–early-2027 market-holiday set) gates `/api/cron/bot-signals` (early-return `skipped:"market_closed"`) and `executeSnapTradeOrder` (`425 market_closed`, defense-in-depth covering the manual approve path). pg_cron still fires `*/15` all UTC hours but off-RTH ticks no-op. Swap for Alpaca `/v2/clock` when keyed (adds holidays + half-day early closes — see [[alpaca-data-pending]]). (2) **DCA blocked by a READ-ONLY (custodial) connection — not code, not funding.** A second DCA strategy `0fd266ae` (SPUS, $100, `mode=full`) was pointed at `366265e9` ("E-Trade - Original", `type=CUSTODIAL`). With all gates armed (`account_full_auto(b1403200,366265e9)=true`, profiles gates true) a live in-hours test failed at symbol resolution: SnapTrade `/accounts/366265e9/symbols` → **402** (read-only connection) → order rejected `422 could not resolve symbol`. Funded ≠ trade-enabled, AND E\*Trade bars API trading on custodial (UGMA/UTMA) accounts (the deeper `1140` wall) — reconnecting can't fix it. **Parked ~1 wk**: DCA strategy set `enabled=false`, custodial `account_full_auto` reverted to `false`; owner is moving funds custodian→bank→an **Individual** E\*Trade account, then repoint `0fd266ae.account_id` there + re-enable. See [[bot-snaptrade-impact-401]]. (3) **First external beta trader** — `mmfarooki@outlook.com` (`fe9f7326…`) granted `trading_bot_enabled=true` (Manual/Semi only; still needs consent + a trade-permission reconnect). (4) **Trade-tab "Brokerage Trading Support" panel (commit `903fec8`)** — new `TradeConnectionsPanel` under the Trade TabBar (any bot-enabled user): a reconnect-with-trade-permission notice (read-only connections can't place orders) + "Reconnect for trading" button (opens the trade-mode ConnectModal) + a collapsible per-broker capability matrix (Robinhood trade+fractional, E\*TRADE/Schwab whole-shares, Fidelity read-only, Coinbase crypto-only, custodial UGMA/UTMA can't API-trade). (5) **Per-tab auth session (commit `1d19884`)** — the Supabase session moved from localStorage → **`sessionStorage`** (`src/lib/supabase.js`) so a NEW tab/window starts logged out (localStorage is shared across a browser profile's tabs; sessionStorage isn't). One-time purge of any stale `sb-*-auth-token` in localStorage; SW `CACHE_NAME` bumped v9→v10. Logs every existing user out ONCE on next load. Verified end-to-end via Playwright against prod (tab1: session in sessionStorage, none in localStorage; tab2 new tab: no session, login screen). See [[per-tab-session-storage]].
>
> **2026-06-30 session changes**: (1) **Live full-auto trading went active on a funded account** — `akhan.industries` (is_root) connected a regular **E\*Trade Individual** account (`302ebba3…`, $100 settled cash + **$100 buying power**) after the prior custodial account (`366265e9…`) stayed `buying_power=$0` (E\*Trade blocks API trading on custodial/UTMA accounts). Wired full-auto to it: strategy `e528f2d7` (SPUS breakout, `mode=full`, `position_size_pct=100`) targets `302ebba3` + `account_full_auto(b1403200,302ebba3)=true`. All gates pass → `isFullAuto=true`. (2) **bot-signals now fires every 15 min on weekdays** via a new GitHub Actions workflow (`.github/workflows/cron-bot-signals.yml`, `*/15 * * * 1-5`) hitting `/api/cron/bot-signals` with the `CRON_SECRET` bearer — Vercel Hobby caps native crons at daily, and the repo is public so Actions minutes are free. Verified end-to-end (HTTP 200, strategy evaluated). vercel.json keeps the daily `0 14 * * 1-5` entry as a backstop. (3) **Brokerage cash + buying power fix** (`/api/snaptrade/all`) — was reading `acct.balance.cash.amount`, which most brokers (E\*Trade, Robinhood) don't return (cash + buying_power live on `/accounts/{id}/balances`); funded accounts showed **$0 cash on Overview** and $0 buying power in the Trade panel. Now fetches `/balances` per account in parallel and sources both from there (live on the real-time plan). (4) **SnapTrade force-refresh toast fix** (`/api/snaptrade/refresh`) — real-time/PAYG accounts return 402 or a 4xx whose detail names the real-time plan (only 403+code-1141 was recognized), so a benign no-op surfaced the alarming "rejected the refresh for all connections" 502. Broadened benign detection (402 / 403+1141 / real-time-plan detail), kept 401/404 as hard failures, partial success now reported OK, and the genuine-failure branch now logs per-auth status/code/detail (was a blind 502). (5) **bot-signals scheduler moved to Supabase `pg_cron`** — GitHub Actions' `schedule:` trigger proved unreliable (the new `*/15` workflow registered `active` but went ~1.5h / 5 slots without a single scheduled fire; GitHub scheduled crons are best-effort and routinely drop short-interval jobs — a real risk for a breakout-reactive bot). Replaced it with a Supabase `pg_cron` + `pg_net` job (`bot-signals-15min`, `*/15 * * * 1-5` UTC) that calls `public.trigger_bot_signals()` → reads `CRON_SECRET` from **Supabase Vault** by name (`cron_secret`, plaintext never in the job definition) and `net.http_get`s `/api/cron/bot-signals` with the bearer. The GitHub `schedule:` block is now **commented out** (commit `1b92024`) to prevent two schedulers double-firing the same tick and racing on the lock-less handler (could open two positions); the workflow stays as a manual `workflow_dispatch` backstop, and vercel.json keeps its daily entry. **One operational step pending: the owner must store `CRON_SECRET` in Vault** (`select vault.create_secret('…','cron_secret',…)`); until then the job fires every 15 min but safely no-ops (function returns early when the secret is absent). See [[bot-snaptrade-impact-401]] + [[vercel-hobby-cron-limit]].
>
> **2026-06-30 (cont.) — bot went live + first real fill + tuning**: (1) **Vault secret stored → pipeline live.** `vault.create_secret(CRON_SECRET,'cron_secret')` done; `trigger_bot_signals()` now actually HTTP-calls `/api/cron/bot-signals` (verified `net._http_response` 200). The pg_cron had been "succeeding" but no-opping for days (returned early, missing secret) — `cron.job_run_details` "succeeded" only means the SQL ran, check `net._http_response.status_code` for true end-to-end. (2) **AFFORDABILITY BUG fixed (commit `1d3c42c`)** — the real reason nothing traded: the entry engine picked the highest day-momentum name in the WHOLE universe regardless of price, then floored to whole shares → AMD (+8% @ $582) won the pick on a $100 budget → qty=0 → traded nothing while cheaper qualifying names (SPTE) sat ignored. Adding high-priced halal stocks to a small-account universe starved it. Fix: compute deployable budget first, only consider a candidate if `floor(deployable/price) >= 1`; strongest AFFORDABLE name wins; pricier names activate when capital is raised. (3) **Per-strategy entry threshold** — `params.entry_threshold_pct` (default 1.5%, owner's set to 1.0%) replaces the hardcoded global. (4) **Trailing-stop exit (commit `47ba3a4`)** — high-water in `params.high_water`, arms at `trail_activate_pct` (10%), sells on `trail_pct` (6%) pullback from peak, profit-only. (5) **Universe widened** — owner's SPUS strategy now 6 halal ETFs (SPUS/HLAL/UMMA/SPSK/SPRE/SPTE) + 5 halal blue-chips (NVDA/AMD/AAPL/GOOGL/META, fund-to-activate >$100). (6) **FIRST LIVE AUTONOMOUS FILL** — bought **2 SPTE @ ~$48.81** (~$97.62) on E\*Trade `302ebba3`, status=executed, no error. End-to-end proven. (7) User's strategic conclusion: short-term momentum on slow halal ETFs is a strategy/asset mismatch. **(8) DCA strategy_type BUILT** (commit `7cd25de`, migration `023`) — `strategy_type='dca'` long-term accumulation: buys whole shares of the target on a fixed cadence (`params.dca_cadence_days`, default 7) up to `params.dca_amount`, capped by capital exposure, and HOLDS (own cron branch before the momentum/exit engine — never auto-sold; manual exit ideally >1yr). One-attempt/day guard; cadence advances only on a real fill. Owner DCA strategy `0fd266ae` = SPUS weekly, $100, full-auto, account `302ebba3`; verified the branch runs end-to-end (first test rejected `impact 403: exchanges not open` — market was closed, NOT a bug). **(9) Per-strategy entry threshold** (`params.entry_threshold_pct`), **affordability-filtered pick** (entry now requires `floor(deployable/price) >= 1` — fixed the "picks AMD @ $582 on a $100 budget → trades nothing" bug), and **trailing-stop exit** (`params.trail_pct`/`trail_activate_pct`, high-water in `params.high_water`). **(10) Watchlist auto-syncs all strategy tickers** + client-side `fixTicker()` typo correction. **(11) PENDING: Alpaca data API** (free extended-hours prices + market-hours gate so the bot stops placing orders after-hours; the all-hours `*/15` cron currently no-ops via broker rejection outside RTH). **(12) DCA UI cleanup** (commit `02cbe00`) — DCA strategies now render as accumulate-and-hold (DCA tag, "ACCUMULATE · Nd", "CAPITAL DEPLOYED" bar, no meaningless 0% target/stop). **(13) SnapTrade broker-capability research** — what can actually trade (+fractional) via SnapTrade: **Fidelity = READ-ONLY (no order placement)**, **E\*Trade = whole-shares-only**, **Robinhood = trade + fractional + instant deposits** (the match for fractional baskets), Schwab = trade but likely whole-share via API, Coinbase = crypto-only, Chase/Firstrade unconfirmed. **(14) PENDING: equal-weight fractional $50/wk basket DCA** (~15–17 wks) over a user halal symbol list — must run on **Robinhood** (Fidelity can't trade, E\*Trade can't do fractional); blocked on symbol list + full-auto-vs-semi for `khanstyle02` (beta = full-auto root-only). See [[bot-execution-model]], [[bot-snaptrade-impact-401]], [[alpaca-data-pending]], [[snaptrade-broker-capabilities]].
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
- **Route logic**: `lib/handlers.mjs` (~6,070 lines — **see Section 7**)
- **Support libs**: `lib/alerts.mjs`, `lib/anomaly.mjs`, `lib/crypto.mjs`, `lib/fetchWithRetry.mjs`, `lib/logger.mjs`, `lib/notify.mjs`, `lib/rateLimit.mjs`, `lib/sentry.mjs`

### Database (Supabase / PostgreSQL)
24 migrations — all sequential (011 gap was patched; note two files share the `023` prefix — `023_bot_strategy_type_dca` + `023_email_digest`). Bot tables (020–022) added in the 2026-06-24/25 sessions; `023_bot_strategy_type_dca` (allows `strategy_type='dca'`) added 2026-06-30; `024_etf_holdings_cache` (service-role-only holdings cache for the ETF Overlap Analyzer) added 2026-07-05:

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

**2. ~~SnapTrade 5xx spike detector is still in-memory~~ — RESOLVED (corrected 2026-07-05)**
This was stale: `trackSnapTradeError` (`lib/anomaly.mjs:110-132`) is **DB-backed** via `security_events`, same as the brute-force/IP-block detector — verified by direct code inspection in the 2026-07-05 security audit. No cold-start reset risk. (CLAUDE.md §10.5 corrected to match.)

**3. No test suite**
Zero unit tests, zero integration tests, zero E2E tests. Every change is verified manually. The 9,201-line MizanApp.jsx makes retroactive test-writing very difficult. Adding any meaningful test coverage requires component extraction first.

---

### Things Found Broken or Half-Wired

0. **[RESOLVED 2026-06-25] Crons never ran for the app's life.** `CRON_SECRET` was never set in Vercel (a typo'd `CRON_SECRE` had been created). The fail-closed `cronUnauthorized()` (`!CRON_SECRET || bearer mismatch`) therefore 401'd every `/api/cron/*` invocation — empty `cron_jobs`, zero `cron.*` audit rows, recurring `cron.stale` high alert. **Fix: set `CRON_SECRET` in Vercel Production** (Vercel only auto-attaches the cron `Authorization: Bearer` header when that exact var exists). Two code bugs surfaced once crons finally ran and are also fixed: (a) bot-signals 500'd on `.catch is not a function` — three Supabase filter builders chained `.catch()` (which builders don't have); (b) `cron.sync` logged success via `info()` but never wrote an audit row, so the staleness detector + admin "last sync" always read Infinity → now writes `audit({action:"cron.sync"})`. **Watch-outs:** Vercel **Redeploy** reuses the original deployment's env snapshot — a *fresh git build* is required to bind a newly-added env var; and the env-name typo class (`CRON_SECRE`) is silent because nothing reads it.

1. **Order Ticket is double-gated.** The tab renders `<ComingSoon>` for all users. The real UI code is also wrapped in `{false && sub==="order" && ...}` (hardcoded dead code). To re-enable, both the `<ComingSoon>` render AND the `{false && ...}` wrappers must be removed. The backend (`/api/alpaca/order`, `/api/snaptrade/trade/*`) is fully deployed and ready.

2. **Legacy `.snaptrade-users.json` flat file still active.** `lib/handlers.mjs` still reads/writes this file for `mizan_primary` single-user fallback. If it exists on the server, it stores the SnapTrade `userSecret` as unencrypted JSON. Fully deprecating this (Supabase-only path) is partially done but the file-read code path remains active.

3. **Purification `purification_ratios` table needs ongoing maintenance.** Seeded with 8 tickers at launch. New halal ETFs entering the portfolio won't have a ratio and will fall back to 0% (no purification shown). Needs either a data-provider feed or a manual admin UI to add ratios.

4. **`mizan_purification_log` and `mizan_purification_overrides` live in `user_state`/localStorage only.** Unlike Sadaqah entries (which write to `mizan_sadaqah` in user_state via Supabase sync), purification state is only localStorage-mirrored. A new browser/device loses all purification history.
