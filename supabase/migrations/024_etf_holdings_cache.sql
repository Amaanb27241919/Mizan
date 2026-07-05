-- 024_etf_holdings_cache.sql
--
-- Shared cache for ETF / fund constituent holdings, powering the ETF Overlap
-- Analyzer. Two sources feed this one table:
--   • 'alphavantage' — ETF_PROFILE (free tier, 25 req/day) refreshed ~daily.
--     Bounded to the known halal ETF universe so daily calls stay << 25.
--   • 'curated'      — hand-maintained snapshots for instruments Alpha Vantage
--     cannot serve: the Amana mutual funds (AMANX/AMAGX/AMDWX/AMAPX), which
--     report holdings only quarterly via SEC N-PORT. Also seeds SPUS/HLAL so
--     the analyzer works before ALPHAVANTAGE_KEY is provisioned.
--
-- Service-role only; the client never touches this table (it calls
-- /api/etf/overlap via apiFetch → requireAuth, and the server reads/writes here
-- with the service role). Same pattern as polygon_cache (009).

CREATE TABLE IF NOT EXISTS public.etf_holdings_cache (
  symbol      text PRIMARY KEY,
  name        text,
  asset_class text NOT NULL DEFAULT 'equity',   -- equity | sukuk
  vehicle     text NOT NULL DEFAULT 'etf',       -- etf | mutual_fund
  holdings    jsonb NOT NULL,                     -- [{ symbol, weight, description }]  weight is a 0..1 fraction
  sectors     jsonb,                              -- [{ sector, weight }] or null (AV only)
  source      text NOT NULL DEFAULT 'alphavantage', -- alphavantage | curated
  fetched_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.etf_holdings_cache ENABLE ROW LEVEL SECURITY;
-- service-role only; no client policies
