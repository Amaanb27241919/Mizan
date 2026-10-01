-- 032_signal_status_submitted.sql
-- A sent-but-unfilled order needs an honest status of its own.
--
-- The engine has been marking a signal `executed` the moment the broker
-- answered 2xx. Alpaca answers 2xx on ACCEPT: a market order placed outside
-- session hours is queued and fills at the next open, and a notional order can
-- fill partially. So `executed` has meant "we sent it" while every downstream
-- reader — bookFromSignals, realized P&L, the rebalance plan — treats it as
-- "we own it".
--
-- `submitted` is that missing state: at the broker, outcome not yet known.
--
-- WHY NOT REUSE `pending`: it already means "waiting for a human to approve".
-- Overloading it would put orders that are already at the market into the
-- approval queue, and every query counting pending signals would have to
-- remember to exclude them. The whole point of this work is a ledger that
-- cannot lie; an ambiguous status is the wrong place to economize.
--
-- Additive only: one CHECK widened. No existing row is touched — nothing is
-- `submitted` until the reconciliation pass starts writing it.
-- Applied to prod 2026-10-01 and verified.
alter table public.pending_signals drop constraint if exists pending_signals_status_check;
alter table public.pending_signals add constraint pending_signals_status_check
  check (status = any (array['pending'::text, 'submitted'::text, 'approved'::text, 'rejected'::text, 'executed'::text, 'expired'::text]));
