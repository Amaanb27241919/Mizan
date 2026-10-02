-- 033 — make a signal a complete TRADE INTENT: why it was made, and a home
-- for proposals that can never execute.
--
-- Trade Lab §25 requires that "all orders are traceable to a trade intent" and
-- §31 wants a click on any trade to reconstruct WHY it happened. Today a
-- pending_signals row records what was done — ticker, side, qty, fill, broker —
-- and nothing about the reasoning. The rank-rebalance branch computes a
-- momentum score, a volatility, a rank and a target weight for every candidate
-- and then throws all of it away at insert time. Six months from now the
-- question "why did it buy COHR on 2026-10-02?" has no answer in the data.
--
-- Both changes are additive and touch no existing row:
--   * `rationale` is nullable with no default, so every current row stays valid
--     and nothing is backfilled with invented reasoning.
--   * the status CHECK is WIDENED only. No existing value is removed, so no
--     row can be made illegal by applying this.

-- ── 1. The "why" ────────────────────────────────────────────────────────────
-- jsonb rather than columns because the shape differs per strategy type: a
-- rank-rebalance intent carries rank/momentum/volatility/target_weight, a DCA
-- intent carries cadence and deployed capital, and a future AI intent will
-- carry model verdicts and a packet id. Columns would force every strategy to
-- share one shape, and the honest shape is per-strategy.
--
-- It is DESCRIPTIVE, never load-bearing: nothing may read this to decide
-- whether to trade. Execution decisions stay in code and in the deterministic
-- gates, so a malformed or absent rationale can never change behaviour.
alter table public.pending_signals
  add column if not exists rationale jsonb;

comment on column public.pending_signals.rationale is
  'Why this intent was formed — the decision inputs at the moment of the decision '
  '(e.g. rank, momentum, volatility, target_weight, model verdicts, packet id). '
  'DESCRIPTIVE ONLY: no execution path may read this to decide anything. '
  'Nullable, never backfilled — an absent rationale means "not recorded", never '
  '"no reason".';

-- ── 2. SHADOW ───────────────────────────────────────────────────────────────
-- A shadow strategy proposes and can never execute (lib/trading/executionMode.mjs
-- refuses it at the single chokepoint in executeStrategyOrder). Until now such a
-- proposal had to be stored as 'pending', which was wrong in two visible ways:
-- it appeared in the approval queue looking actionable, and it was swept to
-- 'expired' after 60 minutes — so the forward record the shadow run exists to
-- build would delete itself hourly.
--
-- 'shadow' is terminal on arrival. Nothing transitions out of it.
alter table public.pending_signals
  drop constraint if exists pending_signals_status_check;

alter table public.pending_signals
  add constraint pending_signals_status_check
  check (status in ('pending','submitted','approved','rejected','executed','expired','shadow'));

-- Reading back a shadow strategy's record is the whole point of the mode, and
-- it is always "this strategy, newest first".
create index if not exists pending_signals_strategy_shadow_idx
  on public.pending_signals (strategy_id, created_at desc)
  where status = 'shadow';
