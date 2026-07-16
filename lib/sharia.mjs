// ── Sharia screening service (provider-dispatched) ──────────────────────────
// ONE screening engine, server-side, that governs Sharia status app-wide:
// the Screener tab, the Overview compliance counts, the Rebalancer's halal
// mode, and Purification all read the verdict produced here. Previously each
// surface keyed off a hardcoded ~25-ticker demo map; this is the real screen.
//
// Provider seam: Finnhub is the default (free fundamentals). When ZOYA_API_KEY
// is set, the Zoya adapter takes over — same normalized verdict shape, so the
// swap is a server-only change with zero rework downstream. Zoya additionally
// returns a non-permissible-income %, which Purification uses when present.
//
// Every verdict is normalized to:
//   { tk, status, industry, marketCap, assets, debtR, cashR, recvR,
//     byStandard, passCount, failCount, country, name, source, nonPermPct, asOf }
// status ∈ "halal" | "review" | "haram" | "unknown".

const FINNHUB_KEY = (process.env.FINNHUB_KEY || process.env.VITE_FINNHUB_KEY || "").trim();
const ZOYA_API_KEY = (process.env.ZOYA_API_KEY || "").trim();
// Zoya's API base is configurable so the endpoint can be set without a code
// change once partner/free access is provisioned.
const ZOYA_API_BASE = (process.env.ZOYA_API_BASE || "https://api.zoya.finance").trim();

export function activeShariaProvider() {
  return ZOYA_API_KEY ? "zoya" : "finnhub";
}

// ── AAOIFI ratio engine (ported from the client so verdicts are identical) ───
const PROHIBITED_INDUSTRIES = [
  "banks", "banking", "capital markets", "consumer finance", "insurance",
  "diversified financials", "mortgage", "mortgage finance", "reit—mortgage",
  "thrifts & mortgage finance", "financial services",
  "beverages—brewers", "beverages-brewers", "beverages—wineries", "alcoholic beverages",
  "tobacco", "casinos & gaming", "casinos", "gambling",
  "aerospace & defense", // weapons component — flagged for review
];
const REVIEW_INDUSTRIES = [
  "restaurants", "leisure", "hotels resorts & cruise lines", "hotels, resorts & cruise lines",
  "media", "movies & entertainment", "interactive media & services", "entertainment",
  "broadcasting",
];
function classifyIndustry(industry) {
  if (!industry) return "unknown";
  const i = industry.toLowerCase();
  if (PROHIBITED_INDUSTRIES.some(p => i.includes(p))) return "haram";
  if (REVIEW_INDUSTRIES.some(p => i.includes(p))) return "review";
  return "halal";
}

// Sector exclusion is universal across all standards; the ratio thresholds and
// denominator differ per body.
export const STANDARDS = {
  AAOIFI:       { name: "AAOIFI",            denominator: "marketCap",   debtMax: 33,    cashMax: 33,    recvMax: 49,    nonPermMax: 5 },
  DOWJONES:     { name: "Dow Jones Islamic", denominator: "marketCap",   debtMax: 33,    cashMax: 33,    recvMax: 33,    nonPermMax: 5 },
  SP_SHARIAH:   { name: "S&P Shariah",       denominator: "marketCap",   debtMax: 33,    cashMax: 33,    recvMax: 49,    nonPermMax: 5 },
  FTSE_SHARIAH: { name: "FTSE Shariah",      denominator: "totalAssets", debtMax: 33,    cashMax: 33,    recvMax: 50,    nonPermMax: 5 },
  MSCI_ISLAMIC: { name: "MSCI Islamic",      denominator: "totalAssets", debtMax: 33.33, cashMax: 33.33, recvMax: 33.33, nonPermMax: 5 },
  SC_MALAYSIA:  { name: "SC Malaysia (SAC)", denominator: "totalAssets", debtMax: 33,    cashMax: 33,    recvMax: 50,    nonPermMax: 5 },
  IFSB:         { name: "IFSB",              denominator: "totalAssets", debtMax: 33,    cashMax: 33,    recvMax: 50,    nonPermMax: 5 },
};

export function evaluateAgainst(standard, { sector, debt, cash, recv, mc, assets, nonPermPct }) {
  if (sector === "haram") return { pass: false, fails: [{ rule: "Sector", detail: "Prohibited industry" }], ratios: {} };
  const denom = standard.denominator === "totalAssets" ? assets : mc;
  if (!denom || denom <= 0) return { pass: null, fails: [], ratios: {}, reason: `No ${standard.denominator} data` };
  // Debt may be UNKNOWN (null) when neither the debt/equity ratio nor any raw debt
  // concept could be read. Treat unknown as an UNVERIFIABLE test (pass: null) — never
  // a silent 0 that would falsely clear the leverage screen and bless a name "halal".
  const debtKnown = Number.isFinite(debt);
  const debtR = debtKnown ? (debt / denom) * 100 : null;
  const cashR = (cash / denom) * 100, recvR = recv > 0 ? (recv / denom) * 100 : 0;
  const isAssets = standard.denominator === "totalAssets";
  const tests = [
    { rule: `Debt/${isAssets ? "Assets" : "MC"}`, pass: debtKnown ? debtR < standard.debtMax : null, detail: debtKnown ? `${debtR.toFixed(1)}%` : "unknown", limit: standard.debtMax },
    { rule: `Cash/${isAssets ? "Assets" : "MC"}`, pass: cashR < standard.cashMax, detail: `${cashR.toFixed(1)}%`, limit: standard.cashMax },
    { rule: `A/R/${isAssets ? "Assets" : "MC"}`, pass: recv === 0 || recvR < standard.recvMax, detail: recv === 0 ? "n/a" : `${recvR.toFixed(1)}%`, limit: standard.recvMax },
  ];
  // Non-permissible income test — only evaluated when the provider gives us a
  // real figure (Zoya). Finnhub free tier has no revenue-segment breakdown, so
  // for Finnhub this stays unevaluated (sector exclusion carries that weight).
  if (Number.isFinite(nonPermPct)) {
    tests.push({ rule: "Non-permissible income", pass: nonPermPct < standard.nonPermMax, detail: `${Number(nonPermPct).toFixed(1)}%`, limit: standard.nonPermMax });
  }
  // A hard FAIL (pass === false) sinks the standard; otherwise any UNVERIFIABLE
  // test (pass === null, e.g. unknown debt) makes the whole standard unverifiable
  // (null) → the verdict resolves to "review", not a false "halal". Only an
  // all-green standard passes.
  const hardFails = tests.filter(t => t.pass === false);
  const unknowns = tests.filter(t => t.pass === null);
  const pass = hardFails.length ? false : unknowns.length ? null : true;
  return { pass, fails: hardFails, ratios: { debtR, cashR, recvR }, tests };
}

// Build the full normalized verdict from raw fundamentals (provider-agnostic).
export function verdictFromFundamentals(tk, { industry, mc, debt, cash, recv, assets, country, name, nonPermPct, source }) {
  const sector = classifyIndustry(industry);
  if (sector === "haram") {
    const byStandard = Object.fromEntries(Object.keys(STANDARDS).map(k => [k, { pass: false, fails: [{ rule: "Sector" }] }]));
    return { tk, status: "haram", industry, reason: `Prohibited sector: ${industry}`, marketCap: mc, byStandard, country, name, source, nonPermPct: Number.isFinite(nonPermPct) ? nonPermPct : null };
  }
  const byStandard = {};
  Object.entries(STANDARDS).forEach(([key, std]) => {
    byStandard[key] = evaluateAgainst(std, { sector, debt, cash, recv, mc, assets, nonPermPct });
  });
  const passCount = Object.values(byStandard).filter(r => r.pass === true).length;
  const failCount = Object.values(byStandard).filter(r => r.pass === false).length;
  const status = sector === "review" ? "review" : passCount >= 5 ? "halal" : failCount >= 4 ? "haram" : "review";
  const { ratios = {} } = byStandard.AAOIFI || {};
  return {
    tk, status, industry, marketCap: mc, assets,
    debtR: ratios.debtR, cashR: ratios.cashR, recvR: ratios.recvR,
    debtKnown: Number.isFinite(debt), // false ⇒ debt couldn't be verified; status fell to "review"
    byStandard, passCount, failCount, country, name, source,
    nonPermPct: Number.isFinite(nonPermPct) ? nonPermPct : null,
  };
}

const CRYPTO_RE = /^(BTC|ETH|SOL|DOGE|ADA|DOT|LINK|AVAX|MATIC|XRP|LTC|BCH)$/;

// ── Finnhub adapter ─────────────────────────────────────────────────────────
async function fhGet(path) {
  const url = `https://finnhub.io/api/v1/${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(FINNHUB_KEY)}`;
  const r = await fetch(url).then(res => res.ok ? res.json() : null).catch(() => null);
  return r && typeof r === "object" ? r : null;
}
// Pull one balance-sheet line by its local concept name, prefix-agnostic so it
// works for both `us-gaap_*` (US filers) and `ifrs-full_*` (foreign) reports.
// Tries each candidate name in order, returns the first finite value (or 0).
function bsConceptOrNull(bs, ...names) {
  for (const n of names) {
    const hit = bs.find(x => String(x?.concept || "").split(/[_:]/).pop() === n && Number.isFinite(Number(x?.value)));
    if (hit) return Number(hit.value);
  }
  return null; // no candidate concept present → UNKNOWN (distinct from a real 0)
}
// Legacy "0 when absent" lookup — safe for asset/cash/receivable lines where a
// missing line legitimately reads as zero. Debt uses bsConceptOrNull instead so
// a missing debt line stays UNKNOWN rather than a false 0 (see fhFundamentals).
function bsConcept(bs, ...names) {
  const v = bsConceptOrNull(bs, ...names);
  return v === null ? 0 : v;
}

// Extract the fundamentals the AAOIFI ratio engine needs. As of 2026 Finnhub's
// free `stock/metric` returns NULL for the raw totalDebt/cash/assets dollars,
// which silently zeroed every ratio and made all non-haram stocks resolve to
// "review". Two still-free sources are combined:
//   • `stock/financials-reported` → the raw SEC balance sheet (equity, cash,
//     receivables, total assets) via us-gaap/ifrs concepts.
//   • `stock/metric` → still returns the totalDebt/totalEquity RATIO, so
//     debt = ratio × book-equity. This is far more robust than summing raw debt
//     concepts, which vary wildly by filer (REITs/financials use NotesPayable,
//     SecuredDebt, company-specific lines) and are easy to miss → a missed debt
//     line would understate debt and falsely bless a leveraged name as "halal".
// Values are returned in MILLIONS to match profile2.marketCapitalization's unit.
async function fhFundamentals(tk) {
  const [metricRes, fin] = await Promise.all([
    fhGet(`stock/metric?symbol=${encodeURIComponent(tk)}&metric=all`),
    fhGet(`stock/financials-reported?symbol=${encodeURIComponent(tk)}&freq=annual`),
  ]);
  const bs = fin?.data?.[0]?.report?.bs;
  if (!Array.isArray(bs) || !bs.length) return null;
  const assets = bsConcept(bs, "Assets");
  const liabilities = bsConcept(bs, "Liabilities");
  const equity = bsConcept(bs, "StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest")
    || (assets - liabilities);
  // Cash + short-term (interest-bearing) investments.
  const cash = bsConcept(bs, "CashCashEquivalentsAndShortTermInvestments")
    || (bsConcept(bs, "CashAndCashEquivalentsAtCarryingValue", "CashAndCashEquivalents")
        + bsConcept(bs, "ShortTermInvestments", "MarketableSecuritiesCurrent", "AvailableForSaleSecuritiesCurrent", "OtherShortTermInvestments"));
  const recv = bsConcept(bs, "AccountsReceivableNetCurrent", "ReceivablesNetCurrent");
  // Debt via the (still-provided) debt/equity ratio × book equity. A finite ratio
  // with positive equity is authoritative — der === 0 is a *known* zero (genuinely
  // debt-free), not an unknown. Otherwise debt starts UNKNOWN (null) and fails
  // closed unless a raw concept can supply it.
  const metric = (metricRes && metricRes.metric) || {};
  const der = Number(metric["totalDebt/totalEquityAnnual"] ?? metric["totalDebt/totalEquityQuarterly"]);
  let debt = (Number.isFinite(der) && equity > 0) ? der * equity : null; // null = UNKNOWN (fail closed)
  // Fallback when the ratio is missing/unusable (e.g. negative equity): sum the
  // common raw debt concepts across filer conventions — but only if at least one
  // debt line is actually present. If neither the ratio nor any debt concept can
  // be read, debt stays null so a leveraged name is never blessed on a false 0.
  if (debt === null) {
    const curLong = bsConceptOrNull(bs, "LongTermDebtCurrent", "LongTermDebtAndCapitalLeaseObligationsCurrent");
    const curShort = bsConceptOrNull(bs, "ShortTermBorrowings", "CommercialPaper", "NotesAndLoansPayable", "ShortTermDebt", "NotesPayableCurrent");
    const currentDebt = bsConceptOrNull(bs, "DebtCurrent")
      ?? ((curLong === null && curShort === null) ? null : (curLong || 0) + (curShort || 0));
    const longDebt = bsConceptOrNull(bs, "LongTermDebtNoncurrent", "LongTermDebt", "LongTermDebtAndCapitalLeaseObligations", "NotesPayable", "LoansPayable", "SecuredDebt", "UnsecuredDebt");
    if (currentDebt !== null || longDebt !== null) debt = (currentDebt || 0) + (longDebt || 0); // ≥1 concept matched → known
    // else: neither ratio nor any debt concept available → debt stays null (UNKNOWN)
  }
  const MM = 1e6; // filings are in dollars; convert to millions to match marketCap
  return { assets: assets / MM, cash: cash / MM, recv: recv / MM, debt: debt === null ? null : debt / MM };
}
async function screenViaFinnhub(tk) {
  if (!FINNHUB_KEY) return { tk, status: "unknown", reason: "screening_unavailable", source: "finnhub" };
  const [profile, fund] = await Promise.all([
    fhGet(`stock/profile2?symbol=${encodeURIComponent(tk)}`),
    fhFundamentals(tk),
  ]);
  const p = profile || {};
  // No balance sheet (foreign filer w/ unmapped concepts, ETF, or missing) →
  // don't fabricate a ratio pass; the sector screen still applies, and
  // verdictFromFundamentals resolves to "review" (needs manual check) rather
  // than a falsely-confident "halal".
  const f = fund || { assets: 0, cash: 0, recv: 0, debt: null };
  return verdictFromFundamentals(tk, {
    industry: p.finnhubIndustry || p.gicsSector || "",
    mc:     p.marketCapitalization || 0,   // profile2 marketCap is in millions
    debt:   f.debt,
    cash:   f.cash,
    recv:   f.recv,
    assets: f.assets,
    country: p.country, name: p.name,
    nonPermPct: undefined, // Finnhub free tier can't supply revenue-segment data
    source: "finnhub",
  });
}

// ── Zoya adapter (activates when ZOYA_API_KEY is set) ────────────────────────
// Zoya returns a direct compliance verdict plus the AAOIFI ratios and the
// non-permissible-income share. We map its response into the same normalized
// shape. NOTE: the exact field names below must be confirmed against Zoya's
// live API when the key is provisioned — any shape mismatch throws and the
// caller transparently falls back to Finnhub, so this can never break prod.
function mapZoyaStatus(s) {
  const v = String(s || "").toUpperCase();
  if (v === "COMPLIANT" || v === "HALAL" || v === "PASS") return "halal";
  if (v === "NON_COMPLIANT" || v === "NONCOMPLIANT" || v === "HARAM" || v === "FAIL") return "haram";
  if (v === "QUESTIONABLE" || v === "REVIEW" || v === "DOUBTFUL") return "review";
  return "unknown";
}
async function screenViaZoya(tk) {
  // REST shape assumed: GET {base}/advisory/v2/report?symbol=TK with a Bearer
  // key. Adjust the path/field mapping here when wiring the real key — that's
  // the only change needed; everything downstream consumes the normalized shape.
  const url = `${ZOYA_API_BASE}/advisory/v2/report?symbol=${encodeURIComponent(tk)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${ZOYA_API_KEY}`, Accept: "application/json" } });
  if (!res.ok) throw new Error(`zoya_${res.status}`);
  const d = await res.json();
  const rep = d.report || d.data || d;
  const directStatus = mapZoyaStatus(rep.complianceStatus || rep.status || rep.rating);
  const nonPermPct = Number(rep.nonCompliantRevenue ?? rep.nonPermissibleIncomePct ?? rep.haramRevenuePct);
  // Prefer Zoya's direct verdict; fall back to ratio engine using its fundamentals.
  if (directStatus !== "unknown") {
    return {
      tk, status: directStatus,
      industry: rep.industry || rep.sector || "",
      marketCap: Number(rep.marketCap) || 0,
      debtR: Number(rep.debtRatio), cashR: Number(rep.cashRatio), recvR: Number(rep.receivablesRatio),
      byStandard: { AAOIFI: { pass: directStatus === "halal", fails: directStatus === "halal" ? [] : [{ rule: "Zoya verdict" }], ratios: {} } },
      passCount: directStatus === "halal" ? 7 : 0,
      failCount: directStatus === "haram" ? 7 : 0,
      country: rep.country, name: rep.name,
      source: "zoya",
      nonPermPct: Number.isFinite(nonPermPct) ? nonPermPct : null,
    };
  }
  return verdictFromFundamentals(tk, {
    industry: rep.industry || rep.sector || "",
    mc: Number(rep.marketCap) || 0,
    debt: Number(rep.totalDebt) || 0, cash: Number(rep.cash) || 0,
    recv: Number(rep.receivables) || 0, assets: Number(rep.totalAssets) || 0,
    country: rep.country, name: rep.name,
    nonPermPct, source: "zoya",
  });
}

// ── In-memory daily cache (per warm instance) to spare the Finnhub free tier ─
const _cache = new Map(); // tk → { asOf, verdict }
const todayStr = () => new Date().toISOString().slice(0, 10);

// ── Ethical / BDS overlay ────────────────────────────────────────────────────
// An OPTIONAL layer on top of the AAOIFI Sharia verdict. Flags publicly-traded
// companies widely named in BDS / divestment campaigns (e.g. AFSC "Investigate",
// UN OHCHR database). This is a CURATED starting set — not exhaustive, not legal
// advice — meant to be maintained against an authoritative source. It NEVER
// changes the Sharia `status`; it only adds an `ethical` flag that the app
// applies when the user opts into the overlay (default off).
const ETHICAL_EXCLUSIONS = {
  CAT:  "Heavy equipment cited in home-demolition campaigns (BDS/divestment target)",
  HPQ:  "IT/hardware contracts (BDS/divestment target)",
  HPE:  "IT/data-center contracts (BDS/divestment target)",
  MSI:  "Surveillance systems (BDS/divestment target)",
  BKNG: "Lists accommodations in occupied-territory settlements",
  ABNB: "Lists accommodations in occupied-territory settlements",
  EXPE: "Lists accommodations in occupied-territory settlements",
  CVX:  "Operations flagged by divestment campaigns",
  PLTR: "Surveillance/defense contracts flagged by divestment campaigns",
};
export function ethicalScreen(tk) {
  const reason = ETHICAL_EXCLUSIONS[String(tk || "").toUpperCase().trim()] || null;
  return { excluded: !!reason, reason, list: "bds" };
}

// Screen one symbol. Crypto is treated as a commodity (compliant) per most
// contemporary scholars. Never throws — a failure yields an "unknown" verdict.
// Every verdict carries an `ethical` flag (the BDS overlay) so the app can apply
// it when the user has the overlay on — independent of the Sharia status.
export async function screenSymbol(tk) {
  const t = String(tk || "").toUpperCase().trim();
  if (!t) return { tk: t, status: "unknown", reason: "empty", source: activeShariaProvider(), ethical: ethicalScreen(t) };
  if (CRYPTO_RE.test(t)) {
    return { tk: t, status: "halal", industry: "Cryptocurrency", source: activeShariaProvider(), nonPermPct: null,
             byStandard: Object.fromEntries(Object.keys(STANDARDS).map(k => [k, { pass: true, note: "crypto" }])), ethical: ethicalScreen(t), asOf: todayStr() };
  }
  const cached = _cache.get(t);
  if (cached && cached.asOf === todayStr()) return cached.verdict;
  let verdict;
  try {
    verdict = ZOYA_API_KEY ? await screenViaZoya(t) : await screenViaFinnhub(t);
  } catch (e) {
    // Zoya failed (or shape mismatch) → fall back to Finnhub; if that also
    // fails, surface an explicit "unknown" rather than a wrong "halal".
    try { verdict = await screenViaFinnhub(t); }
    catch { verdict = { tk: t, status: "unknown", reason: e?.message || "screen_failed", source: "finnhub" }; }
  }
  verdict.asOf = todayStr();
  verdict.ethical = ethicalScreen(t);
  _cache.set(t, { asOf: verdict.asOf, verdict });
  return verdict;
}

// Screen many symbols with small concurrency, respecting the Finnhub free tier.
export async function screenBatch(symbols = []) {
  const uniq = [...new Set(symbols.map(s => String(s || "").toUpperCase().trim()).filter(Boolean))].slice(0, 60);
  const out = {};
  const STEP = 3;
  for (let i = 0; i < uniq.length; i += STEP) {
    const batch = uniq.slice(i, i + STEP);
    const settled = await Promise.allSettled(batch.map(tk => screenSymbol(tk)));
    settled.forEach((s, j) => { out[batch[j]] = s.status === "fulfilled" ? s.value : { tk: batch[j], status: "unknown", source: activeShariaProvider() }; });
    // 3 syms × 3 Finnhub calls (profile2 + metric + financials) = 9 req/batch;
    // pause ~1.2s to stay within the free tier's 60/min.
    if (ZOYA_API_KEY ? false : i + STEP < uniq.length) await new Promise(r => setTimeout(r, 1200));
  }
  return out;
}
