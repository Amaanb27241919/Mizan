-- 030_signal_broker.sql
-- Tell a paper fill from a live one, in the ledger itself.
--
-- `pending_signals` (020) recorded WHAT was traded and never WHERE. Position
-- tracking (botPositionFromSignals) and realized P&L (botRealizedPnl) both
-- select purely on status='executed', so once the engine could route to a
-- paper broker, a simulated fill would read exactly like a real one. Both are
-- scoped per strategy_id, so paper can never contaminate a DIFFERENT live
-- strategy's numbers — the risk is that a paper strategy's own P&L is
-- indistinguishable from real money to anyone reading it.
--
-- Found by an independent Codex review of the broker routing seam, before that
-- seam was enabled. Paper routing stays refused in code until this is applied.
--
-- DEFAULTS ARE LOAD-BEARING: every existing row is a live SnapTrade execution,
-- and NOT NULL DEFAULT backfills them as exactly that. No row is ambiguous.

ALTER TABLE public.pending_signals
  ADD COLUMN IF NOT EXISTS broker   text    NOT NULL DEFAULT 'snaptrade',
  ADD COLUMN IF NOT EXISTS paper    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS order_id text;

-- Constrain to the venues the router knows. A value the router cannot resolve
-- must not be storable, or the ledger outlives the code that understands it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pending_signals_broker_check'
  ) THEN
    ALTER TABLE public.pending_signals
      ADD CONSTRAINT pending_signals_broker_check
      CHECK (broker IN ('snaptrade','alpaca_paper'));
  END IF;
END $$;

-- `paper` must agree with `broker` — a row claiming a live venue and a paper
-- fill (or the reverse) is worse than no flag at all, because it reads as
-- deliberate. This makes the pair impossible to write inconsistently.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pending_signals_paper_agrees_check'
  ) THEN
    ALTER TABLE public.pending_signals
      ADD CONSTRAINT pending_signals_paper_agrees_check
      CHECK (paper = (broker = 'alpaca_paper'));
  END IF;
END $$;

COMMENT ON COLUMN public.pending_signals.broker   IS 'Venue that executed (or would execute) this signal. Defaults to snaptrade: every pre-030 row is a live SnapTrade execution.';
COMMENT ON COLUMN public.pending_signals.paper    IS 'True only for simulated fills. Kept in lockstep with broker by a CHECK so a row can never claim both.';
COMMENT ON COLUMN public.pending_signals.order_id IS 'Broker order id — SnapTrade tradeId or Alpaca order id, normalized upstream.';
