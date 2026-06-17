-- 019_purification.sql
-- Dividend purification ratios: per-ticker impurity percentage used to
-- compute the portion of dividend income that must be donated to charity
-- per AAOIFI standards.  Published values come from the fund manager's
-- annual purification reports; estimates are flagged in the source field.
-- Users can override any ratio in user_state.mizan_purification_overrides.
--
-- Verified on production: 2026-06-16

CREATE TABLE IF NOT EXISTS public.purification_ratios (
  ticker       text        PRIMARY KEY,
  impurity_pct numeric(6,4) NOT NULL DEFAULT 1.5,
  source       text        NOT NULL DEFAULT 'estimated — verify with scholar',
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.purification_ratios ENABLE ROW LEVEL SECURITY;

-- Publicly readable — these are not user-specific financial data
CREATE POLICY "purification_ratios_public_read"
  ON public.purification_ratios FOR SELECT USING (true);

-- Only the service role may write (via migrations or admin tooling)
CREATE POLICY "purification_ratios_service_write"
  ON public.purification_ratios FOR ALL USING (false) WITH CHECK (false);

-- ── Seeded values ──────────────────────────────────────────────────────────
-- Sources:
--   SP Funds  → spfunds.com/purification (annual report)
--   Wahed     → wahedinvest.com/disclosures
--   Amana     → saturna.com/amana/purification
-- All values should be verified annually against the fund's latest report.
-- MĪZAN is not a religious authority — consult a scholar for exact guidance.
INSERT INTO public.purification_ratios (ticker, impurity_pct, source) VALUES
  ('SPUS',  1.70, 'SP Funds S&P 500 Sharia — issuer estimate, verify at spfunds.com annually'),
  ('HLAL',  2.80, 'Wahed FTSE USA Shariah ETF — issuer estimate, verify at wahedinvest.com'),
  ('UMMA',  2.20, 'Wahed Diversified EM Sharia ETF — issuer estimate, verify at wahedinvest.com'),
  ('SPSK',  0.50, 'SP Funds Global Sukuk ETF — sukuk structure minimizes impurity'),
  ('SPRE',  3.80, 'SP Funds S&P Global REIT Sharia ETF — REIT interest income increases impurity'),
  ('SPTE',  1.50, 'SP Funds S&P 500 Sharia Technology ETF — issuer estimate, verify annually'),
  ('AMAGX', 1.20, 'Amana Growth Fund — issuer estimate, verify at saturna.com annually'),
  ('AMANX', 2.40, 'Amana Income Fund — issuer estimate, verify at saturna.com annually')
ON CONFLICT (ticker) DO UPDATE
  SET impurity_pct = EXCLUDED.impurity_pct,
      source       = EXCLUDED.source,
      updated_at   = now();
