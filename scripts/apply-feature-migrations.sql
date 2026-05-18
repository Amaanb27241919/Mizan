-- apply-feature-migrations.sql
--
-- Paste this entire file into the Supabase SQL editor (Dashboard → SQL → New
-- query) and run. It's idempotent — safe to re-run; every CREATE uses
-- IF NOT EXISTS and every CREATE POLICY is preceded by DROP POLICY IF EXISTS.
--
-- Covers the three migrations the new features depend on:
--   012  account_nicknames  → P3-B  per-account display nicknames
--   013  budgets            → P2-A  per-category monthly spending caps
--   014  goals              → P2-C  savings goals + projections
--
-- After running, verify the tables landed with the SELECT at the bottom.
-- Goals/Budgets/Nicknames will start working immediately — the app already
-- returns a friendly "setup pending" message when these tables are absent,
-- and will load real data automatically once the tables exist.

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
