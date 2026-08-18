/**
 * Envelope (zero-based) budgeting — the math, with no I/O and no React.
 *
 * Ported from the model in actualbudget/actual (`loot-core/src/server/budget/
 * envelope.ts`), which is the reference implementation of this style. The one
 * property worth protecting above all others: we store only what the user chose
 * (`budgeted`, `carryover`) and DERIVE everything else. Leftover, overspend and
 * To-Budget are never written down, so they can never drift out of agreement
 * with the numbers they came from — the same discipline that netWorth.js and
 * zakat.js exist to enforce on their surfaces.
 *
 * The rules, stated once:
 *
 *   leftover[c][m]  = budgeted + spent + (carryover ? prevLeftover : max(0, prevLeftover))
 *   overspend[m]    = Σ min(0, prevLeftover[c])  over categories with carryover OFF
 *   toBudget[m]     = income + overspend[m] − Σ budgeted[c][m]
 *
 * `spent` is NEGATIVE for outflow, matching how transactions arrive. Carryover
 * ON means a category's DEBT follows it into next month; OFF (the default, and
 * Actual's) means the hole is charged to next month's To-Budget instead, which
 * forces a deliberate reallocation rather than letting a category quietly run a
 * permanent deficit.
 */

/** First-of-month ISO date ("2026-08-01") for any Date or ISO-ish string. */
export function monthKey(d = new Date()) {
  const dt = typeof d === "string" ? new Date(d.length <= 7 ? `${d}-01T00:00:00Z` : d) : d;
  if (Number.isNaN(dt?.getTime?.())) return null;
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
 * Spend per category for one month, from transactions.
 * Returns NEGATIVE numbers for outflow, which is the sign `leftover` expects.
 *
 * @param {Array<{date?:string,amount?:number,category?:string,pending?:boolean}>} txns
 * @param {string} month  first-of-month key
 * @param {{includePending?:boolean, outflowIsPositive?:boolean}} [opts]
 */
export function spentByCategory(txns = [], month, opts = {}) {
  const { includePending = false, outflowIsPositive = true } = opts;
  const m = monthKey(month);
  const out = {};
  if (!m) return out;
  const next = nextMonth(m);
  for (const t of txns) {
    if (!t) continue;
    if (!includePending && t.pending) continue;
    const d = String(t.date || t.trade_date || "").slice(0, 10);
    if (!d || d < m || d >= next) continue;
    const cat = (t.category || "Uncategorized").trim() || "Uncategorized";
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
 * Leftover per category for a month, given the previous month's leftovers.
 *
 * @param {Record<string,{budgeted:number,carryover?:boolean}>} entries
 * @param {Record<string,number>} spent          negative for outflow
 * @param {Record<string,number>} prevLeftover   previous month's result
 */
export function leftoverByCategory(entries = {}, spent = {}, prevLeftover = {}) {
  const cats = new Set([...Object.keys(entries), ...Object.keys(spent), ...Object.keys(prevLeftover)]);
  const out = {};
  for (const c of cats) {
    const e = entries[c] || {};
    const prev = num(prevLeftover[c]);
    // carryover ON: a negative balance follows the category.
    // carryover OFF: only a POSITIVE balance rolls; the hole goes to To-Budget.
    const rolled = e.carryover ? prev : Math.max(0, prev);
    out[c] = round2(num(e.budgeted) + num(spent[c]) + rolled);
  }
  return out;
}

/**
 * Money that last month's overspending has already claimed from this month.
 * Always <= 0. Only categories with carryover OFF contribute — the others keep
 * their own debt (that is what the flag means).
 */
export function lastMonthOverspent(prevEntries = {}, prevLeftover = {}) {
  let total = 0;
  for (const [c, lo] of Object.entries(prevLeftover)) {
    if (prevEntries[c]?.carryover) continue;
    total += Math.min(0, num(lo));
  }
  return round2(total);
}

/**
 * The whole month, in one call — what a UI needs to render an envelope budget.
 *
 * @param {{
 *   month: string,
 *   entries?: Record<string,{budgeted:number,carryover?:boolean}>,
 *   spent?: Record<string,number>,
 *   prevEntries?: Record<string,{budgeted:number,carryover?:boolean}>,
 *   prevLeftover?: Record<string,number>,
 *   income?: number,
 * }} input
 */
export function computeMonth({
  month,
  entries = {},
  spent = {},
  prevEntries = {},
  prevLeftover = {},
  income = 0,
} = {}) {
  const leftover = leftoverByCategory(entries, spent, prevLeftover);
  const overspent = lastMonthOverspent(prevEntries, prevLeftover);
  const totalBudgeted = round2(
    Object.values(entries).reduce((s, e) => s + num(e?.budgeted), 0),
  );
  const totalSpent = round2(Object.values(spent).reduce((s, v) => s + num(v), 0));

  // The headline of a zero-based budget. Positive = money still to assign;
  // negative = you have assigned more than you have, which the UI must shout
  // about, because that is the entire point of the method.
  const toBudget = round2(num(income) + overspent - totalBudgeted);

  return {
    month: monthKey(month),
    leftover,
    overspent,
    income: round2(num(income)),
    totalBudgeted,
    totalSpent,          // negative
    toBudget,
    isBalanced: Math.abs(toBudget) < 0.005,
    overAssigned: toBudget < -0.005,
  };
}

/**
 * Walk several months in order so each month's rollover feeds the next.
 * Returns `{ [month]: computeMonth(...) }`.
 *
 * Callers should pass EVERY month from the first budgeted one onward — envelope
 * balances are path-dependent, so starting mid-history silently drops whatever
 * had accumulated before the window.
 */
export function computeSeries(months = [], byMonth = {}, incomeByMonth = {}) {
  const out = {};
  let prevLeftover = {};
  let prevEntries = {};
  for (const raw of months) {
    const m = monthKey(raw);
    if (!m) continue;
    const { entries = {}, spent = {} } = byMonth[m] || {};
    const res = computeMonth({
      month: m, entries, spent, prevEntries, prevLeftover,
      income: num(incomeByMonth[m]),
    });
    out[m] = res;
    prevLeftover = res.leftover;
    prevEntries = entries;
  }
  return out;
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
