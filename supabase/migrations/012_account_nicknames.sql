-- 012_account_nicknames.sql
--
-- Per-user, per-account display nicknames.
--
-- Users with multiple connections (often 10+) need a way to rename the
-- broker-default labels — "Chase ····0832" doesn't mean anything to them,
-- "Sunduq Amaanah" does. This table is the source of truth for those
-- overrides; the UI falls back to the underlying broker name whenever a
-- row is absent.
--
-- account_id is intentionally `text` because we cover both providers:
--   - SnapTrade `accountId` (uuid)
--   - Plaid    `account_id`  (opaque string)
-- The composite PK (user_id, account_id) means one nickname per (user,
-- account) pair and is also the natural upsert target.

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
