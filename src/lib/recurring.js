// Recurring-transaction detection + debt-payment matching — pure, testable.
//
// Phase 3 of the benchmark roadmap. Two uses share this engine:
//   - Finances keeps its own recurring/subscription view (unchanged, stays
//     categorized as finance).
//   - Goals uses matchDebtToStream() to detect a recurring PAYMENT toward a
//     tracked personal debt (a card autopay, a loan ACH, money to a friend) so
//     the debt's paydown can auto-advance from real posted transactions — the
//     "sync monthly statements" behaviour, and the step Copilot doesn't do
//     (it detects recurrings but never links them to a liability).
//
// Detection algorithm follows Actual Budget's find-schedules: group outflows by
// normalized merchant, require ≥2 occurrences, infer cadence from the median
// gap, and summarize a typical amount. Provider-agnostic — works off raw
// transactions OR Plaid's native recurring streams (via normalizePlaidStreams).

const DAY = 86_400_000;
const CADENCE_DAYS = { weekly: 7, biweekly: 14, monthly: 30.44, quarterly: 91.3, annual: 365 };

// Strip noise from a bank/merchant descriptor so the same payee matches across
// months despite trailing ref numbers, dates, store IDs, casing, etc.
export function normalizeMerchant(name) {
  return String(name || "")
    .toUpperCase()
    .replace(/\b(XX+\d*|\d{4,})\b/g, " ")      // masked/long digit runs (card #, ref)
    .replace(/\b(ACH|POS|PMT|PAYMENT|AUTOPAY|AUTO PAY|BILL|WEB|ONLINE|DEBIT|EPAY|E-?PAYMENT|RECURRING|TItype)\b/g, " ")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Median of a numeric array.
function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Classify a set of ascending dates into a cadence by their median gap.
export function cadenceFromDates(dateStrings) {
  const times = [...dateStrings].map((d) => new Date(d).getTime()).filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
  if (times.length < 2) return { cadence: "unknown", medianGapDays: null };
  const gaps = [];
  for (let i = 1; i < times.length; i++) gaps.push((times[i] - times[i - 1]) / DAY);
  const g = median(gaps);
  // Nearest named cadence within a tolerance band.
  const bands = [
    ["weekly", 7, 3], ["biweekly", 14, 4], ["monthly", 30.44, 8],
    ["quarterly", 91.3, 20], ["annual", 365, 45],
  ];
  for (const [name, days, tol] of bands) {
    if (Math.abs(g - days) <= tol) return { cadence: name, medianGapDays: g };
  }
  return { cadence: "irregular", medianGapDays: g };
}

// Detect recurring OUTFLOWS from raw transactions. Plaid convention: amount > 0
// is an outflow (money leaving the account). Returns streams sorted by amount.
export function detectRecurringOutflows(transactions, { minCount = 2 } = {}) {
  const groups = new Map();
  for (const t of transactions || []) {
    const amt = Number(t?.amount) || 0;
    if (amt <= 0) continue; // outflows only
    const key = normalizeMerchant(t?.merchant_name || t?.name);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({
      date: (t?.date || t?.authorized_date || "").slice(0, 10),
      amount: amt,
      name: t?.merchant_name || t?.name || key,
      category: t?.personal_finance_category?.primary || (Array.isArray(t?.category) ? t.category[0] : null),
      account_id: t?.account_id || null,
    });
  }
  const streams = [];
  for (const [key, txns] of groups) {
    if (txns.length < minCount) continue;
    txns.sort((a, b) => a.date.localeCompare(b.date));
    const amounts = txns.map((x) => x.amount);
    const { cadence, medianGapDays } = cadenceFromDates(txns.map((x) => x.date));
    streams.push({
      key,
      merchant: txns[txns.length - 1].name,
      typicalAmount: median(amounts),
      lastAmount: txns[txns.length - 1].amount,
      lastDate: txns[txns.length - 1].date,
      cadence,
      medianGapDays,
      count: txns.length,
      category: txns[txns.length - 1].category,
      account_id: txns[txns.length - 1].account_id,
      txns,
    });
  }
  return streams.sort((a, b) => b.typicalAmount - a.typicalAmount);
}

// Adapt Plaid's native /recurring outflow_streams into the same shape as
// detectRecurringOutflows so the matcher is provider-agnostic.
export function normalizePlaidStreams(plaidRecurring) {
  const out = plaidRecurring?.outflow_streams || plaidRecurring?.outflowStreams || [];
  return (Array.isArray(out) ? out : []).map((s) => {
    const merchant = s.merchant_name || s.description || "Recurring payment";
    const typicalAmount = Math.abs(Number(s.average_amount?.amount ?? s.average_amount ?? s.last_amount?.amount ?? s.last_amount) || 0);
    return {
      key: normalizeMerchant(merchant),
      merchant,
      typicalAmount,
      lastAmount: Math.abs(Number(s.last_amount?.amount ?? s.last_amount) || typicalAmount),
      lastDate: (s.last_date || "").slice(0, 10),
      cadence: String(s.frequency || "").toLowerCase().replace("bimonthly", "biweekly") || "unknown",
      medianGapDays: null,
      count: Array.isArray(s.transaction_ids) ? s.transaction_ids.length : (s.count || 0),
      category: s.personal_finance_category?.primary || (Array.isArray(s.category) ? s.category[0] : null),
      account_id: s.account_id || null,
      txns: [],
    };
  });
}

// Words worth ignoring when comparing a debt's creditor/name to a stream label.
const STOPWORDS = new Set(["THE", "LLC", "INC", "CO", "BANK", "CARD", "CREDIT", "LOAN", "AUTO", "FINANCING", "MY", "FROM", "A", "AND", "OF"]);

function tokens(s) {
  return normalizeMerchant(s).split(" ").filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

// Score how well a recurring stream matches a debt (0–1). Combines a token
// overlap of the debt's creditor/name against the stream label with amount
// proximity to the debt's expected payment. Returns 0 when nothing overlaps.
export function scoreDebtStream(debt, stream, expectedAmount) {
  const debtTokens = new Set([...tokens(debt?.creditor || ""), ...tokens(debt?.name || "")]);
  if (debtTokens.size === 0) return 0;
  const streamTokens = new Set(tokens(stream?.merchant || stream?.key || ""));
  let overlap = 0;
  for (const t of debtTokens) if (streamTokens.has(t)) overlap++;
  const nameScore = overlap / debtTokens.size; // fraction of debt tokens found in the stream

  let amountScore = 0;
  const exp = Number(expectedAmount) || 0;
  const amt = Number(stream?.typicalAmount) || 0;
  if (exp > 0 && amt > 0) {
    const rel = Math.abs(amt - exp) / exp;
    amountScore = rel <= 0.5 ? 1 - rel / 0.5 : 0; // within ±50%, linearly
  }
  // Name match is the anchor; amount refines. No name overlap → no match.
  if (nameScore === 0) return 0;
  return 0.7 * nameScore + 0.3 * amountScore;
}

// Best matching stream for a debt above a confidence threshold, or null.
// expectedAmount is the debt's recurring payment (if any) used for amount scoring.
export function matchDebtToStream(debt, streams, { expectedAmount = 0, minScore = 0.34 } = {}) {
  let best = null, bestScore = 0;
  for (const s of streams || []) {
    const sc = scoreDebtStream(debt, s, expectedAmount);
    if (sc > bestScore) { bestScore = sc; best = s; }
  }
  return bestScore >= minScore ? { stream: best, score: bestScore } : null;
}

// Posted payments from a stream on/after a date — used to auto-log real
// payments against a debt so its paydown reflects actual transactions.
export function streamPaymentsSince(stream, sinceISO) {
  const since = sinceISO ? String(sinceISO).slice(0, 10) : "";
  return (stream?.txns || [])
    .filter((p) => p && p.date && (!since || p.date >= since))
    .map((p) => ({ date: p.date, amount: Math.abs(Number(p.amount) || 0) }))
    .filter((p) => p.amount > 0);
}
