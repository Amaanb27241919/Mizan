-- 002_user_state.sql
--
-- Core per-user tables:
--   user_snaptrade  — SnapTrade user identifier + userSecret per Supabase user
--   user_state      — generic key/value JSON store (watchlist, imports, etc.)
--   user_keys       — per-user 3rd-party API keys (finnhub, polygon)
--
-- All three are RLS-protected to the row's user_id.

-- ── user_snaptrade ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_snaptrade (
  user_id               uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  snaptrade_user_id     text,
  snaptrade_user_secret text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_snaptrade ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_snaptrade_select_own" ON public.user_snaptrade;
CREATE POLICY "user_snaptrade_select_own"
  ON public.user_snaptrade FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_snaptrade_insert_own" ON public.user_snaptrade;
CREATE POLICY "user_snaptrade_insert_own"
  ON public.user_snaptrade FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_snaptrade_update_own" ON public.user_snaptrade;
CREATE POLICY "user_snaptrade_update_own"
  ON public.user_snaptrade FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_snaptrade_delete_own" ON public.user_snaptrade;
CREATE POLICY "user_snaptrade_delete_own"
  ON public.user_snaptrade FOR DELETE
  USING (auth.uid() = user_id);

-- ── user_state ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_state (
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key        text NOT NULL,
  value      jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

ALTER TABLE public.user_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_state_select_own" ON public.user_state;
CREATE POLICY "user_state_select_own"
  ON public.user_state FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_state_insert_own" ON public.user_state;
CREATE POLICY "user_state_insert_own"
  ON public.user_state FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_state_update_own" ON public.user_state;
CREATE POLICY "user_state_update_own"
  ON public.user_state FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_state_delete_own" ON public.user_state;
CREATE POLICY "user_state_delete_own"
  ON public.user_state FOR DELETE
  USING (auth.uid() = user_id);

-- ── user_keys ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_keys (
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  finnhub_key text,
  polygon_key text,
  encrypted   boolean NOT NULL DEFAULT false,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_keys_select_own" ON public.user_keys;
CREATE POLICY "user_keys_select_own"
  ON public.user_keys FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_keys_insert_own" ON public.user_keys;
CREATE POLICY "user_keys_insert_own"
  ON public.user_keys FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_keys_update_own" ON public.user_keys;
CREATE POLICY "user_keys_update_own"
  ON public.user_keys FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_keys_delete_own" ON public.user_keys;
CREATE POLICY "user_keys_delete_own"
  ON public.user_keys FOR DELETE
  USING (auth.uid() = user_id);
