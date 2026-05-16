-- 013_budgets.sql
-- Per-category monthly spending caps. Composite PK on (user_id, category)
-- so each user can have one row per Plaid personal_finance_category.primary
-- value. RLS scopes every operation to the row owner.
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
