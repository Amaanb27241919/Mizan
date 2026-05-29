-- apply-feature-migrations.sql
--
-- Paste this entire file into the Supabase SQL editor (Dashboard → SQL → New
-- query) and run. It's idempotent — safe to re-run; every CREATE uses
-- IF NOT EXISTS and every CREATE POLICY is preceded by DROP POLICY IF EXISTS.
--
-- Covers the migrations the cursor-based Plaid sync and the new features
-- depend on. Apply in order:
--   010  plaid_transactions  → Plaid /transactions/sync persistence
--                              (table) + plaid_tokens.transactions_cursor
--                              column. WITHOUT THIS, /transactions/sync
--                              silently returns "no tokens" because the
--                              fat SELECT errors on the missing column
--                              and supabase-js drops the error.
--   012  account_nicknames   → P3-B  per-account display nicknames
--   013  budgets             → P2-A  per-category monthly spending caps
--   014  goals               → P2-C  savings goals + projections
--
-- After running, verify the tables landed with the SELECT at the bottom.
-- Goals/Budgets/Nicknames will start working immediately — the app already
-- returns a friendly "setup pending" message when these tables are absent,
-- and will load real data automatically once the tables exist. Transactions
-- start syncing on the next /api/plaid/transactions?sync=1 call once 010
-- is applied.

-- ════════════════════════════════════════════════════════════════
-- 010  plaid_transactions — cursor-based Plaid /transactions/sync
-- ════════════════════════════════════════════════════════════════
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
CREATE INDEX IF NOT EXISTS plaid_transactions_user_idx              ON public.plaid_transactions (user_id);
CREATE INDEX IF NOT EXISTS plaid_transactions_item_idx              ON public.plaid_transactions (item_id);
CREATE INDEX IF NOT EXISTS plaid_transactions_account_idx           ON public.plaid_transactions (account_id);
CREATE INDEX IF NOT EXISTS plaid_transactions_date_desc_idx         ON public.plaid_transactions (date DESC);
CREATE INDEX IF NOT EXISTS plaid_transactions_user_date_desc_idx    ON public.plaid_transactions (user_id, date DESC);
ALTER TABLE public.plaid_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "plaid_transactions_select_own" ON public.plaid_transactions;
CREATE POLICY "plaid_transactions_select_own"
  ON public.plaid_transactions FOR SELECT
  USING (auth.uid() = user_id);
ALTER TABLE public.plaid_tokens
  ADD COLUMN IF NOT EXISTS transactions_cursor text;

-- ════════════════════════════════════════════════════════════════
-- 012  account_nicknames — per-user, per-account rename overrides
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.account_nicknames (
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id  text NOT NULL,
  nickname    text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, account_id)
);
ALTER TABLE public.account_nicknames ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "account_nicknames_select_own" ON public.account_nicknames;
CREATE POLICY "account_nicknames_select_own" ON public.account_nicknames
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "account_nicknames_insert_own" ON public.account_nicknames;
CREATE POLICY "account_nicknames_insert_own" ON public.account_nicknames
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "account_nicknames_update_own" ON public.account_nicknames;
CREATE POLICY "account_nicknames_update_own" ON public.account_nicknames
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "account_nicknames_delete_own" ON public.account_nicknames;
CREATE POLICY "account_nicknames_delete_own" ON public.account_nicknames
  FOR DELETE USING (auth.uid() = user_id);

-- ════════════════════════════════════════════════════════════════
-- 013  budgets — per-category monthly spending caps
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.budgets (
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category       text NOT NULL,
  monthly_limit  numeric NOT NULL,
  currency       text NOT NULL DEFAULT 'USD',
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, category)
);
ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "budgets_select_own" ON public.budgets;
CREATE POLICY "budgets_select_own" ON public.budgets
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "budgets_insert_own" ON public.budgets;
CREATE POLICY "budgets_insert_own" ON public.budgets
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "budgets_update_own" ON public.budgets;
CREATE POLICY "budgets_update_own" ON public.budgets
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "budgets_delete_own" ON public.budgets;
CREATE POLICY "budgets_delete_own" ON public.budgets
  FOR DELETE USING (auth.uid() = user_id);

-- ════════════════════════════════════════════════════════════════
-- 014  goals — savings goals + projections
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.goals (
  id              bigserial PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            text NOT NULL,
  target_amount   numeric NOT NULL,
  target_date     date,
  account_ids     text[] NOT NULL DEFAULT '{}'::text[],
  track_mode      text NOT NULL DEFAULT 'account' CHECK (track_mode IN ('account', 'networth', 'manual')),
  manual_progress numeric NOT NULL DEFAULT 0,
  currency        text NOT NULL DEFAULT 'USD',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS goals_user_idx ON public.goals (user_id);
ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "goals_select_own" ON public.goals;
CREATE POLICY "goals_select_own" ON public.goals
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "goals_insert_own" ON public.goals;
CREATE POLICY "goals_insert_own" ON public.goals
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "goals_update_own" ON public.goals;
CREATE POLICY "goals_update_own" ON public.goals
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "goals_delete_own" ON public.goals;
CREATE POLICY "goals_delete_own" ON public.goals
  FOR DELETE USING (auth.uid() = user_id);

-- ════════════════════════════════════════════════════════════════
-- VERIFICATION — should return 3 rows after a successful run
-- ════════════════════════════════════════════════════════════════
SELECT table_name,
       (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename=table_name) AS policy_count
FROM information_schema.tables
WHERE table_schema='public'
  AND table_name IN ('account_nicknames','budgets','goals')
ORDER BY table_name;

-- ════════════════════════════════════════════════════════════════
-- 015  RLS audit — SELECT policies on every user-scoped table
-- ════════════════════════════════════════════════════════════════
-- Pre-launch audit confirms every user-scoped public table has an explicit
-- SELECT policy scoped to auth.uid() = user_id (or = id for profiles).
-- This block re-emits every policy idempotently so re-running is safe.
--
-- Deliberately skipped — service-role only (sensitive):
--   plaid_tokens   — holds access_token; must never reach the browser
--   rate_limits    — opaque throttling counter; RPC-only access
--
-- Deliberately skipped — no user_id column:
--   cron_jobs      — global scheduler ledger
--   polygon_cache  — shared market-data cache
--   auth.sessions  — lives in auth schema, RPC-only bridge in 006

-- (A) Re-emit every existing select_own policy idempotently.
DROP POLICY IF EXISTS "audit_log_select_own" ON public.audit_log;
CREATE POLICY "audit_log_select_own" ON public.audit_log
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_snaptrade_select_own" ON public.user_snaptrade;
CREATE POLICY "user_snaptrade_select_own" ON public.user_snaptrade
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_state_select_own" ON public.user_state;
CREATE POLICY "user_state_select_own" ON public.user_state
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_keys_select_own" ON public.user_keys;
CREATE POLICY "user_keys_select_own" ON public.user_keys
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "plaid_accounts_select_own" ON public.plaid_accounts;
CREATE POLICY "plaid_accounts_select_own" ON public.plaid_accounts
  FOR SELECT USING (auth.uid() = user_id);

-- profiles PK is `id`, NOT `user_id` — do not "fix" this clause.
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "push_select_own" ON public.push_subscriptions;
CREATE POLICY "push_select_own" ON public.push_subscriptions
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "plaid_transactions_select_own" ON public.plaid_transactions;
CREATE POLICY "plaid_transactions_select_own" ON public.plaid_transactions
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "account_nicknames_select_own" ON public.account_nicknames;
CREATE POLICY "account_nicknames_select_own" ON public.account_nicknames
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "budgets_select_own" ON public.budgets;
CREATE POLICY "budgets_select_own" ON public.budgets
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "goals_select_own" ON public.goals;
CREATE POLICY "goals_select_own" ON public.goals
  FOR SELECT USING (auth.uid() = user_id);

-- ════════════════════════════════════════════════════════════════
-- VERIFICATION — SELECT policy count per user-scoped table
-- Every row in (audit_log, user_snaptrade, user_state, user_keys,
-- plaid_accounts, profiles, push_subscriptions, plaid_transactions,
-- account_nicknames, budgets, goals) should report select_policy_count >= 1.
-- ════════════════════════════════════════════════════════════════
SELECT t.table_name,
       (SELECT count(*) FROM pg_policies p
          WHERE p.schemaname = 'public'
            AND p.tablename  = t.table_name
            AND (p.cmd = 'SELECT' OR p.cmd = 'ALL')
       ) AS select_policy_count,
       (SELECT count(*) FROM pg_policies p
          WHERE p.schemaname = 'public'
            AND p.tablename  = t.table_name
       ) AS total_policy_count
FROM information_schema.tables t
WHERE t.table_schema = 'public'
  AND t.table_name IN (
    'audit_log',
    'user_snaptrade',
    'user_state',
    'user_keys',
    'plaid_tokens',
    'plaid_accounts',
    'rate_limits',
    'profiles',
    'cron_jobs',
    'push_subscriptions',
    'polygon_cache',
    'plaid_transactions',
    'account_nicknames',
    'budgets',
    'goals'
  )
ORDER BY t.table_name;
