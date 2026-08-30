/**
 * Budget primitives — categories, months, pace. No I/O, no React.
 *
 * HISTORY, because the filename used to say otherwise: this was `envelope.js`
 * and it carried the zero-based (envelope) model ported from
 * actualbudget/actual — leftover chains, per-category carryover, To-Budget.
 * That model was retired on 2026-08-30 when the owner reported the budget
 * screen as confusing; Mizan now budgets TOP-DOWN (one monthly number with
 * category limits inside it) and that math lives in src/lib/budgetPlan.js.
 * The chain functions were deleted rather than left dormant, so nobody
 * reintroduces a second, contradictory definition of "what's left".
 *
 * What remains is what BOTH models needed and what the rest of the Finances
 * tab borrows: month keys, resolving a transaction's category through the
 * user's rules, aggregating spend, judging pace against elapsed time,
 * suggesting numbers from history, and grouping rows for display.
 *
 * `spent` is NEGATIVE for outflow throughout, matching how transactions
 * arrive from Plaid. budgetPlan.js's `outflow()` is the one place that
 * converts, so no caller has to remember the sign.
 */
/** First-of-month ISO date ("2026-08-01") for any Date or ISO-ish string. */
export function monthKey(d = new Date()) {
  const dt = typeof d === "string" ? new Date(d.length <= 7 ? `${d}-01T00:00:00Z` : d)
    : typeof d === "number" ? new Date(d)
      : d;
  // `Number.isNaN(undefined)` is FALSE — it matches only the actual NaN value,
  // not "not a number". So the previous guard, `Number.isNaN(dt?.getTime?.())`,
  // let a null straight through to getUTCFullYear() and threw. A default
  // parameter does not help either: defaults fire on `undefined` only, so an
  // explicit monthKey(null) skipped it. Check for a usable Date instead.
  if (!(dt instanceof Date) || Number.isNaN(dt.getTime())) return null;
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/** The month before `key`, same format. */
export function prevMonth(key) {
  const m = monthKey(key);
  if (!m) return null;
  const [y, mo] = m.split("-").map(Number);
  return mo === 1 ? `${y - 1}-12-01` : `${y}-${String(mo - 1).padStart(2, "0")}-01`;
}

const num = (v) => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
/** Money is compared and accumulated in cents to keep float dust out of totals. */
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * A transaction's category, whatever shape it arrives in.
 *
 * Plaid does NOT give a plain string. `category` is an ARRAY (hierarchical,
 * least-specific first) and the modern field is the object
 * `personal_finance_category.primary`. MizanApp already normalises this the
 * same way in half a dozen places; this mirrors it exactly.
 *
 * This function exists because assuming a string crashed the whole Finances tab
 * the first time this module met real data — and the E2E suite did not catch it
 * because the fixtures I wrote used strings. A fixture that does not match the
 * shape production actually sends is not a test, it is an echo.
 */
export function categoryOf(t, rules = null) {
  // A user rule beats the provider, always. Plaid decides categories today and
  // the user cannot argue: a grocery run labelled FOOD_AND_DRINK stays there
  // even if they think of it as Halal Food, so they end up with two rows and no
  // way to merge them. Rules are keyed on the NORMALISED merchant, so fixing a
  // category once fixes every transaction from that merchant — past and future
  // — which is what Copilot and Origin both do and what people expect.
  const raw =
    t?.personal_finance_category?.primary ??
    (Array.isArray(t?.category) ? t.category[t.category.length - 1] : t?.category);
  const provider = (typeof raw === "string" ? raw.trim() : "") || "Uncategorized";

  if (rules) {
    // MERCHANT rule first — the more specific of the two. Recategorising one
    // shop should not be overridden by a blanket rule on the category it
    // happened to arrive in.
    const mKey = merchantKey(t);
    const byMerchant = mKey && rules[mKey];
    if (typeof byMerchant === "string" && byMerchant.trim()) return byMerchant.trim();

    // CATEGORY rule — "everything Plaid files as FOOD_AND_DRINK is Halal Food".
    // This is the one people actually hit: the provider's taxonomy is not
    // theirs, and without it they get two rows they cannot merge.
    const byCategory = rules[provider];
    if (typeof byCategory === "string" && byCategory.trim() && byCategory.trim() !== provider) {
      return byCategory.trim();
    }
  }
  return provider;
}

/**
 * The key a category rule is stored under: the merchant, stripped of the noise
 * banks attach to it (card digits, ACH/POS/AUTOPAY markers, punctuation).
 *
 * Mirrors normalizeMerchant in src/lib/recurring.js deliberately rather than
 * importing it — these two modules are independently pure and neither should
 * acquire the other as a dependency for six lines of string handling. If the
 * rules stop matching what the subscriptions panel detects, this is why.
 */
export function merchantKey(t) {
  const name = t?.merchant_name || t?.name || t?.description || "";
  return String(name)
    .toUpperCase()
    .replace(/\b(XX+\d*|\d{4,})\b/g, " ")
    .replace(/\b(ACH|POS|PMT|PAYMENT|AUTOPAY|AUTO PAY|BILL|WEB|ONLINE|DEBIT|EPAY|E-?PAYMENT|RECURRING)\b/g, " ")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Spend per category for one month, from transactions.
 * Returns NEGATIVE numbers for outflow, which is the sign `leftover` expects.
 *
 * @param {Array<{date?:string,amount?:number,category?:string,pending?:boolean}>} txns
 * @param {string} month  first-of-month key
 * @param {{includePending?:boolean, outflowIsPositive?:boolean}} [opts]
 */
export function spentByCategory(txns = [], month, opts = {}) {
  const { includePending = false, outflowIsPositive = true, rules = null } = opts;
  const m = monthKey(month);
  const out = {};
  if (!m) return out;
  const next = nextMonth(m);
  // `txns = []` only fires on undefined, so an explicit null still reached the
  // loop and threw "txns is not iterable". Third time this exact trap has been
  // found in this file (monthKey, suggestBudgets, here) — guard, don't default.
  for (const t of (Array.isArray(txns) ? txns : [])) {
    if (!t) continue;
    if (!includePending && t.pending) continue;
    const d = String(t.date || t.trade_date || "").slice(0, 10);
    if (!d || d < m || d >= next) continue;
    const cat = categoryOf(t, rules);
    // Plaid reports an outflow as a POSITIVE amount. Envelope math wants
    // outflow negative, so flip unless the caller says otherwise.
    const raw = num(t.amount);
    const signed = outflowIsPositive ? -raw : raw;
    out[cat] = round2((out[cat] || 0) + signed);
  }
  return out;
}

/** The month after `key`. */
export function nextMonth(key) {
  const m = monthKey(key);
  if (!m) return null;
  const [y, mo] = m.split("-").map(Number);
  return mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, "0")}-01`;
}

/**
 * Islamic budget categories Mizan ships as presets. Listed in CLAUDE.md §16 as
 * an effort-S gap, and the one part of this feature no mainstream budgeting app
 * can copy. `carryover: true` where an unspent balance is meant to accumulate
 * toward a lump obligation rather than reset each month.
 */
export const ISLAMIC_CATEGORY_PRESETS = [
  { category: "Sadaqah",        carryover: false, hint: "Voluntary charity" },
  { category: "Zakat",          carryover: true,  hint: "Accumulates toward your annual obligation" },
  { category: "Masjid",         carryover: false, hint: "Mosque dues and donations" },
  { category: "Halal Food",     carryover: false, hint: "Groceries and dining" },
  { category: "Hajj / Umrah",   carryover: true,  hint: "Saves up across months" },
  { category: "Islamic School", carryover: false, hint: "Madrasah and tuition" },
  { category: "Qard Hasan",     carryover: true,  hint: "Interest-free lending to others" },
];

/**
 * How far through a month we are, 0–1.
 *
 * Day 1 of a 31-day month returns 1/31, not 0 — on the first day you have
 * legitimately consumed a day's worth of the budget, and a 0 would make every
 * projection infinite.
 *
 * Returns 1 for any month already past and 0 for a month not yet started, so
 * callers get a sensible answer without special-casing the calendar.
 */
export function monthProgress(month, now = new Date()) {
  const m = monthKey(month);
  if (!m) return 1;
  const start = Date.parse(`${m}T00:00:00Z`);
  const end = Date.parse(`${nextMonth(m)}T00:00:00Z`);
  const t = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(t)) return 1;
  if (t >= end) return 1;
  if (t < start) return 0;
  const days = Math.round((end - start) / 86400000);
  const dayIndex = Math.floor((t - start) / 86400000) + 1;  // 1-based
  return Math.min(1, dayIndex / days);
}

/**
 * Where a category stands — and, for the CURRENT month, where it is heading.
 *
 * The distinction this exists to make: 80% of a grocery budget spent on the 3rd
 * is an emergency, and on the 28th it is fine. Colouring both the same — which
 * is what a plain spent/budgeted ratio does — states something the data does
 * not support. Copilot solved this years ago by colouring on PACE.
 *
 * States:
 *   "over"       already spent more than budgeted. Certain, not a projection.
 *   "over-pace"  still within budget, but the current rate lands over by month
 *                end. Only ever returned for a month still in progress.
 *   "under"      on track, or a finished month that came in under.
 *   "unset"      nothing budgeted. Not a judgment — there is no target to miss.
 *
 * `projected` is the run-rate estimate (spend ÷ elapsed), returned so callers
 * can say WHY a bar is amber rather than just colouring it.
 */
export function paceStatus({ spent = 0, budgeted = 0, month, now = new Date() } = {}) {
  const spentAbs = Math.abs(num(spent));
  const target = num(budgeted);
  const elapsed = monthProgress(month, now);
  const inProgress = elapsed > 0 && elapsed < 1;

  if (!(target > 0)) {
    return { state: spentAbs > 0 ? "unset" : "unset", pct: spentAbs > 0 ? 1 : 0, elapsed, projected: spentAbs };
  }

  const pct = Math.max(0, Math.min(1, spentAbs / target));
  if (spentAbs > target) {
    return { state: "over", pct: 1, elapsed, projected: spentAbs };
  }
  // Run-rate. Guard elapsed>0 so a not-yet-started month cannot divide by zero.
  const projected = elapsed > 0 ? spentAbs / elapsed : spentAbs;
  if (inProgress && projected > target) {
    return { state: "over-pace", pct, elapsed, projected: round2(projected) };
  }
  return { state: "under", pct, elapsed, projected: round2(projected) };
}

/** Round to the nearest `step`, so a suggestion reads as a decision not a measurement. */
function roundTo(v, step) {
  if (!(step > 0)) return round2(v);
  return Math.round(num(v) / step) * step;
}

/**
 * A starting budget, derived from what the user actually spent.
 *
 * The hardest step in budgeting is deciding the number, and every mainstream
 * app deletes it: Copilot builds the initial budget from imported history,
 * Origin's AI recommends from past income and spending, Monarch derives the
 * flex number from previous averages. Mizan asked users to invent every figure
 * from nothing, which is why a blank budget stays blank.
 *
 * MEAN, not median, over COMPLETE months, zero-padded. Each choice matters:
 *  - Complete months only. The current month is partial, and including it drags
 *    every suggestion down by however many days are left.
 *  - Zero-padding. A category with spend in one month of three is a real
 *    monthly average of a third of it — not "budget the whole one-off". Paired
 *    with rollover, lumpy categories accumulate toward the occasional big month.
 *  - Mean over median. The median of [300, 0, 0] is 0, which would silently
 *    drop every irregular category. Mean keeps them, and rollover absorbs the
 *    lumpiness that makes the mean imperfect.
 *
 * Returns `{ categories, income, monthsUsed }`. Empty when there is not a
 * single complete month of history — a suggestion from no data is a guess
 * wearing a suit.
 */
export function suggestBudgets(txns = [], { asOf = new Date(), lookbackMonths = 3, step = 5 } = {}) {
  const current = monthKey(asOf);
  const empty = { categories: {}, income: 0, monthsUsed: 0 };
  if (!current) return empty;

  // A default parameter fires on `undefined` only, so `suggestBudgets(null)`
  // skipped `txns = []` and threw on .map — the same trap that hid in monthKey.
  const list = Array.isArray(txns) ? txns : [];

  // Earliest transaction decides how much history actually exists, so a
  // two-week-old account is not averaged against three months of nothing.
  const dates = list.map(t => String(t?.date || t?.trade_date || "").slice(0, 10)).filter(Boolean).sort();
  if (dates.length === 0) return empty;
  const firstMonth = monthKey(dates[0]);

  const months = [];
  let m = prevMonth(current);
  for (let i = 0; i < lookbackMonths && m && m >= firstMonth; i++) {
    months.push(m);
    m = prevMonth(m);
  }
  if (months.length === 0) return empty;

  const perCat = {};
  let inflow = 0;
  for (const mo of months) {
    const spent = spentByCategory(list, mo);
    for (const [cat, v] of Object.entries(spent)) {
      // spentByCategory returns NEGATIVE for outflow and positive for a credit.
      // Only outflow is spending: without this an income category is suggested
      // as a budget line, so a salary becomes a $2,665/mo "envelope".
      const outflow = num(v) < 0 ? Math.abs(num(v)) : 0;
      (perCat[cat] ||= []).push(outflow);
    }
    const next = nextMonth(mo);
    for (const t of list) {
      const d = String(t?.date || "").slice(0, 10);
      if (!d || d < mo || d >= next) continue;
      const amt = num(t.amount);
      if (amt < 0) inflow += Math.abs(amt);   // Plaid: a credit is negative
    }
  }

  const categories = {};
  for (const [cat, vals] of Object.entries(perCat)) {
    const total = vals.reduce((s, v) => s + v, 0);
    const suggested = roundTo(total / months.length, step);   // zero-padded by dividing by ALL months
    if (suggested > 0) categories[cat] = suggested;
  }
  return {
    categories,
    income: roundTo(inflow / months.length, step),
    monthsUsed: months.length,
  };
}

/**
 * Categories arranged into groups, with a subtotal per group.
 *
 * All three of Copilot, Monarch and Origin group categories, and for the same
 * reason: past about eight envelopes a flat list stops being scannable. Origin's
 * framing is the clearest — "I only want to spend $600 on Food this month",
 * even though that splits across groceries, restaurants and meal kits.
 *
 * Groups are a PRESENTATION layer, deliberately. The envelope math stays
 * per-category, so a group total is always the sum of its parts and can never
 * disagree with them. Budgeting at the group level would need its own stored
 * amount and a reconciliation rule for when the children do not add up — that
 * is a different feature, and this is the half that earns its keep first.
 *
 * Ungrouped categories come last under an empty name, so a user who never
 * groups anything sees exactly the flat list they had before.
 */
export function groupCategories(rows = [], groups = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const map = groups && typeof groups === "object" ? groups : {};
  const byGroup = new Map();
  const ungrouped = [];

  for (const r of list) {
    if (!r) continue;
    const g = String(map[r.category] || "").trim();
    if (!g) { ungrouped.push(r); continue; }
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(r);
  }

  const summarize = (name, rs) => ({
    name,
    rows: rs,
    budgeted: round2(rs.reduce((s, r) => s + num(r.budgeted), 0)),
    spent:    round2(rs.reduce((s, r) => s + num(r.spent), 0)),     // negative
    leftover: round2(rs.reduce((s, r) => s + num(r.leftover), 0)),
  });

  const out = [...byGroup.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, rs]) => summarize(name, rs));
  if (ungrouped.length) out.push(summarize("", ungrouped));
  return out;
}
