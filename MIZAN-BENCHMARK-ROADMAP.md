# MĪZAN — Benchmark & Build Roadmap

> Derived from a source-level study of how leading finance apps model debt/payoff and the features Mizan already ships. Benchmarked: **Origin**, **Copilot Money** (commercial), and **Maybe** (archived → active fork `we-promise/sure`), **Firefly III**, **Actual Budget**, **Ghostfolio**, plus `paisa`, `wealthfolio`, `investbrain` (open-source). Last updated 2026-07-06.

---

## 0. Headline findings

1. **Origin & Copilot have debt *visibility* but zero debt *payoff planning*.** No debt-free date, no snowball/avalanche, no countdown-to-$0. Copilot ships payoff as a *separate* app ("Debt Payoff Copilot"). **Mizan's tracker already beats them here** — and Phase 1 (below) extends that lead with a payoff optimizer + amortization + burn-down chart.
2. **Nobody in the field ships true TWR/IRR or risk metrics.** Ghostfolio's `twr`/`mwr` classes literally `throw new Error('not implemented')`; its only real engine is **ROAI** (Modified-Dietz-style). Maybe is plain average-cost. So Mizan's avg-cost is *industry-normal*, not a gap — and adding ROAI-style P&L + XIRR + risk metrics would put Mizan **ahead of the whole field**.
3. **A loan is modeled as "an account with a liability classification + a balance history," not a payoff object** — across Maybe, Firefly, Actual, Ghostfolio. Real payoff math only lives in small dedicated calculators. Winning design = Maybe's account-with-history model + a payoff optimizer none of the big apps ship.
4. **The cost-basis-reset bug does NOT exist in Mizan** (verified 2026-07-06). The one place that self-accumulates a weighted-average book — the bot's `botRealizedPnl` (`lib/handlers.mjs:1301`) — already resets basis on full close (`:1338`). The unrealized path uses the broker's per-position `average_purchase_price` (broker resets on close); the YTD-realized Tax path uses current avg cost as a disclosed approximation (Known Limitation #3). Nothing to fix.

---

## Track 1 — Debt tracker (extend the lead)

| # | Improvement | Proven by | Effort | Status |
|---|-------------|-----------|--------|--------|
| 1 | **Payoff optimizer**: snowball / avalanche / **riba-first**, debt-free date, total interest, payoff order | `cwinland/DebtPaymentPlan` (big apps lack it) | M | **✅ Phase 1 (shipped)** |
| 2 | **Amortization** for interest-bearing debts (interest-aware payoff months) | Maybe `app/models/loan.rb` | S | **✅ Phase 1 (shipped)** |
| 3 | **Burn-down chart** (total balance → $0, inline SVG) | Ghostfolio `AccountBalance` | S | **✅ Phase 1 (shipped)** |
| 4 | **Auto-detect a debt payment in checking → link it to the debt** | Copilot recurring filter + Actual `find-schedules.ts` | M | Pending |
| 5 | **`direction` bit: qard hasan you *lent* vs owe** | Firefly `liability_direction` | S | Pending |
| 6 | **Grounded-AI debt answers** ("total debt", "pay riba-debt vs invest") via `/api/advisor` | Origin's #1 AI use-case | S | Pending |
| 7 | **Optional `min_payment` field** on the debt form (planner currently estimates it) | Maybe `credit_cards.minimum_payment` | S | Pending |
| 8 | **Multi-aggregator fallback** for liabilities (MX/Finicity behind Plaid) | Origin (user-selectable provider) | L | Pending |

---

## Track 2 — Improve Mizan's other built features

| # | Improvement | Proven by (repo · file) | Effort |
|---|-------------|-------------------------|--------|
| 1 | **Materialized daily balance table + reverse calculator** → backfill a real per-day net-worth curve from `snapActivities`; kills the localStorage intraday buffer + monthly buckets (**closes Known Limitation #1**) | maybe `app/models/balance/reverse_calculator.rb` | L |
| 2 | **Rules engine** (`rules`/`triggers`/`actions`) + Islamic actions `set_islamic_category` / `flag_for_purification` / `mark_zakatable` (**closes §16 Muslim-categories gap**) | firefly `SearchRuleEngine.php`; actual `server/rules/` | M |
| 3 | **ROAI-style P&L**: split realized/unrealized + day-weighted-average-capital % return | ghostfolio `calculator/roai/portfolio-calculator.ts:668-835` | M |
| 4 | **Sharia X-Ray rules panel**: haram-concentration, purification-due, compliance-drift, fee-ratio, emergency-fund | ghostfolio `apps/api/src/models/rules/` | M |
| 5 | **Recurring-transaction detection** for BillsCalendar (slide start dates, match ±2d + amount + payee, rank `1/(dayDiff+1)`) | actual `server/schedules/find-schedules.ts`; firefly `CalculateXOccurrences.php` (date math) | M |
| 6 | **Risk metrics**: max drawdown, annualized volatility, Sharpe (0% riba-safe risk-free rate) — greenfield, nobody ships it | inputs already stored (`net_worth_history` + Polygon OHLC) | M |
| 7 | **AI tool-calling with per-user enum'd schemas + single-hop loop** on `/api/advisor` (symbol enum = user's tickers, verdict from `shariaScreen`) → structurally blocks hallucinated numbers/verdicts | maybe `assistant/`; wealthfolio `crates/agent-tools/`; investbrain | M |
| 8 | **XIRR / money-weighted return** (the IRR Ghostfolio never finished) | paisa `internal/xirr/xirr.go` (~60 lines, Newton's method) | S–M |
| 9 | **Envelope rollover + "left to assign" pot** (`leftover = budgeted + spent + prevLeftoverPos`) | actual `budget/envelope.ts:52-66`; firefly `AvailableBudget.php` | M |
| 10 | **Goal funding schedules** (`(target−saved)/monthsRemaining`) + **benchmark overlay** (normalize `value/base−1` vs SPUS/HLAL) | actual `budget/goal-template.ts`; ghostfolio `benchmark-comparator` | S each |

**Queue behind these (S–M):** dividend-by-period bucketing → purification-due total; median (not mean) expected spend; internal-transfer linking so transfers net to zero (protects net-worth/cash-flow/Zakat); CSV import→map→dedupe wizard for read-only brokers.

---

## Track 3 — Where Mizan already leads (don't chase)

- **Debt payoff intent + countdown** — ahead of Origin and Copilot.
- **Avg-cost basis** — industry-normal (Ghostfolio *and* Maybe do the same). Don't chase FIFO lots unless manual trade entry is added.
- **Pure GIPS TWR** — nobody ships it; ROAI + XIRR already match/beat the field.
- **Double-entry accounting** — overkill for a read-mostly aggregator (SnapTrade/Plaid are the ledger of record). Borrow only "link internal transfers to net to zero."
- **Sharia screening (AAOIFI), Zakat + live nisab, dividend purification, Muslim-life goal templates** — category of one; no OSS analog. Only borrow the dividend-bucketing math to *feed* purification.

---

## Suggested build order

- **Phase 1 — Debt (✅ shipped):** payoff optimizer + amortization + burn-down. Pure-function, no migration.
- **Phase 2 — Correctness (M):** ROAI P&L + XIRR + risk metrics (T2 #3, #6, #8).
- **Phase 3 — Automation (M):** rules engine + Islamic categories + recurring detection → unlocks debt-payment auto-linking (T2 #2, #5; T1 #4).
- **Phase 4 — Foundations (L):** materialized balance table + reverse calculator (T2 #1); then envelope rollover, Sharia X-Ray, AI tool-calling (T2 #9, #4, #7).

---

## Sources

- **Maybe** (archived) / fork **we-promise/sure** — `app/models/{loan,credit_card,other_liability,account,holding}.rb`, `app/models/balance/{forward,reverse}_calculator.rb`, `db/schema.rb`, `app/models/{rule,budget}.rb`, `app/models/assistant/*`.
- **Firefly III** — `app/TransactionRules/Engine/SearchRuleEngine.php`, `app/Support/Repositories/Recurring/CalculateXOccurrences.php`, `app/Models/{Account,Bill,AvailableBudget}.php`, docs `explanation/financial-concepts/liabilities`.
- **Actual** — `packages/loot-core/src/server/budget/{envelope,goal-template}.ts`, `.../server/rules/*`, `.../server/schedules/find-schedules.ts`.
- **Ghostfolio** — `apps/api/src/app/portfolio/calculator/roai/portfolio-calculator.ts`, `apps/api/src/models/rules/*`, `benchmark-comparator.component.ts`.
- **Newer** — `wealthfolio/wealthfolio` (`crates/agent-tools/`), `ananthakumaran/paisa` (`internal/xirr/xirr.go`), `investbrainapp/investbrain` (`ChatWithHoldingAgent.php`), `rotki/rotki` (FIFO/LIFO/ACB basis).
- **Commercial** — Origin (useorigin.com help/blog), Copilot Money (help.copilot.money — Accounts, Creating/Optimizing Recurrings, aggregator stack).
