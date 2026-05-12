-- 001_audit_log.sql
--
-- Append-only record of sensitive actions (auth.sign_in, broker.disconnect,
-- bank.connect, auth.mfa_enrolled, etc.). Inserts happen ONLY server-side
-- via the service-role key so users cannot fabricate entries. Users can
-- read their own trail; admins read everything via service-role bypass.

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

-- Users see only their own audit trail. No client-side inserts/updates/
-- deletes — those must come from the server using the service-role key.
DROP POLICY IF EXISTS "audit_log_select_own" ON public.audit_log;
CREATE POLICY "audit_log_select_own"
  ON public.audit_log FOR SELECT
  USING (auth.uid() = user_id);
