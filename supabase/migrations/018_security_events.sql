-- 018_security_events.sql
--
-- Persistent security event counters: replaces the in-memory Maps in
-- lib/anomaly.mjs that reset on every Vercel cold start.
--
-- Three event types share this table:
--   ip_block        — a blocked IP address (isIpBlocked reads this)
--   auth_fail       — rolling count of authentication failures per IP
--   snaptrade_5xx   — rolling count of SnapTrade 5xx responses
--
-- Service-role only — no client RLS policies.  The anomaly.mjs module
-- uses the sbAdmin (service-role) client exclusively.
--
-- Cleanup: expired rows are deleted by the /api/cron/cleanup job via
--   DELETE FROM security_events WHERE expires_at < now()
-- so the table stays small in normal operation.

CREATE TABLE IF NOT EXISTS public.security_events (
  id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type   text         NOT NULL,       -- 'ip_block' | 'auth_fail' | 'snaptrade_5xx'
  identifier   text         NOT NULL,       -- IP address, or 'global' for aggregate counters
  count        integer      NOT NULL DEFAULT 1,
  window_start timestamptz  NOT NULL DEFAULT now(),
  expires_at   timestamptz  NOT NULL,
  created_at   timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS security_events_lookup_idx
  ON public.security_events (event_type, identifier);

CREATE INDEX IF NOT EXISTS security_events_expires_idx
  ON public.security_events (expires_at);

ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;
-- No SELECT/INSERT/UPDATE/DELETE policies — service-role key bypasses RLS.
-- Client anon key cannot touch this table at all.

-- ── RPC: increment_security_event ──────────────────────────────────────────
-- Atomically upserts a rolling counter within a time window.
-- If no active row exists for (event_type, identifier), inserts one.
-- If an active row exists, increments count.
-- Returns the current count and whether it reached the threshold.
--
-- Parameters:
--   p_type        text     — event_type value
--   p_identifier  text     — IP or 'global'
--   p_window_secs integer  — rolling window duration in seconds
--   p_threshold   integer  — alert threshold (used only for the return value)
--
-- Returns: TABLE(current_count integer, blocked boolean)

CREATE OR REPLACE FUNCTION public.increment_security_event(
  p_type        text,
  p_identifier  text,
  p_window_secs integer,
  p_threshold   integer
)
RETURNS TABLE(current_count integer, blocked boolean)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_window_start timestamptz := now() - make_interval(secs => p_window_secs);
  v_expires_at   timestamptz := now() + make_interval(secs => p_window_secs);
  v_count        integer;
  v_id           uuid;
BEGIN
  -- Try to find an active row inside the current window
  SELECT id, count INTO v_id, v_count
  FROM public.security_events
  WHERE event_type  = p_type
    AND identifier  = p_identifier
    AND window_start >= v_window_start
    AND expires_at  > now()
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF FOUND THEN
    v_count := v_count + 1;
    UPDATE public.security_events
      SET count      = v_count,
          expires_at = now() + make_interval(secs => p_window_secs)
    WHERE id = v_id;
  ELSE
    v_count := 1;
    INSERT INTO public.security_events(event_type, identifier, count, window_start, expires_at)
    VALUES (p_type, p_identifier, 1, now(), v_expires_at);
  END IF;

  RETURN QUERY SELECT v_count, (v_count >= p_threshold);
END;
$$;
