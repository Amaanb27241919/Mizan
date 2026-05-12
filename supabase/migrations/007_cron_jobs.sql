-- 007_cron_jobs.sql
--
-- Tracks the last-run timestamp + status of each scheduled cron job.
-- Used by the new nightly-snapshot / weekly-digest / dividend-check
-- endpoints to record success/failure for /api/admin/db-status to
-- surface "last run X hours ago".
--
-- Service-role only; no client policies.

CREATE TABLE IF NOT EXISTS public.cron_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name text NOT NULL UNIQUE,
  last_run_at timestamptz,
  last_status text,
  last_error text,
  run_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cron_jobs ENABLE ROW LEVEL SECURITY;
-- No client policies — service-role only.
