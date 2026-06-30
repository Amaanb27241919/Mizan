-- 023_bot_strategy_type_dca.sql
-- Allow the new 'dca' (long-term accumulation / dollar-cost-averaging) strategy
-- type. DCA strategies buy whole shares of a target ticker on a fixed cadence
-- and HOLD — handled by a dedicated branch in the bot-signals cron (no momentum
-- entry, no stop/target/trailing exits). Extends the existing CHECK constraint;
-- the prior three momentum types are unchanged.

alter table public.bot_strategies drop constraint bot_strategies_strategy_type_check;
alter table public.bot_strategies add constraint bot_strategies_strategy_type_check
  check (strategy_type = any (array['momentum'::text, 'ma_crossover'::text, 'breakout'::text, 'dca'::text]));
