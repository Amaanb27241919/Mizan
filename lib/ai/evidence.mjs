/**
 * Turning provider payloads into packet evidence. Pure — no I/O.
 *
 * ⚠️ OWNER-ONLY. T2; see lib/ai/signalSchema.mjs.
 *
 * Two sources, two very different hazards.
 *
 * ── FUNDAMENTALS (Finnhub /stock/metric) ──────────────────────────────────
 * Returns 126 metrics. Passing all of them would be worse than passing none:
 * a model handed a wall of weakly-related ratios pattern-matches on whatever
 * looks dramatic, and the packet stops being evidence and becomes noise with
 * a citation. So a deliberate subset is selected — valuation, growth,
 * profitability, leverage, liquidity — and everything else is dropped.
 *
 * The subtle hazard is UNITS. Finnhub mixes them freely: margins are percent,
 * `totalDebt/totalEquityQuarterly` is a RATIO (0.2955, not 29.55%), and
 * `3MonthAverageTradingVolume` is in MILLIONS of shares. A model reading 0.2955
 * as a percentage concludes the company has almost no debt. Every field here
 * is therefore named with its unit, and the renderer prints the unit too.
 *
 * ── NEWS (Alpaca /v1beta1/news) ───────────────────────────────────────────
 * Real-time on the free tier and multi-symbol in one call. The hazard is not
 * the data, it is PROVENANCE: an article returned for a query about MU may be
 * tagged with six other symbols, and presenting it as news "about" each of
 * them individually overstates its relevance. So every item keeps its full
 * symbol list, and items that merely mention the subject in passing are
 * marked rather than silently promoted.
 *
 * Staleness is the other half. A three-week-old headline presented alongside
 * today's price reads as current. Items are filtered by age and every one
 * carries its timestamp.
 */

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "boolean") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * The metrics worth a model's attention, mapped to unit-explicit names.
 *
 * Key is the output field; value is [finnhubKey, note]. The names carry their
 * units because the source does not.
 */
const METRIC_MAP = Object.freeze({
  pe_ttm:                    "peTTM",
  ps_ttm:                    "psTTM",
  pb_quarterly:              "pbQuarterly",
  revenue_growth_yoy_pct:    "revenueGrowthTTMYoy",
  eps_growth_yoy_pct:        "epsGrowthTTMYoy",
  gross_margin_pct:          "grossMarginTTM",
  net_margin_pct:            "netProfitMarginTTM",
  roe_pct:                   "roeTTM",
  debt_to_equity_ratio:      "totalDebt/totalEquityQuarterly",
  current_ratio:             "currentRatioQuarterly",
  beta:                      "beta",
});

/**
 * Finnhub metric payload → packet fundamentals, or null if nothing usable.
 *
 * Returning null rather than an object of nulls matters: the packet lists a
 * null section in `missing`, which tells the model the data was never
 * fetched. An object full of nulls would instead look like a company with no
 * measurable fundamentals.
 */
export function normalizeFundamentals(raw) {
  const m = raw && typeof raw === "object" ? (raw.metric || raw) : null;
  if (!m || typeof m !== "object") return null;

  const out = {};
  for (const [field, key] of Object.entries(METRIC_MAP)) {
    const v = num(m[key]);
    if (v !== null) out[field] = v;
  }
  // An absurd P/E is usually a negative-earnings artefact, not a valuation.
  if (out.pe_ttm !== undefined && (out.pe_ttm <= 0 || out.pe_ttm > 10_000)) delete out.pe_ttm;

  return Object.keys(out).length ? out : null;
}

/** 52-week range and average volume belong with market data, not fundamentals. */
export function normalizeMarketExtras(raw) {
  const m = raw && typeof raw === "object" ? (raw.metric || raw) : null;
  if (!m || typeof m !== "object") return null;
  const hi = num(m["52WeekHigh"]);
  const lo = num(m["52WeekLow"]);
  // Finnhub reports this in MILLIONS of shares. Converted here so the packet
  // carries one unit for volume throughout.
  const advM = num(m["3MonthAverageTradingVolume"]);
  const out = {};
  if (hi !== null) out.week52_high = hi;
  if (lo !== null) out.week52_low = lo;
  if (advM !== null) out.avg_volume_3m = Math.round(advM * 1_000_000);
  return Object.keys(out).length ? out : null;
}

/**
 * Alpaca news → packet news for ONE symbol.
 *
 * `maxAgeDays` exists because a stale headline beside a live price reads as
 * current. `primaryOnly` is the honest-relevance control: an article tagged
 * with eight symbols is usually about one of them.
 */
export function normalizeNews(raw, symbol, { maxAgeDays = 7, now = Date.now(), limit = 8 } = {}) {
  const items = Array.isArray(raw?.news) ? raw.news : Array.isArray(raw) ? raw : [];
  const sym = String(symbol || "").toUpperCase();
  if (!sym || !items.length) return null;

  const cutoff = now - maxAgeDays * 86400000;
  const out = [];

  for (const a of items) {
    const symbols = (Array.isArray(a?.symbols) ? a.symbols : []).map((s) => String(s).toUpperCase());
    if (!symbols.includes(sym)) continue;

    const headline = typeof a?.headline === "string" ? a.headline.trim() : "";
    if (!headline) continue;

    const t = Date.parse(a?.created_at || a?.updated_at || "");
    if (Number.isFinite(t) && t < cutoff) continue;

    out.push({
      headline: headline.slice(0, 300),
      source: typeof a?.source === "string" ? a.source.slice(0, 60) : null,
      published_at: Number.isFinite(t) ? new Date(t).toISOString() : null,
      url: typeof a?.url === "string" ? a.url.slice(0, 300) : null,
      // Carried so the model can judge relevance itself rather than being told
      // a six-symbol roundup is news about this one company.
      also_mentions: symbols.filter((s) => s !== sym).slice(0, 8),
      // A roundup is not company news. Flagged, not dropped — it is still
      // weak evidence, and dropping it silently would be its own distortion.
      broad: symbols.length > 4,
    });
    if (out.length >= limit) break;
  }

  if (!out.length) return null;
  // Newest first: a model reading top-down should see the current state first.
  out.sort((a, b) => String(b.published_at || "").localeCompare(String(a.published_at || "")));
  return out;
}

/**
 * Render the fundamentals block with its units attached.
 *
 * The renderer in marketPacket.mjs prints `key: value`, which for
 * `debt_to_equity_ratio: 0.2955` is already unambiguous — but only because
 * the key says "ratio". This helper exists so the unit convention has one
 * home, and a future field cannot be added without declaring its unit.
 */
export const FUNDAMENTAL_UNITS = Object.freeze({
  pe_ttm: "x", ps_ttm: "x", pb_quarterly: "x",
  revenue_growth_yoy_pct: "%", eps_growth_yoy_pct: "%",
  gross_margin_pct: "%", net_margin_pct: "%", roe_pct: "%",
  debt_to_equity_ratio: "ratio (0.30 = 30% of equity)",
  current_ratio: "ratio", beta: "vs market",
});
