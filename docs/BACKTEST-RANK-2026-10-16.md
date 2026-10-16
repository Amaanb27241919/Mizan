# Walk-forward backtest of the rank-rebalance rule — 2026-10-16

Run with `scripts/backtest-rank.mjs`, which calls the **production** functions in
`lib/trading/rank.mjs`. A backtest of a reimplementation tests the
reimplementation, so the rule under test is literally the one that trades.

**Question asked:** the live paper strategies have at most 11 trading days of
record, and the deflated-Sharpe work shipped the same day says nothing is
decidable under 20 — with 14 candidates, considerably more. Rather than wait
until mid-November, can history answer whether the core rule has an edge?

## Setup

Mizar (`97b5b48e`), the untouched control: rank 214 SPUS names by 252-day
momentum, buy the top 25, hold while inside the top 35, inverse-volatility
weighted, rebalance every 7 days. Swept across `buyTop ∈ {10,15,25}`,
`momentum ∈ {63,126,252}`, `rebalance ∈ {7,21}` — 18 variants.

The sweep is not decoration. `assessStrategy` needs the Sharpe of **every**
variant tried in order to deflate the best one, so the grid is the
multiple-testing correction's own input.

Two flaws were found in the harness and fixed before any number below was
believed:

1. **Lookahead.** The first version ranked and traded on the same close. You
   cannot trade at the price you just used to rank. It now ranks on data up to
   yesterday and executes at today's close.
2. **No costs.** Commission-free is not free. Turnover is now charged at 10 bps
   of notional traded (`COST_BPS`).

## Result — the live setting, window 2020-08-18 → 2026-10-16 (1,302 days)

| | Strategy (Mizar's exact live config) | SPUS |
|---|---|---|
| Total return | **+252.1%** | +107.4% |
| Excess | **+144.7 pts** | — |
| Sharpe (annualised) | **1.284** | 0.920 |
| Max drawdown | **−27.6%** | — |
| Trades | 640 | — |

The live configuration ranked **first of 18 on Sharpe**, which is worth noting
on its own: the setting chosen by hand was not a poor one.

Across the grid, three things hold consistently:

- **252-day momentum beats 126 beats 63**, at every `buyTop`. The short-lookback
  variants occupy the bottom of the table; one (`25/63/21`) is the only variant
  that *loses* to the benchmark.
- **A 21-day rebalance matches a 7-day** on Sharpe while cutting trades by
  roughly a third (440 vs 640 at the live setting). That is free: less
  turnover, less cost, and less exposure to the wash-trade conflict that cost
  Aldebaran 360 rejected orders on 2026-10-08.
- **`buyTop` trades return for drawdown.** 10 names returns far more (+429 pts
  at best) and draws down ~35%; 25 names gives the better Sharpe at ~27%.

## The bias check that mattered

Every variant beating the benchmark by 11–438 points is the signature of a
biased universe, not a good rule, so it was tested directly.

**Control: equal-weight buy-and-hold of the same 214 names → +133.2%, against
SPUS +136.0%.** The universe gives away *nothing* for free; holding all of
today's survivors equal-weighted slightly **underperforms** the index. So the
excess is coming from selection within the universe, not from the universe
having been pre-filtered to winners.

That is a real result and it removes the obvious objection. It does not remove
the next one.

## What this does NOT establish — read before acting

- **The window is one regime, and it could not be escaped.** Alpaca's free IEX
  feed only reaches back to 2019, so the test period is 2020–2026: COVID crash,
  recovery, the 2022 bear, and a historic AI/semiconductor run. Dispersion in
  the universe is extreme — MU +1688%, VRT +1545%, NVDA +1422% against CTVA
  −78%, TTD −72%. A trailing-momentum rule is *expected* to look excellent in
  that window. **Pre-2019 behaviour is untested, not reassuring.**
- **Deflated Sharpe corrects for multiple testing, not for regime.** A high DSR
  here means "unlikely to be the luckiest of 18 variants". It says nothing
  about whether 2020–2026 was the luckiest of several possible decades.
- **Survivorship is only partly controlled.** The control above compares
  today's membership against the index; it cannot reconstruct what SPUS held in
  2021 and later dropped.
- **It is not forward evidence.** Mizar's live account is −6.3% against SPUS
  −2.5% over its first 11 trading days. Against a backtested max drawdown of
  −27.6%, that is unremarkable noise in either direction — which is the point:
  11 days cannot confirm or refute a 1,302-day result.

## What follows

**Do not add strategies on the strength of this.** The deflation above is the
argument against it: the bar a strategy must clear is set by the *number of
candidates tried*, so each new variant raises the threshold for every other
one. There are already 14 live paper strategies with ≤14 days of record, four
of them one day old. Candidate count is not the bottleneck; elapsed time is.

The two changes the data actually supports, both of which *reduce* variance
rather than add candidates:

1. **Move the rebalance cadence from 7 days to 21** on the rank strategies —
   same Sharpe, a third fewer trades, less wash-trade exposure.
2. **Prefer 252-day momentum over 63** wherever a strategy is configured for
   the short lookback; 63 is the bottom of every column.

Both are owner decisions. Neither was applied.
