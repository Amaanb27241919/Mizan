-- 006_sessions.sql
--
-- Three RPC functions that let MIZAN's server (via service_role) read
-- and delete rows in auth.sessions on behalf of an authenticated user.
--
-- auth.sessions is in the auth schema (not exposed to PostgREST by
-- default), and the JS admin client doesn't expose a per-session delete.
-- These SECURITY DEFINER functions are the bridge:
--   get_user_sessions(user_id)               → SELECT rows
--   revoke_session(session_id, user_id)      → DELETE one row
--   revoke_other_sessions(user_id, current)  → DELETE all except current
--
-- The server always passes user_id from the verified JWT, so calling
-- code can never delete sessions for a different user. EXECUTE is
-- granted to service_role only — even an authenticated user calling
-- these RPCs directly would be rejected.

CREATE OR REPLACE FUNCTION public.get_user_sessions(p_user_id uuid)
RETURNS TABLE (
  id           uuid,
  user_id      uuid,
  created_at   timestamptz,
  updated_at   timestamptz,
  refreshed_at timestamptz,
  user_agent   text,
  ip           inet,
  not_after    timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = auth, public
AS $$
  SELECT id, user_id, created_at, updated_at, refreshed_at, user_agent, ip, not_after
  FROM   auth.sessions
  WHERE  user_id = p_user_id
  ORDER  BY refreshed_at DESC NULLS LAST, created_at DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_user_sessions(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_user_sessions(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_user_sessions(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_user_sessions(uuid) TO service_role;

-- Delete one session if it belongs to the user. Returns 1 on success, 0 on miss.
CREATE OR REPLACE FUNCTION public.revoke_session(p_session_id uuid, p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, public
AS $$
DECLARE n int;
BEGIN
  WITH d AS (
    DELETE FROM auth.sessions
    WHERE id = p_session_id AND user_id = p_user_id
    RETURNING 1
  )
  SELECT count(*) INTO n FROM d;
  RETURN n;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.revoke_session(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revoke_session(uuid, uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.revoke_session(uuid, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.revoke_session(uuid, uuid) TO service_role;

-- Delete every session for the user EXCEPT the current one. Returns the
-- number of rows deleted. p_current_session can be null to delete all.
CREATE OR REPLACE FUNCTION public.revoke_other_sessions(p_user_id uuid, p_current_session uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, public
AS $$
DECLARE n int;
BEGIN
  WITH d AS (
    DELETE FROM auth.sessions
    WHERE user_id = p_user_id
      AND id <> COALESCE(p_current_session, '00000000-0000-0000-0000-000000000000'::uuid)
    RETURNING 1
  )
  SELECT count(*) INTO n FROM d;
  RETURN n;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.revoke_other_sessions(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revoke_other_sessions(uuid, uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.revoke_other_sessions(uuid, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.revoke_other_sessions(uuid, uuid) TO service_role;
