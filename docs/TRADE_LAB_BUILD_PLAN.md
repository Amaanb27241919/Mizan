# Mīzan Trade Lab — build plan

**Written 2026-10-01.** Supersedes nothing; sits alongside
`docs/TRADE_PIPELINE.md` (what exists today) and the owner's proposal
(`~/Desktop/Mizan_Trade_Lab_Revised_Proposal_and_AI_Roles.md`, not in repo).

Goal, in the owner's words: run a halal momentum/swing strategy on an Alpaca
**paper** account, gather 3–6 months of forward data, and find out whether
$100k grows meaningfully. Reference point is a working system a family member
runs locally (Python/VS Code, Groq+Gemini+Mistral+OpenRouter, SPUS+SPSK
universe, top-25 hold zone, monthly rebalance).

---

## Two design positions, stated up front

**1. Nothing optimizes for "green days".** The spec asks for "consistent green
days even if it's a 1% increase daily". Optimizing for green-day FREQUENCY
selects for cutting winners early and holding losers, because closing a small
gain makes today green and realizing a loss does not. The equity curve looks
excellent until it doesn't. Green-day count will be REPORTED; max drawdown and
return-per-unit-risk are what the strategy is judged on.

**2. The return target is an outcome, not an input.** "0.5x or 1x in 6–12
months" is 50–100% annualized. Designing toward a number is how a system ends
up overfitted and over-levered. Paper is the right place to find out. Proposal
§16: underperformance must be displayed honestly. SPUS is the benchmark from
day one, not bolted on later.

---

## Phase 0 — the ledger must be true  *(blocks everything)*

Nothing else can be trusted until a signal's `executed` means FILLED.

- [x] `lib/trading/fills.mjs` — pure `readFill` / `reconcileSignal` (`12ea956`)
- [x] **Migration 032: `pending_signals.status` gains `submitted`.** Applied + verified. A sent-but-
      unfilled order has no honest home today. Overloading `pending` makes the
      approval queue show orders already at the market.
- [x] `fetchAlpacaOrders` (batch) + `reconcileSubmittedSignals` (`cedda64`)
- [x] All 5 executed-update sites write `submitted` on the Alpaca path
- [x] Codex review — returned *"not Phase 0 complete yet, the ledger can still
      lie"*, five findings, all five fixed in `cedda64`

### ✅ PHASE 0 COMPLETE — verified live, 2026-10-01 22:45 UTC

Not "the tests pass". A real order on paper account `PA3ME4FKSILU`:

| step | observed |
|---|---|
| place 1 SPUS limit, extended hours | `pending_new` |
| batch read seconds later | `new` → `outcome=open` → verdict **null** (row stays `submitted`) |
| fill | `filled`, `filled_qty:"1"`, `filled_avg_price:"59.88"` |
| reconcile | `{status:"executed", qty:1, suggested_price:59.88, executed_at:"2026-10-01T22:45:01.778Z"}` |
| cancel path, separate order | `canceled` → `{status:"rejected", qty:0}` |

Position closed afterwards; account left flat at $99,999.72 (28¢ of spread).

**Three things only a live order could have shown:**
1. The POST answered `pending_new` while a read moments later said `new` — the
   status moved BETWEEN two calls. That transition is the whole argument
   against marking a row `executed` on a 2xx.
2. `executed_at` is the broker's `filled_at`, not the time the cron ran.
3. Every numeric came back a JSON **string** (`"1"`, `"59.88"`), and `qty` was
   `null` on the notional orders already in the account's history, exactly as
   the spec says and as nothing in a fixture would have forced us to handle.

**What is NOT verified:** a PARTIAL fill, and the SnapTrade venue. Partial
fills are modelled from the spec and unit-tested but have not occurred on this
account. SnapTrade still marks `executed` on place — deliberately, since its
order lifecycle is a different, unresearched API — so the two venues mean
slightly different things by `executed` until that work happens.

## Phase 1 — Trade → Mīzan Trade Lab  *(UI, zero risk)*

The shell that makes everything else legible. Modelled on the reference
dashboard: balance + today's change, allocation bar, strategies table with
LIVE/SHADOW roles, holdings with rank/weight/gain, sector concentration with
its honest warning, activity log, system health, backtest report.

- [ ] Rename and restructure the Trade tab
- [ ] Command-centre summary (value, cash, exposure, mode, kill-switch state)
- [ ] Strategies table showing role, since, started-at, current value
- [ ] Holdings with rank + weight + gain
- [ ] Sector concentration + the "momentum portfolios bunch into one sector"
      warning (descriptive, not advice — stays Tier 1/2)
- [ ] Benchmark line vs SPUS on every strategy

### ✅ PHASE 1 (UI) DONE — 2026-10-09

The Trade tab is "The Trade Lab", a broadsheet on Mizan's paper. The §23 destinations
were folded into eight sections with no data dropped: Desk · Strategies · Positions ·
Orders · Research · Compliance & Risk · Performance · Journal.

The Desk carries every §23 Command Center field: value, cash, exposure, mode, compliance,
risk, pending signals, AI consensus, strategy health, broker health, kill-switch state.

The plan's other UI requirements are also in:
- §16 metrics: SPUS + HLAL, Sharpe/Sortino withheld until 20 days, win rate.
- §18 audit: the Journal record, with model ids and evidence hashes.
- §14: the five kill-switch levels shown against what exists.

Still open (BACKLOG N27–N29): broker kill switch, manual symbol block list, Quant
column. See `docs/TRADE-TAB.md` §2.

## Phase 2 — turn on rank-rebalance  *(the uncle's config)*

- [ ] Universe = SPUS ∪ SPSK constituents (SPUS already cached, 219 names)
- [ ] Flip `RANK_REBALANCE_ENABLED` — same commit as Phase 0 completion
- [ ] Earnings filter (3 days) — needs its own cached Finnhub pass, 60 req/min
      against 219 names
- [ ] Cash sweep to SPSK
- [ ] Start the shadow run, record the start date

## Phase 3 — new strategies, each as a shadow

Every new idea runs as a SHADOW alongside the incumbent. That is the only way
to tell whether it beats what you already have, and it is the structure the
reference system uses.

- [ ] Volume-spike screen (x× average volume)
- [ ] News-driven momentum — AI REVIEWS, deterministic logic PICKS (§36)
- [ ] Swing entry on x% daily move, exit on y% drawdown
- [ ] Premarket — LIMIT ONLY, a broker rule, already enforced in sessions.mjs

## Phase 4 — the record

- [ ] Zakat + tax per closed trade (reuses `computeZakatWorksheet` + the
      purification ledger — genuinely cheap)
- [ ] Export (CSV unless .xlsx is specifically wanted)
- [ ] Continuous backtest + scheduled rebalance
- [ ] Attribution per strategy, benchmarked

---

## What stays out

- **No personalized recommendation reaches any consumer surface.** This is the
  owner's own paper account, owner-gated. The RIA line (CLAUDE.md §1) is
  unchanged and nothing here crosses into consumer Mīzan.
- **No AI in the execution path.** Models review; deterministic code decides.
- **Live money stays on the existing, unchanged path.** Every new branch is
  shadow-only until it has a forward record.

## Sequencing rule

One implementation owner (Claude Code), serial commits, Codex reviews each
money-touching change. Research may run in parallel; implementation does not.
Proposal §27, and four Codex passes in two days have each found something a
unit test could not.
