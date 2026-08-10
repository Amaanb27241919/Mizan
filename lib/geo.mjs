// Region eligibility — the single definition of "can this visitor connect a
// bank through Plaid".
//
// History: from 2026-05-25 (`540ffda`) a Vercel Routing Middleware rewrote
// EVERY non-US visitor to /us-only.html, so a Canadian never reached the app
// at all. The stated reason was Plaid, but the block was far wider than its
// cause: Sharia screening, the Zakat worksheet, the Assistant, the watchlist
// and SnapTrade brokerage linking have no US dependency whatsoever, and
// SnapTrade is itself a Canadian company supporting Questrade and Wealthsimple.
//
// Narrowed 2026-07-31 (owner call): the app is open worldwide, and only the
// Plaid bank-linking path is region-gated. This module is imported by BOTH
// middleware.ts (to publish the country to the client) and lib/handlers.mjs
// (the authoritative server gate), so the two can never disagree about who is
// eligible.

/**
 * Countries Plaid onboards for our account: the US plus the US territories
 * Plaid Link treats as US (Puerto Rico, US Virgin Islands, Guam, Northern
 * Mariana Islands, American Samoa).
 *
 * Widening this set is NOT sufficient to support a new country — Plaid also
 * has to be enabled for that country on the Plaid dashboard, and the
 * link-token's `country_codes` (handlers.mjs) has to include it. Changing this
 * alone would surface a Connect button that fails inside Plaid Link.
 */
export const PLAID_COUNTRIES = Object.freeze(["US", "PR", "VI", "GU", "MP", "AS"]);

const PLAID_SET = new Set(PLAID_COUNTRIES);

/**
 * Countries where Mizan's US tax tooling is applicable.
 *
 * Deliberately a SEPARATE constant from PLAID_COUNTRIES even though the two
 * lists are identical today. They answer different questions — "can this
 * person link a bank" vs "does US tax law apply to them" — and conflating them
 * means that the day Plaid enables Canada, the Tax tab would silently start
 * showing US wash-sale rules to Canadians.
 *
 * Why this gate exists: TaxPlanner applies the 30-day wash-sale rule and
 * quotes a "combined federal + state marginal rate". Canada has no wash-sale
 * rule — it has the superficial loss rule (30 days BEFORE and after, extending
 * to affiliated persons), a 50% capital-gains inclusion rate, provincial
 * rather than state rates, and TFSA/RRSP accounts where harvesting is
 * meaningless because they are already sheltered. Wrong tax guidance costs
 * real money, so we show nothing rather than something plausible and wrong.
 */
export const US_TAX_COUNTRIES = Object.freeze(["US", "PR", "VI", "GU", "MP", "AS"]);

const US_TAX_SET = new Set(US_TAX_COUNTRIES);

/**
 * Does US tax law apply to this visitor?
 *
 * FAILS OPEN, like isPlaidEligible — an unknown country must keep showing the
 * Tax tab. Existing US users can legitimately arrive with no country resolved
 * (the cache-first service worker can serve index.html without a document
 * request, so the middleware never sets the cookie), and hiding a working
 * feature from the actual user base to protect a hypothetical visitor is the
 * worse trade.
 */
export function isUsTaxJurisdiction(country) {
  const cc = normalizeCountry(country);
  if (!cc) return true;
  return US_TAX_SET.has(cc);
}

/** Normalize a header/cookie country to an uppercase 2-letter code, or null. */
export function normalizeCountry(raw) {
  if (typeof raw !== "string") return null;
  const cc = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(cc) ? cc : null;
}

/**
 * Is this visitor eligible to link a bank through Plaid?
 *
 * FAIL-OPEN on an unknown country. An unresolvable IP is common and benign —
 * local dev, preview deploys with no real client IP, some mobile carriers,
 * corporate egress. Blocking those would deny real US users the core
 * integration to punish a geolocation miss; the worst case for letting them
 * through is that Plaid Link itself declines, which it already does gracefully.
 * This mirrors the fail-open the original middleware used.
 */
export function isPlaidEligible(country) {
  const cc = normalizeCountry(country);
  if (!cc) return true;
  return PLAID_SET.has(cc);
}

/** Vercel's edge geolocation header. Lowercase — Node normalizes incoming headers. */
export const COUNTRY_HEADER = "x-vercel-ip-country";

/** Cookie the middleware sets so the SPA can gate the Connect Bank affordance. */
export const COUNTRY_COOKIE = "mz_country";

/** Read the country a request arrived with, preferring the edge header. */
export function countryFromHeaders(headers) {
  if (!headers) return null;
  const get = typeof headers.get === "function"
    ? (k) => headers.get(k)
    : (k) => headers[k];
  return normalizeCountry(get(COUNTRY_HEADER));
}
