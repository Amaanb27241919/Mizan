-- MIZAN per-user state schema.
-- Paste into Supabase SQL Editor and run once.
-- All tables are RLS-protected: a user can only access their own rows.

-- ──────────────────────────────────────────────────────────
-- user_snaptrade
-- Stores SnapTrade user identifiers per Supabase auth user.
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_snaptrade (
  user_id              uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  snaptrade_user_id    text,
  snaptrade_user_secret text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_snaptrade ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_snaptrade_select_own"
  ON public.user_snaptrade FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "user_snaptrade_insert_own"
  ON public.user_snaptrade FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_snaptrade_update_own"
  ON public.user_snaptrade FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_snaptrade_delete_own"
  ON public.user_snaptrade FOR DELETE
  USING (auth.uid() = user_id);

-- ──────────────────────────────────────────────────────────
-- user_state
-- Generic key/value JSON state per user. Composite PK on (user_id, key).
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_state (
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key        text NOT NULL,
  value      jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

ALTER TABLE public.user_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_state_select_own"
  ON public.user_state FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "user_state_insert_own"
  ON public.user_state FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_state_update_own"
  ON public.user_state FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_state_delete_own"
  ON public.user_state FOR DELETE
  USING (auth.uid() = user_id);

-- ──────────────────────────────────────────────────────────
-- user_keys
-- Per-user 3rd-party API keys. `encrypted` flag for future
-- vault integration.
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_keys (
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  finnhub_key text,
  polygon_key text,
  encrypted   boolean NOT NULL DEFAULT false,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_keys_select_own"
  ON public.user_keys FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "user_keys_insert_own"
  ON public.user_keys FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_keys_update_own"
  ON public.user_keys FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_keys_delete_own"
  ON public.user_keys FOR DELETE
  USING (auth.uid() = user_id);

-- ──────────────────────────────────────────────────────────
-- audit_log
-- Append-only record of sensitive actions. Read by the user themselves
-- (their own activity) and by admins (all rows, via service-role on the
-- server). Inserts only happen server-side using the service-role key,
-- so users can't fabricate entries.
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_log (
  id         bigserial PRIMARY KEY,
  user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action     text NOT NULL,            -- e.g. "auth.sign_in", "broker.disconnect"
  target     text,                     -- subject of the action (account id, broker slug, etc.)
  metadata   jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip         inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_user_id_created_at_idx
  ON public.audit_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_action_created_at_idx
  ON public.audit_log (action, created_at DESC);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Users can read their OWN audit trail; no inserts/updates/deletes from
-- the client. The server bypasses RLS via the service-role key for writes.
CREATE POLICY "audit_log_select_own"
  ON public.audit_log FOR SELECT
  USING (auth.uid() = user_id);
