-- 010_plaid_transactions.sql
--
-- Persistent storage for Plaid transactions, with cursor-based sync.
--
--   plaid_transactions       — one row per Plaid transaction. Server-side
--                              service-role writes on /transactions/sync;
--                              browser reads its own rows via RLS.
--   plaid_tokens.transactions_cursor
--                            — per-Item cursor advanced after each sync
--                              call. NULL means "never synced yet" and the
--                              first call will receive the full history.

-- ── plaid_transactions ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.plaid_transactions (
  id                  bigserial PRIMARY KEY,
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id             text NOT NULL,
  account_id          text NOT NULL,
  transaction_id      text NOT NULL UNIQUE,
  amount              numeric,
  iso_currency_code   text,
  name                text,
  merchant_name       text,
  category_primary    text,
  category_detailed   text,
  date                date,
  pending             boolean DEFAULT false,
  payment_channel     text,
  raw_data            jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS plaid_transactions_user_idx
  ON public.plaid_transactions (user_id);
CREATE INDEX IF NOT EXISTS plaid_transactions_item_idx
  ON public.plaid_transactions (item_id);
CREATE INDEX IF NOT EXISTS plaid_transactions_account_idx
  ON public.plaid_transactions (account_id);
CREATE INDEX IF NOT EXISTS plaid_transactions_date_desc_idx
  ON public.plaid_transactions (date DESC);
CREATE INDEX IF NOT EXISTS plaid_transactions_user_date_desc_idx
  ON public.plaid_transactions (user_id, date DESC);

ALTER TABLE public.plaid_transactions ENABLE ROW LEVEL SECURITY;

-- Browser can read its own transactions via the anon-key client.
-- Inserts/updates/deletes happen exclusively through the service-role key
-- on the server-side sync handler, so no policies are needed for those.
DROP POLICY IF EXISTS "plaid_transactions_select_own" ON public.plaid_transactions;
CREATE POLICY "plaid_transactions_select_own"
  ON public.plaid_transactions FOR SELECT
  USING (auth.uid() = user_id);

-- ── plaid_tokens.transactions_cursor ───────────────────────────────────────
-- Stores Plaid's opaque cursor between /transactions/sync calls so we
-- only pull diffs after the initial backfill.
ALTER TABLE public.plaid_tokens
  ADD COLUMN IF NOT EXISTS transactions_cursor text;
