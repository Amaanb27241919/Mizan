/**
 * SEC XBRL company facts → the fundamentals the Sharia screen needs.
 * Pure core (no I/O): `fundamentalsFromFacts` and its helpers. The fetching
 * and caching live in lib/sharia.mjs, which calls this as a FALLBACK when
 * Finnhub cannot supply a balance sheet.
 *
 * Why (2026-10-16). 41% of screened names were returning "review", and 89% of
 * those were data failures rather than genuine borderline calls — Finnhub's
 * newest filing often carries an empty balance sheet. `data.sec.gov` is the
 * primary source those filings come from: free, keyless, no vendor, and every
 * figure carries the accession number of the filing it came from, so a verdict
 * can cite its evidence. That matters because a wrong verdict is a false
 * public claim about a real company.
 *
 * ── THE SAFETY RULE ────────────────────────────────────────────────────────
 * The XBRL tag space is open-ended: filers choose their own concepts. Oracle
 * reports long-term debt as `LongTermNotesPayable` ($122bn) and not as
 * `LongTermDebt` at all, so a chain that misses their tag returns only the
 * $7.2bn current portion — a plausible-looking number that understates debt
 * by 94% and would WRONGLY PASS a heavily leveraged company.
 *
 * Understating debt is the worst failure this module could have, so it never
 * reports a debt figure it is not confident in:
 *   · a long-term component must be found, or the company must positively
 *     have no long-term debt;
 *   · the total may not exceed total liabilities;
 *   · anything else returns null, which the engine already treats as
 *     unverifiable → "review". Fail closed, the same contract the debt test
 *     has always had.
 * Over-stating is the safer direction and is tolerated; under-stating is not.
 *
 * OPERATING LEASES ARE DELIBERATELY EXCLUDED. They are not riba-bearing — an
 * ijara-like obligation to pay rent is not a loan at interest — so a retailer
 * whose only liabilities are store leases genuinely has no debt for this test.
 * Buckle and Aehr both reach that state honestly; they return unknown rather
 * than zero only because no long-term debt concept is present to confirm it,
 * which is the conservative half of the rule above doing its job.
 */
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : null);

/** SEC asks for a contact address in the User-Agent; it is not optional. */
export const SEC_USER_AGENT = process.env.SEC_USER_AGENT || "Mizan (mizan.exchange) contact@mizan.exchange";
export const SEC_FACTS_URL = (cik) => `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, "0")}.json`;
export const SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
/** Filings older than this are not a fair basis for a current ratio test. */
export const MAX_AGE_DAYS = 550;
const FORMS = new Set(["10-K", "10-Q", "20-F", "40-F"]);

/**
 * The newest usable value among `tags`, searched in order of preference.
 * Only annual/quarterly report forms count, and only facts no older than
 * `after` — a tag a filer ABANDONED keeps returning its last value forever
 * (P&G's `CashAndCashEquivalentsAtCarryingValue` still answers with a
 * 2019 figure), which would silently pair a seven-year-old cash number with
 * this year's assets.
 */
export function pickFact(facts, tags, opts) {
  const us = obj(obj(obj(facts)?.facts)?.["us-gaap"]);
  if (!us) return null;
  const after = typeof opts?.after === "string" ? opts.after : "";
  for (const tag of Array.isArray(tags) ? tags : []) {
    const units = obj(obj(us[tag])?.units);
    const rows = Array.isArray(units?.USD) ? units.USD : [];
    let best = null;
    for (const r of rows) {
      if (!obj(r) || !FORMS.has(r.form) || num(r.val) === null) continue;
      const end = typeof r.end === "string" ? r.end : "";
      if (!end || end < after) continue;
      if (!best || end > best.end) best = { value: num(r.val), end, form: r.form, accn: r.accn, fy: r.fy, tag };
    }
    if (best) return best;
  }
  return null;
}

// Ordered by how comprehensive each concept is, most first.
const TAGS = {
  assets: ["Assets"],
  liabilities: ["Liabilities"],
  // Unrestricted cash and short-term investments. The most COMMON tag is
  // `CashCashEquivalentsRestrictedCash...`, deliberately not first: it folds
  // in restricted cash, which is not the liquid balance the test is about.
  cash: ["CashCashEquivalentsAndShortTermInvestments", "CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"],
  shortTermInvestments: ["ShortTermInvestments", "MarketableSecuritiesCurrent", "AvailableForSaleSecuritiesDebtSecuritiesCurrent", "OtherShortTermInvestments"],
  receivables: ["AccountsReceivableNetCurrent", "ReceivablesNetCurrent"],
  revenue: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet"],
  interestIncome: ["InvestmentIncomeInterest", "InvestmentIncomeInterestAndDividend", "InterestIncomeOther", "InterestAndOtherIncome"],
  otherIncome: ["InvestmentIncomeNet", "OtherNonoperatingIncomeExpense", "NonoperatingIncomeExpense"],
  // Debt, most comprehensive first.
  debtCombined: ["DebtLongtermAndShorttermCombinedAmount"],
  debtLongTotal: ["LongTermDebt", "LongTermDebtAndCapitalLeaseObligations"],   // includes the current portion
  // Every alternative here was found by reading what real filers actually tag:
  // Oracle uses LongTermNotesPayable, Coca-Cola and GE Vernova only report the
  // ...AndCapitalLeaseObligations variant, and Palo Alto's debt is convertible.
  // The capital-lease variant bundles leases in with debt, which slightly
  // OVER-states interest-bearing debt — the tolerated direction, and the only
  // figure those filers publish.
  debtLongNoncurrent: ["LongTermDebtNoncurrent", "LongTermNotesPayable", "SeniorNotesNoncurrent", "ConvertibleDebtNoncurrent"],
  debtLongCurrent: ["LongTermDebtCurrent", "LongTermDebtAndCapitalLeaseObligationsCurrent"],
  debtCurrentAll: ["DebtCurrent"],                       // all current debt, incl. the LT current portion
  debtShortOther: ["ShortTermBorrowings", "OtherShortTermBorrowings", "CommercialPaper", "NotesPayableCurrent", "ConvertibleDebtCurrent", "NotesAndLoansPayable"],
};

/**
 * Total interest-bearing debt, or null when it cannot be established safely.
 *
 * `LongTermDebt` was verified to EQUAL noncurrent + current for every filer
 * sampled (MSFT, CSCO, HAL), and `DebtCurrent` is broader than
 * `LongTermDebtCurrent` (Cisco: $10.2bn vs $3.5bn), so the components are
 * combined as noncurrent + all-current to avoid counting the current portion
 * of long-term debt twice.
 */
export function debtFromFacts(facts, opts) {
  const after = opts?.after;
  const at = (key) => pickFact(facts, TAGS[key], { after });
  const combined = at("debtCombined");
  const liabilities = at("liabilities");
  const cap = (total, parts) => {
    // Over-stating is tolerable, exceeding total liabilities is not — that
    // means a tag was misread, and a wrong number is worse than no number.
    if (liabilities && total > liabilities.value * 1.02) return null;
    return { value: total, parts, liabilities: liabilities?.value ?? null };
  };
  if (combined) return cap(combined.value, [{ tag: combined.tag, value: combined.value, end: combined.end }]);

  const longTotal = at("debtLongTotal");
  const noncurrent = at("debtLongNoncurrent");
  const longCurrent = at("debtLongCurrent");
  const currentAll = at("debtCurrentAll");
  const shortOther = (TAGS.debtShortOther).map((t) => pickFact(facts, [t], { after })).filter(Boolean);

  // A long-term component is REQUIRED. Current-only debt with no long-term
  // concept anywhere is ambiguous — it is exactly how Oracle's $122bn went
  // missing — so it is reported as unknown rather than guessed at.
  let longValue = null, longParts = [];
  if (noncurrent) { longValue = noncurrent.value; longParts = [noncurrent]; }
  else if (longTotal && longCurrent) { longValue = longTotal.value - longCurrent.value; longParts = [longTotal, longCurrent]; }
  else if (longTotal) { longValue = longTotal.value; longParts = [longTotal]; }
  if (longValue === null) return null;

  let currentValue = 0, currentParts = [];
  if (currentAll) { currentValue = currentAll.value; currentParts = [currentAll]; }
  else {
    for (const p of [longCurrent, ...shortOther].filter(Boolean)) { currentValue += p.value; currentParts.push(p); }
  }
  const total = longValue + currentValue;
  if (!(total >= 0)) return null;
  // One entry per tag. The current portion legitimately appears in both halves
  // — subtracted out of the long-term total, then added back as current — and
  // listing it twice would make the citation trail look like a double count
  // when the arithmetic is right.
  const seen = new Set();
  const parts = [...longParts, ...currentParts]
    .filter((p) => !seen.has(p.tag) && seen.add(p.tag))
    .map((p) => ({ tag: p.tag, value: p.value, end: p.end }));
  return cap(total, parts);
}

/**
 * Every figure the ratio engine needs, in MILLIONS to match the market cap
 * unit `verdictFromFundamentals` expects, or null when the filing set is
 * unusable. `periodEnd` and `accession` are carried so a verdict can state
 * and cite the filing it rests on.
 */
export function fundamentalsFromFacts(facts, opts) {
  const now = opts?.now instanceof Date ? opts.now : new Date();
  const after = new Date(now.getTime() - MAX_AGE_DAYS * 86400000).toISOString().slice(0, 10);
  const at = (key) => pickFact(facts, TAGS[key], { after });

  const assets = at("assets");
  if (!assets) return null;                       // no usable recent filing at all

  const cash = at("cash");
  const sti = at("shortTermInvestments");
  // Only add short-term investments when the cash tag does not already include
  // them, or the liquid balance is counted twice.
  const cashIncludesSti = cash?.tag === "CashCashEquivalentsAndShortTermInvestments";
  const cashTotal = (cash?.value ?? 0) + (!cashIncludesSti && sti ? sti.value : 0);

  const recv = at("receivables");
  const debt = debtFromFacts(facts, { after });
  const revenue = at("revenue");
  const interest = at("interestIncome");
  const other = at("otherIncome");

  let nonPermPct = null, nonPermBasis = null;
  if (revenue && revenue.value > 0) {
    if (interest && interest.value >= 0) {
      nonPermPct = Math.round((interest.value / revenue.value) * 10000) / 100;
      nonPermBasis = "interest_income";
    } else if (other && other.value > 0) {
      nonPermPct = Math.round((other.value / revenue.value) * 10000) / 100;
      nonPermBasis = "other_income_estimate";
    }
  }

  const MM = 1e6;
  return {
    assets: assets.value / MM,
    cash: cashTotal / MM,
    recv: (recv?.value ?? 0) / MM,
    debt: debt ? debt.value / MM : null,            // null ⇒ unverifiable ⇒ "review"
    nonPermPct,
    nonPermBasis,
    fiscalYear: Number(assets.fy) || Number(String(assets.end).slice(0, 4)) || null,
    periodEnd: assets.end,
    form: assets.form,
    accession: assets.accn || null,
    debtTags: debt ? debt.parts.map((p) => p.tag) : [],
    source: "sec",
  };
}

/** The filing a verdict rests on, for citation. */
export function filingUrl(cik, accession) {
  const c = String(cik || "").replace(/^0+/, "");
  const a = String(accession || "").replace(/-/g, "");
  if (!c || !a) return null;
  return `https://www.sec.gov/Archives/edgar/data/${c}/${a}/${accession}-index.htm`;
}

/** ticker → zero-padded CIK, from SEC's own published map. */
export function cikMapFromJson(json) {
  const out = {};
  for (const row of Object.values(obj(json) || {})) {
    const t = typeof row?.ticker === "string" ? row.ticker.toUpperCase() : null;
    const cik = num(row?.cik_str);
    if (t && cik !== null && !out[t]) out[t] = String(cik).padStart(10, "0");
  }
  return out;
}
