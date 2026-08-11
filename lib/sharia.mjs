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
// A third adapter (OpenBB, PROTOTYPE) activates when OPENBB_API_BASE points at a
// self-hosted `openbb-api` instance. Its value over Finnhub is that OpenBB returns
// a NORMALIZED balance sheet — `total_debt`, `total_assets`, `cash_and_short_term_
// investments` — instead of raw per-filer XBRL concepts. That deletes two sources
// of wrong verdicts: the prefix-agnostic concept name matching in bsConcept(), and
// the debt = (debt/equity ratio × book equity) reconstruction. Precedence is
// Zoya > OpenBB > Finnhub, and any OpenBB failure falls back to Finnhub, so an
// unset OPENBB_API_BASE means byte-identical behavior to today.
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
// OpenBB (PROTOTYPE): base URL of a self-hosted `openbb-api` (default localhost:6900).
// Unset ⇒ the adapter is dormant and screening behaves exactly as it does today.
// OPENBB_PROVIDER selects the upstream data vendor inside OpenBB; `yfinance` is the
// keyless default so the prototype costs nothing to evaluate.
const OPENBB_API_BASE = (process.env.OPENBB_API_BASE || "").trim().replace(/\/+$/, "");
// `sec` (free, straight from EDGAR) is the default: it is the only free provider
// with an explicitly declared balance-sheet schema. `yfinance` is also keyless but
// its model declares almost nothing and passes Yahoo's fields through dynamically
// (openbb Data sets extra="allow"), so field presence is not guaranteed per symbol.
// `fmp`/`intrinio` are paid and are the only providers exposing a single total_debt.
const OPENBB_PROVIDER = (process.env.OPENBB_PROVIDER || "sec").trim();
// OpenBB's REST API authenticates with HTTP BASIC (single shared user/pass from
// OPENBB_API_USERNAME/PASSWORD on that service) — NOT a bearer token. Auth is OFF
// by default upstream, so these must be set on any non-loopback deployment.
const OPENBB_USERNAME = (process.env.OPENBB_USERNAME || "").trim();
const OPENBB_PASSWORD = (process.env.OPENBB_PASSWORD || "").trim();
const OPENBB_TIMEOUT_MS = Number(process.env.OPENBB_TIMEOUT_MS || 8000);

// Filings/vendor figures arrive in dollars; every ratio input is carried in MILLIONS
// to match Finnhub profile2.marketCapitalization's unit.
const MM = 1e6;

export function activeShariaProvider() {
  if (ZOYA_API_KEY) return "zoya";
  if (OPENBB_API_BASE) return "openbb";
  return "finnhub";
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

// ── OpenBB adapter (PROTOTYPE — activates when OPENBB_API_BASE is set) ───────
// Talks to a self-hosted OpenBB Platform REST API (`openbb-api`, FastAPI on :6900).
// Envelope is { results: [...], provider, warnings }. OpenBB is AGPLv3: run it as a
// SEPARATE unmodified service reached over HTTP — do not vendor its source in here.
async function obbGet(path, params) {
  const qs = new URLSearchParams({ ...params, provider: OPENBB_PROVIDER });
  const headers = { Accept: "application/json" };
  if (OPENBB_USERNAME && OPENBB_PASSWORD) {
    headers.Authorization = `Basic ${Buffer.from(`${OPENBB_USERNAME}:${OPENBB_PASSWORD}`).toString("base64")}`;
  }
  // A hung self-hosted backend must not pin a serverless invocation open.
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), OPENBB_TIMEOUT_MS);
  try {
    const res = await fetch(`${OPENBB_API_BASE}/api/v1/${path}?${qs}`, { headers, signal: ctl.signal });
    if (!res.ok) throw new Error(`openbb_${res.status}`);
    const d = await res.json();
    const r = d?.results;
    return Array.isArray(r) ? r : r ? [r] : [];
  } finally { clearTimeout(timer); }
}

// First finite value among the candidate keys, else null (UNKNOWN — never a false 0).
// NOTE: this is still a candidate list, but a materially different one from the
// Finnhub path. bsConcept() guesses across per-FILER XBRL concepts (unbounded — every
// REIT and foreign issuer invents new debt lines). These keys are OpenBB's own
// standardized model fields: a small, finite set that varies only by OpenBB version
// and upstream provider model, not by company. Confirm against your instance's
// /api/v1/openapi.json once, then it's stable.
function obbNum(row, ...names) {
  for (const n of names) {
    const v = Number(row?.[n]);
    if (Number.isFinite(v)) return v;
  }
  return null;
}

// PURE (no I/O) — the whole OpenBB→ratio-engine mapping, so it is unit-testable
// without a live backend. Returns the same shape/units fhFundamentals() does.
// `debtSource` is diagnostic only: which field actually supplied debt.
export function normalizeOpenBBFundamentals({ balance, profile, metrics } = {}) {
  const b = balance || {}, p = profile || {}, m = metrics || {};

  const assets = obbNum(b, "total_assets") ?? 0;
  // Cash + short-term (interest-bearing) investments — same definition the AAOIFI
  // cash screen uses on the Finnhub path. A genuinely absent line reads as 0.
  // Field naming differs per provider and is NOT unified by the standard model:
  // fmp/intrinio say `cash_and_cash_equivalents`, sec says `cash_and_equivalents`.
  // Missing the sec spelling silently reads cash as 0 → the cash screen passes at
  // 0.0% and the verdict looks clean. Verified against each provider's model file.
  const cash = obbNum(b, "cash_and_short_term_investments")
    ?? ((obbNum(b, "cash_and_cash_equivalents", "cash_and_equivalents") ?? 0)
        + (obbNum(b, "short_term_investments") ?? 0));
  const recv = obbNum(b, "accounts_receivable", "net_receivables", "receivables") ?? 0;

  // THE win: OpenBB standardizes total_debt, so no ratio×equity reconstruction and
  // no summing of filer-specific debt concepts. Fail-closed contract is preserved —
  // if neither total_debt nor a short/long pair is present, debt stays null (UNKNOWN)
  // so verdictFromFundamentals resolves "review", never a false "halal".
  // ONLY fmp exposes a single total_debt. sec/intrinio require summing components,
  // and the composition differs — verified field-by-field against each provider model:
  //   sec      short_term_debt (initial term <1y) + current_portion_of_long_term_debt
  //            + long_term_debt ("classified as NONCURRENT. Excludes lease obligation")
  //   intrinio short_term_debt + long_term_debt (no current-portion field)
  // Dropping current_portion_of_long_term_debt on sec UNDERSTATES debt — the one
  // error direction that can falsely bless a leveraged company as halal. The three
  // sec components are disjoint by definition (initial term vs. remaining maturity),
  // so summing does not double count; the field is absent on fmp/intrinio ⇒ 0 there.
  // NOTE: sec's long_term_debt excludes lease obligations. Whether capitalized leases
  // count as debt is an AAOIFI question, not a data question — resolve with a scholar
  // before promoting sec, because it shifts every ratio.
  let debt = obbNum(b, "total_debt");
  let debtSource = debt === null ? null : "total_debt";
  if (debt === null) {
    const short = obbNum(b, "short_term_debt", "current_debt", "short_term_borrowings");
    const currentLong = obbNum(b, "current_portion_of_long_term_debt");
    const long = obbNum(b, "long_term_debt", "long_term_debt_noncurrent");
    if (short !== null || currentLong !== null || long !== null) {
      debt = (short ?? 0) + (currentLong ?? 0) + (long ?? 0);
      debtSource = "components";
    }
  }

  const mc = obbNum(p, "market_cap", "market_capitalization")
    ?? obbNum(m, "market_cap", "market_capitalization");

  return {
    assets: assets / MM,
    cash: cash / MM,
    recv: recv / MM,
    debt: debt === null ? null : debt / MM,
    mc: mc === null ? 0 : mc / MM,
    industry: p.industry || p.industry_category || p.sector || "",
    name: p.name || p.long_name || p.company_name || undefined,
    country: p.country || p.hq_country || undefined,
    debtSource,
  };
}

async function screenViaOpenBB(tk) {
  const [profile, balance] = await Promise.all([
    // Profile is best-effort: losing it costs marketCap (→ those standards go
    // unverifiable → "review"), which is the correct fail-closed direction.
    obbGet("equity/profile", { symbol: tk }).then(r => r[0] || null).catch(() => null),
    // Balance is required — a throw here bubbles to screenSymbol, which falls back
    // to Finnhub. Net effect is a COVERAGE UNION rather than a hard swap.
    obbGet("equity/fundamental/balance", { symbol: tk, period: "annual", limit: 1 }).then(r => r[0] || null),
  ]);
  if (!balance) throw new Error("openbb_no_balance_sheet");
  // Only pay for a third call when the profile didn't carry market cap.
  const hasMc = Number.isFinite(Number(profile?.market_cap ?? profile?.market_capitalization));
  const metrics = hasMc ? null : await obbGet("equity/fundamental/metrics", { symbol: tk, period: "annual", limit: 1 })
    .then(r => r[0] || null).catch(() => null);

  const f = normalizeOpenBBFundamentals({ balance, profile, metrics });
  return verdictFromFundamentals(tk, {
    industry: f.industry, mc: f.mc,
    debt: f.debt, cash: f.cash, recv: f.recv, assets: f.assets,
    country: f.country, name: f.name,
    nonPermPct: undefined, // OpenBB has revenue-per-segment, but classifying segments
                           // as permissible/non-permissible is a separate project.
    source: "openbb",
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
    // Crypto is NOT auto-classified. This used to return status "halal" with
    // EVERY standard marked pass — a confidently-wrong religious claim. Token
    // permissibility is token-specific and scholar-dependent, and the AAOIFI
    // ratio engine has nothing to say about an asset with no balance sheet, so
    // "every standard passes" was an answer the engine never actually computed.
    //
    // The client already forced "review" for HELD crypto (MizanApp.jsx), but
    // that override keys on the connector-reported asset type, so any path
    // without connector data saw the raw "halal" — including the ad-hoc
    // Screener lookup added today. Fixed at the source: one verdict, one place.
    // Per-token verdicts are BACKLOG N6.
    return { tk: t, status: "review",
             reason: "Cryptocurrency — Sharia status is token-specific and scholar-dependent; Mizan does not auto-classify crypto. Consult a qualified scholar.",
             industry: "Cryptocurrency", assetType: "crypto",
             source: activeShariaProvider(), nonPermPct: null,
             byStandard: Object.fromEntries(Object.keys(STANDARDS).map(k => [k, { pass: null, note: "not evaluated — crypto" }])),
             ethical: ethicalScreen(t), asOf: todayStr() };
  }
  const cached = _cache.get(t);
  if (cached && cached.asOf === todayStr()) return cached.verdict;
  let verdict;
  const provider = activeShariaProvider();
  try {
    verdict = provider === "zoya" ? await screenViaZoya(t)
      : provider === "openbb" ? await screenViaOpenBB(t)
      : await screenViaFinnhub(t);
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

// Per-provider inter-batch pause. Finnhub free tier is the binding constraint
// (3 syms × 3 calls = 9 req/batch against 60/min). OpenBB is self-hosted and needs
// only 2 calls/symbol, but its UPSTREAM (yfinance et al.) still throttles by IP, so
// it gets a shorter pause rather than none. Zoya is a paid direct verdict — no pause.
const BATCH_PAUSE_MS = { finnhub: 1200, openbb: 400, zoya: 0 };

// Screen many symbols with small concurrency, respecting the active provider's limit.
export async function screenBatch(symbols = []) {
  const uniq = [...new Set(symbols.map(s => String(s || "").toUpperCase().trim()).filter(Boolean))].slice(0, 60);
  const out = {};
  const STEP = 3;
  for (let i = 0; i < uniq.length; i += STEP) {
    const batch = uniq.slice(i, i + STEP);
    const settled = await Promise.allSettled(batch.map(tk => screenSymbol(tk)));
    settled.forEach((s, j) => { out[batch[j]] = s.status === "fulfilled" ? s.value : { tk: batch[j], status: "unknown", source: activeShariaProvider() }; });
    const pause = BATCH_PAUSE_MS[activeShariaProvider()] ?? 1200;
    if (pause > 0 && i + STEP < uniq.length) await new Promise(r => setTimeout(r, pause));
  }
  return out;
}

// Exported for scripts/screen-provider-diff.mjs so the harness can run two providers
// side by side in ONE process, bypassing both the env dispatch and the daily cache.
// Not for app code — app code calls screenSymbol/screenBatch.
export const _adapters = { finnhub: screenViaFinnhub, openbb: screenViaOpenBB, zoya: screenViaZoya };
