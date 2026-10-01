-- 031_strategy_rank_rebalance.sql
-- Allow a multi-position strategy type.
--
-- Every engine branch to date holds ONE name: a single heldTicker, one
-- high_water mark, one exit. `rank_rebalance` describes a BOOK — rank a
-- universe, hold the top N, keep while inside a wider band, rebalance on a
-- cadence. That cannot be expressed as parameters on the existing types.
--
-- Additive only: one CHECK widened, no existing row touched, no column added.
-- Applied to prod 2026-09-30 and verified.
alter table public.bot_strategies drop constraint if exists bot_strategies_strategy_type_check;
alter table public.bot_strategies add constraint bot_strategies_strategy_type_check
  check (strategy_type = any (array['momentum'::text, 'ma_crossover'::text, 'breakout'::text, 'dca'::text, 'rank_rebalance'::text]));
