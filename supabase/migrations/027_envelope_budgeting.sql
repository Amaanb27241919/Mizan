-- 027 — Envelope (zero-based) budgeting.
--
-- Supersedes the flat `budgets` table (user_id, category, monthly_limit), which
-- had no month dimension and therefore could not support rollover — the single
-- feature every comparable app is praised for. That table is left in place but
-- is DEAD: it held 0 rows across 0 users when this shipped (its UI was built but
-- never mounted), so there is nothing to migrate.
--
-- Model follows actualbudget/actual's envelope core. The important property is
-- that we store as LITTLE as possible: only what the user explicitly chose
-- (`budgeted`, `carryover`). Everything else — leftover, overspend, To Budget —
-- is DERIVED in src/lib/envelope.js. Nothing can drift out of sync with itself
-- because nothing is stored twice.
--
--   leftover[cat][m]   = budgeted + spent + (carryover ? prevLeftover : max(0, prevLeftover))
--   lastMonthOverspent = sum of min(0, prevLeftover) over carryover=false categories
--
-- The period is a first-class row (budget_months), mirroring maybe-finance's
-- Budget model and firefly-iii's AvailableBudget. That is where the manual
-- income fallback lives: 8 of 12 users have no bank linked, so "money you
-- actually have" cannot be assumed to come from Plaid.

-- ── Per-month period ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.budget_months (
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month         date        NOT NULL,
  -- Income the user types in when no bank is linked (or to top up what Plaid
  -- sees). NULL means "derive from linked accounts"; 0 is a real, chosen zero.
  manual_income numeric     NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, month),
  -- `month` is always the first of the month. Enforced here so no client can
  -- write a mid-month date and silently create a second bucket for one month.
  CONSTRAINT budget_months_first_of_month CHECK (date_trunc('month', month)::date = month)
);

-- ── Per-category allocation within a month ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.budget_entries (
  user_id   uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month     date        NOT NULL,
  category  text        NOT NULL,
  budgeted  numeric     NOT NULL DEFAULT 0,
  -- Does a NEGATIVE balance follow this category into next month? When false
  -- (the default, matching Actual), overspend is deducted from next month's
  -- To Budget instead — which is what forces a deliberate reallocation rather
  -- than letting the hole hide inside one category forever.
  carryover boolean     NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, month, category),
  CONSTRAINT budget_entries_first_of_month CHECK (date_trunc('month', month)::date = month),
  CONSTRAINT budget_entries_category_nonempty CHECK (length(trim(category)) > 0)
);

-- Month-range reads ("show me this month") are the only access pattern; the PK
-- prefix (user_id, month) already serves them, so no extra index is warranted.

ALTER TABLE public.budget_months  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "budget_months_select_own" ON public.budget_months;
CREATE POLICY "budget_months_select_own" ON public.budget_months
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "budget_months_insert_own" ON public.budget_months;
CREATE POLICY "budget_months_insert_own" ON public.budget_months
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "budget_months_update_own" ON public.budget_months;
CREATE POLICY "budget_months_update_own" ON public.budget_months
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "budget_months_delete_own" ON public.budget_months;
CREATE POLICY "budget_months_delete_own" ON public.budget_months
  FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "budget_entries_select_own" ON public.budget_entries;
CREATE POLICY "budget_entries_select_own" ON public.budget_entries
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "budget_entries_insert_own" ON public.budget_entries;
CREATE POLICY "budget_entries_insert_own" ON public.budget_entries
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "budget_entries_update_own" ON public.budget_entries;
CREATE POLICY "budget_entries_update_own" ON public.budget_entries
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "budget_entries_delete_own" ON public.budget_entries;
CREATE POLICY "budget_entries_delete_own" ON public.budget_entries
  FOR DELETE USING (auth.uid() = user_id);

COMMENT ON TABLE public.budget_entries IS
  'Envelope budgeting: stores only user intent (budgeted, carryover). Leftover / overspend / To-Budget are derived in src/lib/envelope.js. Supersedes public.budgets.';
COMMENT ON TABLE public.budget_months IS
  'Per-month budget period. manual_income is the fallback for users with no linked bank (8 of 12 at time of writing).';
