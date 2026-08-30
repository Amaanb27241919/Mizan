/* ─── TOP-DOWN BUDGETING ─────────────────────────────────
 * One monthly number, with category limits sitting inside it.
 *
 * This replaces the zero-based (envelope) model as the budget the user sees.
 * The reason is not aesthetic. Zero-based makes "To Budget" — income minus
 * everything you have assigned — the headline, and that number only means
 * something once you have accepted the method. It was the largest figure on
 * the screen and the one nobody could read. Origin, Copilot and Monarch all
 * lead with the pair a person actually asks for: what did I plan to spend,
 * and what have I spent.
 *
 * The model, in full:
 *
 *   income  =  save  +  budget          the only split there is
 *   budget  =  Σ category limits  +  Everything else
 *   left    =  budget + carried-in  −  spent
 *
 * "Everything else" is what makes this workable on real data. In zero-based,
 * spending in a category you never created is invisible or forces you to
 * create one; here the remainder of the budget is itself a bucket, so the
 * arithmetic closes without the user having to name all of their life.
 *
 * Pure: no React, no DOM, no storage, no I/O. Tested in
 * src/test/budgetPlan.test.js. Shares its month/pace/category primitives with
 * envelope.js rather than duplicating them.
 * ──────────────────────────────────────────────────────── */

import { monthKey, nextMonth, prevMonth, spentByCategory, paceStatus } from "./budgetCategories.js";

const num = v => (Number.isFinite(+v) ? +v : 0);
const round2 = v => Math.round((num(v) + Number.EPSILON) * 100) / 100;

/** The bucket that holds every dollar of the budget not given to a category. */
export const EVERYTHING_ELSE = "Everything else";

/**
 * Outflow only, as a positive number.
 *
 * spentByCategory returns NEGATIVE for outflow and POSITIVE for a credit, so a
 * category that netted a refund reads as inflow. Taking Math.abs of both signs
 * is the bug that once turned a $4,000 salary into a $2,665 spending budget:
 * income is a credit, and a credit is not spending. A refund inside a spending
 * category correctly nets DOWN, and a category that is net positive spends 0.
 */
export function outflow(signed) {
  const v = num(signed);
  return v < 0 ? round2(-v) : 0;
}

/**
 * How income divides. Origin shows "Save 19% · $646" beside "Budget 81% ·
 * $2,750" against an income of $3,396 — the two halves sum to income exactly,
 * because they are one lever, not two settings.
 *
 * Returns nulls for the percentages when income is unknown or zero. A budget
 * with no income behind it is legitimate (most Mizan users have no bank
 * linked); inventing "0%" for it would state a savings rate that is not a fact.
 */
export function splitOfIncome(income, total) {
  const inc = num(income);
  const budget = Math.max(0, num(total));
  if (!(inc > 0)) return { income: 0, budget, save: 0, budgetPct: null, savePct: null };
  const save = round2(Math.max(0, inc - budget));
  return {
    income: round2(inc),
    budget: round2(budget),
    save,
    budgetPct: Math.round((Math.min(budget, inc) / inc) * 100),
    savePct: Math.round((save / inc) * 100),
  };
}

/**
 * One month of the budget.
 *
 * @param {object}  a
 * @param {string}  a.month       first-of-month key
 * @param {number|null} a.total   the monthly budget the user set. null = not set yet
 * @param {number}  a.carriedIn   +/- rolled in from last month (0 when rollover is off)
 * @param {number}  a.income      income for the month
 * @param {Record<string,number>} a.limits  { category: limit } — user-set caps
 * @param {Record<string,number>} a.spent   { category: signed } from spentByCategory
 * @param {Date}    [a.now]
 *
 * @returns {{
 *   total:number|null, isSet:boolean, carriedIn:number, available:number,
 *   spent:number, left:number, over:boolean, pace:object, split:object,
 *   allocated:number, unallocated:number, overAllocated:boolean,
 *   rows:Array, everythingElse:object|null
 * }}
 */
export function computeBudgetMonth({
  month, total = null, carriedIn = 0, income = 0, limits = {}, spent = {}, now = new Date(),
} = {}) {
  const m = monthKey(month);
  const isSet = total !== null && total !== undefined && Number.isFinite(+total);
  const budget = isSet ? Math.max(0, num(total)) : 0;
  const carried = round2(num(carriedIn));

  // Named categories: any the user has given a limit, plus any they have spent
  // in that is NOT already swept into Everything else. A category only becomes
  // a row once it has a limit — otherwise the list grows a row for every
  // merchant Plaid invents, which is exactly the noise Everything else exists
  // to absorb.
  const named = Object.keys(limits).filter(c => c && c !== EVERYTHING_ELSE);

  const spentTotal = round2(
    Object.entries(spent).reduce((s, [c, v]) => (c === EVERYTHING_ELSE ? s : s + outflow(v)), 0),
  );

  let namedSpent = 0;
  const rows = named.map((category) => {
    const s = outflow(spent[category]);
    namedSpent = round2(namedSpent + s);
    const limit = Math.max(0, num(limits[category]));
    return {
      category,
      limit,
      spent: s,
      left: round2(limit - s),
      pace: paceStatus({ spent: s, budgeted: limit, month: m, now }),
    };
  });

  const allocated = round2(rows.reduce((s, r) => s + r.limit, 0));
  const unallocated = round2(budget - allocated);
  // Limits that add up to more than the budget is a real state, not an error to
  // hide: the plan says two different things and the user has to resolve it.
  const overAllocated = isSet && unallocated < 0;

  const elseSpent = round2(Math.max(0, spentTotal - namedSpent));
  const elseLimit = Math.max(0, unallocated);
  const everythingElse = isSet
    ? {
        category: EVERYTHING_ELSE,
        limit: elseLimit,
        spent: elseSpent,
        left: round2(elseLimit - elseSpent),
        pace: paceStatus({ spent: elseSpent, budgeted: elseLimit, month: m, now }),
        isRemainder: true,
      }
    : null;

  const available = round2(budget + carried);
  const left = round2(available - spentTotal);

  return {
    month: m,
    total: isSet ? round2(budget) : null,
    isSet,
    carriedIn: carried,
    available,
    spent: spentTotal,
    left,
    over: left < 0,
    pace: paceStatus({ spent: spentTotal, budgeted: available, month: m, now }),
    split: splitOfIncome(income, budget),
    allocated,
    unallocated,
    overAllocated,
    rows,
    everythingElse,
  };
}

/**
 * Every month, in order, so rollover can chain.
 *
 * Rollover is PATH-DEPENDENT — this month's headroom depends on last month's
 * result, which depends on the one before it. Computing a single visible month
 * in isolation gives a plausible wrong answer, which is the same trap the
 * envelope model had; /api/budget returns the whole history for this reason.
 *
 * Rollover is a single switch for the WHOLE budget, not a per-category one.
 * Per-category carryover was seven decisions a month for a question most
 * people answer once.
 *
 * @param {string[]} months  ascending first-of-month keys
 * @param {{plans:object, limitsByMonth:object, spentByMonth:object, incomeByMonth:object, rollover:boolean, now:Date}} ctx
 */
export function computeBudgetSeries(months = [], ctx = {}) {
  const {
    plans = {}, limitsByMonth = {}, spentByMonth = {}, incomeByMonth = {},
    rollover = false, now = new Date(),
  } = ctx;
  const out = {};
  let carried = 0;
  for (const m of [...months].filter(Boolean).sort()) {
    const res = computeBudgetMonth({
      month: m,
      total: plans[m]?.total ?? null,
      carriedIn: rollover ? carried : 0,
      income: incomeByMonth[m] ?? 0,
      limits: limitsByMonth[m] || {},
      spent: spentByMonth[m] || {},
      now,
    });
    out[m] = res;
    // Only a month with a budget can hand anything forward. An unplanned month
    // passes the balance through untouched rather than zeroing it, so a gap in
    // the history does not silently erase a surplus the user earned.
    carried = res.isSet ? res.left : carried;
  }
  return out;
}

/**
 * The last month the user actually set a budget for, at or before `month`.
 * Used to carry a plan forward: a budget set in August is still the plan in
 * September until they change it. Without this every new month opens empty and
 * the user re-enters the same number twelve times a year.
 */
export function inheritedTotal(plans = {}, month, lookback = 24) {
  let m = monthKey(month);
  for (let i = 0; i < lookback && m; i++) {
    const t = plans[m]?.total;
    if (Number.isFinite(+t)) return { total: round2(+t), from: m, inherited: i > 0 };
    m = prevMonth(m);
  }
  return { total: null, from: null, inherited: false };
}

/**
 * Every category the user has spent in this month, biggest first — the source
 * for "which of these deserves its own limit". Excludes inflow, so a paycheck
 * is never offered as a spending category to cap.
 */
export function spendingCategories(txns = [], month, opts = {}) {
  const spent = spentByCategory(txns, month, opts);
  return Object.entries(spent)
    .map(([category, v]) => ({ category, spent: outflow(v) }))
    .filter(r => r.spent > 0)
    .sort((a, b) => b.spent - a.spent || a.category.localeCompare(b.category));
}

/* ─── Category identity ──────────────────────────────────
 * Every reference app gives a category a glyph, and that is most of why their
 * lists read as objects rather than as rows of a spreadsheet.
 *
 * Colour deliberately does NOT vary per category. Mizan's palette assigns
 * meaning to green (compliant / under), red (haram / over) and amber (Zakat /
 * warning); handing those out as decoration would make a category's colour
 * argue with the bar beside it. Identity is carried by the glyph, and colour
 * stays semantic. See CLAUDE.md §5.
 * ──────────────────────────────────────────────────────── */
const ICONS = [
  [/zakat/,                                    "☾"],
  [/sadaqah|charit|donat|giving/,              "◈"],
  [/masjid|mosque|islamic|madrasah|qard/,      "☪"],
  [/hajj|umrah|pilgrim/,                       "▲"],
  [/halal|grocer|food_and_drink|supermarket/,  "◆"],
  [/restaurant|dining|drink|coffee|cafe/,      "●"],
  [/rent|mortgage|home|hous|utilit|internet/,  "▮"],
  [/transport|travel|gas|fuel|auto|car|uber/,  "▸"],
  [/health|medical|pharma|doctor|fitness/,     "✚"],
  [/school|educat|tuition|book|child/,         "✦"],
  [/shop|merch|cloth|general_merch/,           "◇"],
  [/entertain|stream|subscription|game/,       "▶"],
  [/insur|tax|loan|bank|financial|fee/,        "§"],
  [/personal_care|beauty|salon/,               "✧"],
  [/pet/,                                      "✤"],
  [/income|payroll|salary|deposit|transfer/,   "↑"],
];

/** A stable glyph for a category name. Falls back to a neutral dot. */
export function categoryIcon(category) {
  const c = String(category || "").toLowerCase();
  if (!c) return "•";
  if (c === EVERYTHING_ELSE.toLowerCase()) return "∞";
  for (const [re, glyph] of ICONS) if (re.test(c)) return glyph;
  return "•";
}

/** Human label for a provider category shouting in SCREAMING_SNAKE_CASE. */
export function prettyCategory(category) {
  const raw = String(category || "").trim();
  if (!raw) return "Uncategorized";
  if (!/^[A-Z0-9_]+$/.test(raw)) return raw;          // already human — leave it
  return raw
    .toLowerCase().split("_").filter(Boolean)
    .map(w => (w === "and" ? "&" : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

export { monthKey, nextMonth, prevMonth };
