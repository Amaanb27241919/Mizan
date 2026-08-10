// Region + currency awareness for the client.
//
// Two jobs, both consequences of opening Mizan to non-US users on 2026-07-31:
//
//  1. Which country is this visitor in — so the UI can gate the Plaid
//     "Connect Bank" affordance instead of offering a button that 403s.
//     Read from the `mz_country` cookie the Vercel middleware publishes.
//
//  2. Is any connected account denominated in something other than USD.
//     Mizan's math is USD-only end to end — fmtUSD hardcodes `$`/en-US and
//     nisab is computed purely in USD — so a CAD balance summed as USD
//     overstates net worth by the FX rate and can push someone over the Zakat
//     threshold who is not. We have no FX source, so the honest move is to
//     refuse to quote the number, not to quote a wrong one. Same principle as
//     the nisab fix: "Nisab unavailable" beats a stale figure.
//
// Pure — no React, no DOM writes, no I/O. `document.cookie` is passed in.
import { normalizeCountry, isPlaidEligible, isUsTaxJurisdiction, COUNTRY_COOKIE } from '../../lib/geo.mjs'

export { isPlaidEligible, isUsTaxJurisdiction, COUNTRY_COOKIE }

/**
 * Pull the country out of a cookie string (`document.cookie`).
 * Returns null when absent or malformed — callers treat null as "unknown",
 * which is permissive, matching the server's fail-open.
 */
export function countryFromCookie(cookieString) {
  if (typeof cookieString !== 'string' || !cookieString) return null
  for (const part of cookieString.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() !== COUNTRY_COOKIE) continue
    try {
      return normalizeCountry(decodeURIComponent(part.slice(eq + 1).trim()))
    } catch {
      return null
    }
  }
  return null
}

/** Convenience for components: can this visitor start a Plaid bank link? */
export function canConnectBank(cookieString) {
  return isPlaidEligible(countryFromCookie(cookieString))
}

/**
 * Should the US tax tooling (wash-sale harvesting, federal+state rate
 * estimates) be shown? False for a visitor we know is outside US tax
 * jurisdiction — those rules are simply wrong for them. Fails open on unknown.
 */
export function showsUsTaxTools(cookieString) {
  return isUsTaxJurisdiction(countryFromCookie(cookieString))
}

// An account whose currency we were not told is assumed USD. Treating unknown
// as foreign would warn every existing US user — SnapTrade omits the field for
// plenty of custodians — so we only flag an EXPLICIT non-USD code.
const isForeign = (code) =>
  typeof code === 'string' && code.trim() !== '' && code.trim().toUpperCase() !== 'USD'

/**
 * Connected accounts reporting a non-USD currency.
 * @returns {Array<{label: string, currency: string}>}
 */
export function nonUsdAccounts(snapAccounts = [], plaidAccounts = []) {
  const out = []
  for (const a of Array.isArray(snapAccounts) ? snapAccounts : []) {
    if (!a || !isForeign(a.currency)) continue
    out.push({
      label: `${a.brokerage || 'Broker'} — ${a.accountName || a.accountId || ''}`.trim(),
      currency: a.currency.trim().toUpperCase(),
    })
  }
  for (const a of Array.isArray(plaidAccounts) ? plaidAccounts : []) {
    if (!a || !isForeign(a.iso_currency)) continue
    out.push({
      label: `${a.institution_name || 'Bank'} — ${a.name || a.subtype || a.type || ''}`.trim(),
      currency: a.iso_currency.trim().toUpperCase(),
    })
  }
  return out
}

/** True when any connected account is denominated in something other than USD. */
export function hasNonUsdAccounts(snapAccounts, plaidAccounts) {
  return nonUsdAccounts(snapAccounts, plaidAccounts).length > 0
}

/** Distinct non-USD currency codes, sorted — for "shows CAD, GBP" copy. */
export function foreignCurrencyCodes(snapAccounts, plaidAccounts) {
  return [...new Set(nonUsdAccounts(snapAccounts, plaidAccounts).map(a => a.currency))].sort()
}
