-- 004_rate_limits.sql
--
-- Persistent rate limiting that survives cold starts and works across
-- multiple Vercel function instances. Each row is a (user_id, window_key)
-- bucket where window_key encodes the action + hourly timestamp:
--   "snaptrade.login:2026-05-09T14"
--
-- The increment_rate_limit() RPC atomically upserts the row and returns
-- { allowed, count } so the caller never races with itself.

CREATE TABLE IF NOT EXISTS public.rate_limits (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  window_key text NOT NULL,        -- "{action}:{YYYY-MM-DDTHH}"
  count      integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, window_key)
);

CREATE INDEX IF NOT EXISTS rate_limits_user_window_idx
  ON public.rate_limits (user_id, window_key);
CREATE INDEX IF NOT EXISTS rate_limits_created_at_idx
  ON public.rate_limits (created_at);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
-- No client-side policies — every read/write goes through the server
-- using the service-role key. Users cannot see each other's limits.

-- Atomic increment-and-check. Returns one row:
--   { allowed: boolean, count: integer, max: integer }
-- INSERT ... ON CONFLICT keeps the operation single-statement so two
-- concurrent calls cannot both see "count = max" and both decide allowed.
CREATE OR REPLACE FUNCTION public.increment_rate_limit(
  p_user_id    uuid,
  p_window_key text,
  p_max        integer
)
RETURNS TABLE (allowed boolean, count integer, max integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO public.rate_limits (user_id, window_key, count)
  VALUES (p_user_id, p_window_key, 1)
  ON CONFLICT (user_id, window_key)
  DO UPDATE SET count = public.rate_limits.count + 1
  RETURNING public.rate_limits.count INTO v_count;

  RETURN QUERY SELECT (v_count <= p_max) AS allowed, v_count AS count, p_max AS max;
END;
$$;

-- Allow the service role to execute the function. (PostgREST/Supabase
-- automatically grants EXECUTE to authenticated when the function is
-- created — we want to deny that to prevent users from inflating their
-- own counter. Restrict to service_role only.)
REVOKE EXECUTE ON FUNCTION public.increment_rate_limit(uuid, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_rate_limit(uuid, text, integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_rate_limit(uuid, text, integer) FROM anon;
GRANT  EXECUTE ON FUNCTION public.increment_rate_limit(uuid, text, integer) TO service_role;
