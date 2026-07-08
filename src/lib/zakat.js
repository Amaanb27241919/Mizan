// Zakat + nisab arithmetic — pure, dependency-free, unit-testable.
//
// Islamic-finance core of Mizan. Every number a Muslim relies on to discharge
// a religious obligation lives here, isolated from React/DOM/storage so it can
// be fixture-checked. The live-price fetch (useLiveNisab) and the settings
// store (useZakatSettings / load/saveZakatSettings) stay in the component layer
// — this file is only the math they feed.
//
// Concepts encoded here (see MizanApp Islamic-finance notes):
//   · Nisab: minimum zakatable wealth. Two recognized standards —
//       gold   87.48 g (20 mithqal)  → majority view (Shafi'i/Maliki/Hanbali)
//       silver 612.36 g (200 dirham) → Hanafi view, lower/more-inclusive bar
//   · Investment method: full market value (trader) vs. 30% (long-term holder,
//       AAOIFI approximation of the zakatable share of company assets).
//   · Rate: 2.5% of net zakatable wealth, once above nisab.
//   · Deductions: short-term debt + any negative bank balance reduce wealth.
//
// Nothing here touches React, the DOM, or storage.

// ── Constants ─────────────────────────────────────────────────────────────────
// Troy ounce → gram (exact, matches lib/handlers.mjs /api/metals/spot).
export const TROY_OZ_TO_G = 31.1034768;

// Nisab thresholds in grams of the reference metal.
export const NISAB_GOLD_G = 87.48;
export const NISAB_SILVER_G = 612.36;

// Static USD fallbacks used when live spot prices (Stooq via /api/metals/spot)
// are unavailable. 2026-05-31 spot: 87.48 g × ~$95/g gold, 612.36 g × ~$1.09/g silver.
export const NISAB_GOLD_USD = 8310;
export const NISAB_SILVER_USD = 670;

// Investment-portfolio methodology factors.
//   · full        : 2.5% of full market value (treats the user as a trader).
//   · longterm_30 : 2.5% of 30% of market value (AAOIFI / contemporary fatwa
//                   approximation of the zakatable share of company assets).
export const INVESTMENT_FACTOR_FULL = 1.0;
export const INVESTMENT_FACTOR_LONGTERM = 0.3;

// Zakat rate — 2.5% of net zakatable wealth.
export const ZAKAT_RATE = 0.025;

// Default per-user Zakat settings (silver nisab + long-term investment method).
export const DEFAULT_ZAKAT_SETTINGS = {
  nisabStandard: "silver", // "gold" | "silver"
  investmentMethod: "longterm_30", // "full" | "longterm_30"
};

// ── Unit conversion / spot → nisab ────────────────────────────────────────────
// Round to cents the same way the server does (Math.round(n*100)/100).
export function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

// USD per gram from USD per troy ounce.
export function usdPerGram(usdPerOz) {
  return Number(usdPerOz) / TROY_OZ_TO_G;
}

// Nisab USD value for a given weight (grams) at a given USD-per-gram price.
export function nisabValueForWeight(grams, usdPerGram) {
  return Number(grams) * Number(usdPerGram);
}

// Compute the full metals/nisab payload from gold + silver spot (USD per troy
// ounce). Mirrors lib/handlers.mjs:/api/metals/spot exactly (round2 to cents)
// so the client fallback math and the server never disagree. Returns null when
// either quote is not a positive finite number.
export function nisabFromSpot(goldUsdPerOz, silverUsdPerOz) {
  const goldOz = Number(goldUsdPerOz);
  const silverOz = Number(silverUsdPerOz);
  if (!Number.isFinite(goldOz) || goldOz <= 0) return null;
  if (!Number.isFinite(silverOz) || silverOz <= 0) return null;
  const goldG = usdPerGram(goldOz);
  const silverG = usdPerGram(silverOz);
  return {
    gold_usd_per_oz: round2(goldOz),
    silver_usd_per_oz: round2(silverOz),
    gold_usd_per_g: round2(goldG),
    silver_usd_per_g: round2(silverG),
    nisab_gold_usd: round2(nisabValueForWeight(NISAB_GOLD_G, goldG)),
    nisab_silver_usd: round2(nisabValueForWeight(NISAB_SILVER_G, silverG)),
  };
}

// ── Settings-driven selectors ─────────────────────────────────────────────────
// Investment factor for the user's chosen method (default: long-term 30%).
export function investmentFactor(settings) {
  return settings && settings.investmentMethod === "full"
    ? INVESTMENT_FACTOR_FULL
    : INVESTMENT_FACTOR_LONGTERM;
}

// Resolve the applicable nisab threshold (USD) for the user's chosen standard.
// `live` is { nisab_gold_usd, nisab_silver_usd, source } from useLiveNisab, or
// null. Prefer live spot values over the static fallback so price drift doesn't
// silently mislead — but only when the live payload is present, non-"static",
// and finite (the NaN guard: a bad live value falls back to the constant).
export function nisabValueFor(settings, live) {
  const useLive = live && live.source !== "static";
  const gold =
    useLive && Number.isFinite(live.nisab_gold_usd)
      ? live.nisab_gold_usd
      : NISAB_GOLD_USD;
  const silver =
    useLive && Number.isFinite(live.nisab_silver_usd)
      ? live.nisab_silver_usd
      : NISAB_SILVER_USD;
  return settings && settings.nisabStandard === "gold" ? gold : silver;
}

// ── Zakat computation ─────────────────────────────────────────────────────────
// Any negative bank balance (overdraft / credit) counts as short-term debt.
export function negativeBankAmount(bankBalance) {
  const b = Number(bankBalance) || 0;
  return b < 0 ? Math.abs(b) : 0;
}

// Net zakatable wealth = max(0, zakatable assets − short-term debt − negative
// bank), per AAOIFI guidance on deducting short-term liabilities.
export function netZakatableWealth({
  zakatableAssets = 0,
  shortTermDebt = 0,
  bankBalance = 0,
} = {}) {
  return Math.max(
    0,
    (Number(zakatableAssets) || 0) -
      (Number(shortTermDebt) || 0) -
      negativeBankAmount(bankBalance)
  );
}

// Zakat due on a net-zakatable amount (2.5%).
export function zakatDueOn(zakatable) {
  return (Number(zakatable) || 0) * ZAKAT_RATE;
}

// Nisab gate — is the wealth at or above the threshold?
export function isAboveNisab(zakatable, nisab) {
  return (Number(zakatable) || 0) >= (Number(nisab) || 0);
}

// Full Zakat computation for the Portfolio → Zakat tab. Investment-class wealth
// (`acctTotal`) is scaled by the chosen investment factor; zakatable manual
// assets add at full value; short-term debt and any negative bank balance are
// deducted. Returns the intermediate figures the UI displays plus the final
// due + nisab verdict.
//
// `gateDue` (default false) mirrors the Zakat-tab behavior of always exposing
// the raw 2.5% figure (the UI styles it by `aboveNisab`); pass true to zero the
// due below nisab (the Overview-tile behavior).
export function computeZakat({
  acctTotal = 0,
  settings,
  zakatableManual = 0,
  liabilityTotal = 0,
  bankBalance = 0,
  nisab = 0,
  gateDue = false,
} = {}) {
  const invFactor = investmentFactor(settings);
  const acctZakatable = (Number(acctTotal) || 0) * invFactor;
  const negativeBank = negativeBankAmount(bankBalance);
  const zakatable = netZakatableWealth({
    zakatableAssets: acctZakatable + (Number(zakatableManual) || 0),
    shortTermDebt: liabilityTotal,
    bankBalance,
  });
  const aboveNisab = isAboveNisab(zakatable, nisab);
  const zakatDue = gateDue && !aboveNisab ? 0 : zakatDueOn(zakatable);
  return { invFactor, acctZakatable, negativeBank, zakatable, zakatDue, aboveNisab };
}
