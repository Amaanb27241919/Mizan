-- 028 — Which parts of Mizan actually get used.
--
-- Purpose: answer "are there too many tabs, and which ones earn their place?"
-- with evidence instead of intuition. Owner-requested 2026-08-18.
--
-- DESIGN: COUNTERS, NOT AN EVENT LOG. This is the whole privacy story and it is
-- deliberate, not incidental:
--
--   * We store a running count per (user, destination). There is NO timeline,
--     so this cannot reconstruct when someone used the app, in what order, or
--     how often they check their money at 2am. `last_viewed` is kept only so
--     genuinely dead surfaces can be told apart from merely quiet ones.
--   * NO financial data of any kind. Not a balance, not a ticker, not a
--     category, not an amount. The only payload is a nav path like
--     "portfolio/tools/backtest".
--   * NO ip, NO user_agent, unlike audit_log — this is product research, not
--     a security trail, and it does not need forensic fields.
--   * At most ~21 rows per user (one per destination), so it stays small
--     forever rather than growing with use.
--
-- audit_log was considered and rejected: it is an append-only SECURITY record
-- with ip/user_agent, and filling it with nav chatter would both bloat it and
-- blur what it is for.

CREATE TABLE IF NOT EXISTS public.nav_usage (
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Slash-delimited destination, e.g. "goals/zakat" or "portfolio/tools/backtest".
  path        text        NOT NULL,
  views       integer     NOT NULL DEFAULT 0,
  last_viewed timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, path),
  CONSTRAINT nav_usage_path_sane CHECK (length(path) BETWEEN 1 AND 96)
);

ALTER TABLE public.nav_usage ENABLE ROW LEVEL SECURITY;

-- A user can read their own counts (so "your most-used tabs" stays possible
-- later). Writes go exclusively through the RPC below.
DROP POLICY IF EXISTS "nav_usage_select_own" ON public.nav_usage;
CREATE POLICY "nav_usage_select_own" ON public.nav_usage
  FOR SELECT USING (auth.uid() = user_id);

-- Atomic increment. SECURITY DEFINER + auth.uid() means a client can only ever
-- increment its OWN counter and can never set an arbitrary value or user_id --
-- the same shape as increment_rate_limit.
CREATE OR REPLACE FUNCTION public.increment_nav_usage(p_path text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  IF p_path IS NULL OR length(trim(p_path)) = 0 OR length(p_path) > 96 THEN RETURN; END IF;

  INSERT INTO public.nav_usage (user_id, path, views, last_viewed)
  VALUES (auth.uid(), trim(p_path), 1, now())
  ON CONFLICT (user_id, path)
  DO UPDATE SET views = public.nav_usage.views + 1, last_viewed = now();
END;
$$;

REVOKE ALL ON FUNCTION public.increment_nav_usage(text) FROM public;
GRANT EXECUTE ON FUNCTION public.increment_nav_usage(text) TO authenticated;

COMMENT ON TABLE public.nav_usage IS
  'Per-user view COUNTS per navigation destination. Counters only -- no timeline, no financial data, no ip/user_agent. Answers "which surfaces earn their place".';

-- Server-side variant. The API route runs under the SERVICE ROLE, where
-- auth.uid() is NULL — so increment_nav_usage() above would have returned
-- early and silently recorded nothing. The route has already verified the
-- caller's JWT (verifyUser) before this point, so passing the id explicitly is
-- safe; it is never granted to `authenticated`, so a client cannot call it and
-- attribute a view to somebody else.
CREATE OR REPLACE FUNCTION public.increment_nav_usage_admin(p_user uuid, p_path text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user IS NULL THEN RETURN; END IF;
  IF p_path IS NULL OR length(trim(p_path)) = 0 OR length(p_path) > 96 THEN RETURN; END IF;

  INSERT INTO public.nav_usage (user_id, path, views, last_viewed)
  VALUES (p_user, trim(p_path), 1, now())
  ON CONFLICT (user_id, path)
  DO UPDATE SET views = public.nav_usage.views + 1, last_viewed = now();
END;
$$;

REVOKE ALL ON FUNCTION public.increment_nav_usage_admin(uuid, text) FROM public;
REVOKE ALL ON FUNCTION public.increment_nav_usage_admin(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.increment_nav_usage_admin(uuid, text) TO service_role;
