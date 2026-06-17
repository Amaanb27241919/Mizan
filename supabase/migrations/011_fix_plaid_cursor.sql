-- 011_fix_plaid_cursor.sql
--
-- BACKGROUND
-- ----------
-- Migration 010_plaid_transactions.sql was applied to production successfully,
-- so plaid_tokens.transactions_cursor and the plaid_transactions table both
-- exist with the correct schema.  However the 011 slot was left empty during
-- development, creating a visible gap in the sequence that the audit flagged as
-- a potential root cause of the historic "Plaid sync silently returns items: 0"
-- bug.
--
-- This migration fills that gap with idempotent DDL so the gap is documented,
-- the schema is verifiably complete, and the migration runner has a clean
-- consecutive sequence.  Every statement uses IF NOT EXISTS / IF NOT EXISTS so
-- it is completely safe to run against a database where 010 was already applied.
--
-- ROOT CAUSE (resolved in handlers.mjs, documented here for posterity)
-- -------------------------------------------------------------------
-- The original silent-failure mechanism:
--   1. plaid_tokens was SELECTed with transactions_cursor in the projection.
--   2. If the column was absent, PostgreSQL returned error 42703.
--   3. The old code did not check tokensRes?.error; it read tokensRes?.data
--      which was null on any PostgREST error and coerced it to [].
--   4. An empty token list caused the handler to return
--      { ok: true, added: 0, items: 0 } — indistinguishable from a real
--      "nothing new" response.
--   5. Fixed in handlers.mjs: the tokens query now explicitly checks
--      tokensRes?.error and returns HTTP 500 with the PostgreSQL error code
--      so a schema mismatch surfaces loudly.
--
-- VERIFICATION (run against production 2026-06-16)
-- -------------------------------------------------
-- SELECT column_name, data_type
-- FROM   information_schema.columns
-- WHERE  table_schema = 'public'
--   AND  table_name   IN ('plaid_tokens','plaid_accounts','plaid_transactions')
-- ORDER  BY table_name, ordinal_position;
--
-- Results confirmed:
--   plaid_tokens        → 8 columns incl. transactions_cursor TEXT  ✓
--   plaid_accounts      → 13 columns, matches 003_plaid.sql exactly ✓
--   plaid_transactions  → 17 columns, matches 010_plaid_transactions.sql ✓

-- ── Safety-net: ensure transactions_cursor exists on plaid_tokens ───────────
ALTER TABLE public.plaid_tokens
  ADD COLUMN IF NOT EXISTS transactions_cursor text;

-- ── Safety-net: ensure plaid_transactions table exists ──────────────────────
-- Matches 010_plaid_transactions.sql exactly.  CREATE TABLE IF NOT EXISTS is
-- a no-op when the table is already present.
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

-- ── Safety-net: indexes ──────────────────────────────────────────────────────
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

-- ── Safety-net: RLS ──────────────────────────────────────────────────────────
ALTER TABLE public.plaid_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "plaid_transactions_select_own" ON public.plaid_transactions;
CREATE POLICY "plaid_transactions_select_own"
  ON public.plaid_transactions FOR SELECT
  USING (auth.uid() = user_id);
