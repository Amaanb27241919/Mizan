-- 009_polygon_cache.sql
--
-- 24-hour cache for Polygon OHLC bar requests. Backtester users tend to
-- replay the same ticker + date range repeatedly while iterating on a
-- strategy; caching here reduces upstream calls (Polygon free tier:
-- 5/min) and gives the user near-instant re-runs.
--
-- Service-role only; no client policies.

CREATE TABLE IF NOT EXISTS public.polygon_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker text NOT NULL,
  from_date date NOT NULL,
  to_date date NOT NULL,
  timespan text NOT NULL DEFAULT 'day',
  data jsonb NOT NULL,
  cached_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(ticker, from_date, to_date, timespan)
);

CREATE INDEX IF NOT EXISTS polygon_cache_ticker_idx
  ON public.polygon_cache(ticker, from_date, to_date);

ALTER TABLE public.polygon_cache ENABLE ROW LEVEL SECURITY;
-- service-role only; no client policies
