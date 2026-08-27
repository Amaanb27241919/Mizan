// Envelope budgeting math (src/lib/envelope.js), ported from actualbudget/actual.
// The rules being pinned:
//   leftover  = budgeted + spent + (carryover ? prevLeftover : max(0, prevLeftover))
//   overspent = Σ min(0, prevLeftover) over carryover=false categories
//   toBudget  = income + overspent − Σ budgeted
import { describe, it, expect } from "vitest";
import {
  monthKey, prevMonth, nextMonth, spentByCategory, leftoverByCategory,
  monthProgress, paceStatus, suggestBudgets,
  lastMonthOverspent, computeMonth, computeSeries, ISLAMIC_CATEGORY_PRESETS,
  categoryOf,
} from "../lib/envelope.js";

describe("month keys", () => {
  it("normalises to first-of-month, matching the DB CHECK constraint", () => {
    // migration 027 enforces date_trunc('month', month) = month. If this helper
    // ever emitted a mid-month date the insert would be rejected outright.
    expect(monthKey("2026-08-15")).toBe("2026-08-01");
    expect(monthKey("2026-08")).toBe("2026-08-01");
    expect(monthKey(new Date("2026-08-31T23:59:59Z"))).toBe("2026-08-01");
  });
  it("walks across year boundaries", () => {
    expect(prevMonth("2026-01-01")).toBe("2025-12-01");
    expect(nextMonth("2026-12-01")).toBe("2027-01-01");
  });
  it("returns null for junk rather than a wrong month", () => {
    expect(monthKey("not-a-date")).toBeNull();
  });
});

describe("spentByCategory", () => {
  const txns = [
    { date: "2026-08-03", amount: 120.5, category: "Halal Food" },
    { date: "2026-08-20", amount: 40,    category: "Halal Food" },
    { date: "2026-07-31", amount: 999,   category: "Halal Food" },  // previous month
    { date: "2026-09-01", amount: 999,   category: "Halal Food" },  // next month
    { date: "2026-08-10", amount: 60,    category: "Sadaqah", pending: true },
    { date: "2026-08-11", amount: 25 },                             // uncategorised
  ];
  it("flips Plaid's positive outflow to the negative the math expects", () => {
    const s = spentByCategory(txns, "2026-08-01");
    expect(s["Halal Food"]).toBe(-160.5);
  });
  it("bounds the month exactly — no bleed from either neighbour", () => {
    const s = spentByCategory(txns, "2026-08-01");
    expect(s["Halal Food"]).not.toBe(-1159.5);   // would include July
  });
  it("excludes pending by default, includes it on request", () => {
    expect(spentByCategory(txns, "2026-08-01")["Sadaqah"]).toBeUndefined();
    expect(spentByCategory(txns, "2026-08-01", { includePending: true })["Sadaqah"]).toBe(-60);
  });
  it("buckets uncategorised spend rather than dropping it", () => {
    expect(spentByCategory(txns, "2026-08-01")["Uncategorized"]).toBe(-25);
  });
});

describe("leftover + carryover", () => {
  it("rolls a POSITIVE balance forward regardless of the flag", () => {
    const lo = leftoverByCategory(
      { Food: { budgeted: 100, carryover: false } }, { Food: -80 }, { Food: 50 },
    );
    expect(lo.Food).toBe(70);   // 100 − 80 + 50
  });
  it("carryover ON: a NEGATIVE balance follows the category", () => {
    const lo = leftoverByCategory(
      { Food: { budgeted: 100, carryover: true } }, { Food: -80 }, { Food: -30 },
    );
    expect(lo.Food).toBe(-10);  // 100 − 80 − 30
  });
  it("carryover OFF: the hole does NOT follow — it is charged to To-Budget", () => {
    // This is the distinction that makes envelope budgeting work. Same inputs
    // as the test above, flag flipped: the −30 is dropped here...
    const lo = leftoverByCategory(
      { Food: { budgeted: 100, carryover: false } }, { Food: -80 }, { Food: -30 },
    );
    expect(lo.Food).toBe(20);   // 100 − 80 + max(0, −30)
    // ...and reappears as a claim on this month's money.
    expect(lastMonthOverspent({ Food: { budgeted: 100, carryover: false } }, { Food: -30 })).toBe(-30);
  });
  it("does not double-count: a carryover-ON debt is not ALSO taken from To-Budget", () => {
    expect(lastMonthOverspent({ Food: { budgeted: 100, carryover: true } }, { Food: -30 })).toBe(0);
  });
});

describe("computeMonth — the zero-based headline", () => {
  it("reports money still to assign", () => {
    const r = computeMonth({
      month: "2026-08-01", income: 5000,
      entries: { Rent: { budgeted: 2000 }, "Halal Food": { budgeted: 600 } },
      spent: { Rent: -2000, "Halal Food": -450 },
    });
    expect(r.toBudget).toBe(2400);
    expect(r.isBalanced).toBe(false);
    expect(r.overAssigned).toBe(false);
  });
  it("flags over-assignment — assigning money you do not have", () => {
    const r = computeMonth({
      month: "2026-08-01", income: 1000,
      entries: { Rent: { budgeted: 2000 } },
    });
    expect(r.toBudget).toBe(-1000);
    expect(r.overAssigned).toBe(true);
  });
  it("counts a fully-assigned month as balanced", () => {
    const r = computeMonth({
      month: "2026-08-01", income: 2000, entries: { Rent: { budgeted: 2000 } },
    });
    expect(r.toBudget).toBe(0);
    expect(r.isBalanced).toBe(true);
  });
  it("subtracts last month's overspend from what is available now", () => {
    const r = computeMonth({
      month: "2026-08-01", income: 3000,
      entries: { Food: { budgeted: 500 } },
      prevEntries: { Food: { budgeted: 400, carryover: false } },
      prevLeftover: { Food: -120 },
    });
    // 3000 income − 120 overspend − 500 budgeted
    expect(r.overspent).toBe(-120);
    expect(r.toBudget).toBe(2380);
  });
});

describe("computeSeries — balances are path-dependent", () => {
  const byMonth = {
    "2026-06-01": { entries: { Hajj: { budgeted: 300, carryover: true } }, spent: {} },
    "2026-07-01": { entries: { Hajj: { budgeted: 300, carryover: true } }, spent: {} },
    "2026-08-01": { entries: { Hajj: { budgeted: 300, carryover: true } }, spent: {} },
  };
  const income = { "2026-06-01": 1000, "2026-07-01": 1000, "2026-08-01": 1000 };

  it("accumulates a savings envelope across months", () => {
    const s = computeSeries(Object.keys(byMonth), byMonth, income);
    expect(s["2026-06-01"].leftover.Hajj).toBe(300);
    expect(s["2026-07-01"].leftover.Hajj).toBe(600);
    expect(s["2026-08-01"].leftover.Hajj).toBe(900);
  });

  it("starting mid-history silently loses the accumulated balance", () => {
    // Documents WHY callers must pass every month from the first budgeted one.
    // This is the classic envelope bug: the number looks plausible and is wrong.
    const partial = computeSeries(["2026-08-01"], byMonth, income);
    expect(partial["2026-08-01"].leftover.Hajj).toBe(300);   // not 900
  });
});

describe("Islamic category presets", () => {
  it("ships the categories CLAUDE.md §16 calls a gap", () => {
    const names = ISLAMIC_CATEGORY_PRESETS.map((p) => p.category);
    expect(names).toEqual(expect.arrayContaining(["Sadaqah", "Zakat", "Masjid", "Halal Food"]));
  });
  it("marks lump-sum obligations as carryover so they accumulate", () => {
    const byName = Object.fromEntries(ISLAMIC_CATEGORY_PRESETS.map((p) => [p.category, p]));
    // Zakat and Hajj are saved toward over a year; they must not reset monthly.
    expect(byName["Zakat"].carryover).toBe(true);
    expect(byName["Hajj / Umrah"].carryover).toBe(true);
    // Ordinary monthly spending resets.
    expect(byName["Halal Food"].carryover).toBe(false);
  });
});

describe("categoryOf — the shape Plaid actually sends", () => {
  // Regression: assuming `category` was a string crashed the entire Finances
  // tab ("(t.category || 'Uncategorized').trim is not a function"). The E2E
  // suite missed it because the fixtures were hand-written with string
  // categories — they matched my assumption, not production.
  it("reads Plaid's ARRAY category, most specific last", () => {
    expect(categoryOf({ category: ["FOOD_AND_DRINK", "Groceries"] })).toBe("Groceries");
  });
  it("prefers the modern personal_finance_category.primary", () => {
    expect(categoryOf({
      category: ["OLD", "Legacy"],
      personal_finance_category: { primary: "FOOD_AND_DRINK" },
    })).toBe("FOOD_AND_DRINK");
  });
  it("still accepts a plain string", () => {
    expect(categoryOf({ category: "Halal Food" })).toBe("Halal Food");
  });
  it("never throws on junk, and never returns empty", () => {
    for (const t of [null, undefined, {}, { category: [] }, { category: 42 }, { category: {} }]) {
      expect(categoryOf(t)).toBe("Uncategorized");
    }
  });
  it("buckets a real mixed batch without crashing", () => {
    const txns = [
      { date: "2026-08-04", amount: 150, category: ["FOOD_AND_DRINK", "Groceries"] },
      { date: "2026-08-05", amount: 50, personal_finance_category: { primary: "FOOD_AND_DRINK" } },
      { date: "2026-08-06", amount: 20 },
    ];
    expect(spentByCategory(txns, "2026-08-01")).toEqual({
      Groceries: -150, FOOD_AND_DRINK: -50, Uncategorized: -20,
    });
  });
});

// ── Pace ────────────────────────────────────────────────────────────────────
// The distinction worth having: 80% of a grocery budget spent on the 3rd is an
// emergency; the same 80% on the 28th is fine. A plain spent/budgeted ratio
// colours both identically, which states something the data does not support.
const AUG = "2026-08-01";
const augDay = (d) => new Date(Date.UTC(2026, 7, d, 12));

describe("monthProgress", () => {
  it("counts day 1 as a day consumed, not zero", () => {
    // A 0 would make every run-rate projection infinite on the 1st.
    expect(monthProgress(AUG, augDay(1))).toBeCloseTo(1 / 31, 5);
  });

  it("reaches 1 by the last day", () => {
    expect(monthProgress(AUG, augDay(31))).toBe(1);
  });

  it("is roughly half way at mid-month", () => {
    expect(monthProgress(AUG, augDay(15))).toBeCloseTo(15 / 31, 5);
  });

  it("returns 1 for a month already past and 0 for one not yet started", () => {
    expect(monthProgress("2026-01-01", augDay(15))).toBe(1);
    expect(monthProgress("2026-12-01", augDay(15))).toBe(0);
  });

  it("survives junk rather than throwing at the render", () => {
    expect(monthProgress(null, augDay(15))).toBe(1);
    expect(monthProgress(AUG, "not-a-date")).toBe(1);
  });
});

describe("paceStatus", () => {
  it("flags the SAME spend differently early and late in the month", () => {
    const early = paceStatus({ spent: 480, budgeted: 600, month: AUG, now: augDay(3) });
    const late  = paceStatus({ spent: 480, budgeted: 600, month: AUG, now: augDay(28) });
    expect(early.state).toBe("over-pace");
    expect(late.state).toBe("under");
    // Same numbers, opposite readings — this is the whole point.
    expect(early.pct).toBeCloseTo(late.pct, 5);
  });

  it("calls actual overspend 'over', not a projection", () => {
    const r = paceStatus({ spent: 700, budgeted: 600, month: AUG, now: augDay(15) });
    expect(r.state).toBe("over");
    expect(r.pct).toBe(1);
    expect(r.projected).toBe(700);
  });

  it("never projects for a finished month — the result is already known", () => {
    // A past month cannot be "on pace to go over"; it either did or it didn't.
    expect(paceStatus({ spent: 100, budgeted: 600, month: "2026-01-01", now: augDay(15) }).state).toBe("under");
    expect(paceStatus({ spent: 900, budgeted: 600, month: "2026-01-01", now: augDay(15) }).state).toBe("over");
  });

  it("reports the run-rate so a caller can explain the colour", () => {
    // $300 spent with half the month gone projects to ~$600.
    const r = paceStatus({ spent: 300, budgeted: 1000, month: AUG, now: augDay(15) });
    expect(r.projected).toBeGreaterThan(590);
    expect(r.projected).toBeLessThan(640);
    expect(r.state).toBe("under");
  });

  it("passes no judgment when nothing is budgeted", () => {
    // No target means nothing to miss — not a failure.
    expect(paceStatus({ spent: 50, budgeted: 0, month: AUG, now: augDay(15) }).state).toBe("unset");
    expect(paceStatus({ spent: 0, budgeted: 0, month: AUG, now: augDay(15) }).state).toBe("unset");
  });

  it("treats outflow sign-agnostically", () => {
    // envelope.js stores spend as NEGATIVE; the UI passes absolute values.
    const neg = paceStatus({ spent: -480, budgeted: 600, month: AUG, now: augDay(3) });
    const pos = paceStatus({ spent: 480, budgeted: 600, month: AUG, now: augDay(3) });
    expect(neg.state).toBe(pos.state);
  });

  it("does not divide by zero on a month that has not started", () => {
    expect(() => paceStatus({ spent: 0, budgeted: 600, month: "2026-12-01", now: augDay(15) })).not.toThrow();
  });
});

// ── Seeding a budget from history ───────────────────────────────────────────
// Deciding the number is the hardest step, and every mainstream app deletes it
// by reading your past spending. These pin the choices that make a suggestion
// trustworthy rather than merely present.
describe("suggestBudgets", () => {
  const AUG15 = new Date("2026-08-15T12:00:00Z");
  const HISTORY = [
    { date: "2026-05-04", amount: 150, category: ["Halal Food"] },
    { date: "2026-06-04", amount: 210, category: ["Halal Food"] },
    { date: "2026-07-04", amount: 180, category: ["Halal Food"] },
    { date: "2026-06-11", amount: 300, category: ["Travel"] },     // one month in three
    { date: "2026-07-01", amount: -4000, category: ["INCOME"] },
    { date: "2026-06-01", amount: -4000, category: ["INCOME"] },
  ];

  it("averages complete months", () => {
    // (150 + 210 + 180) / 3 = 180
    expect(suggestBudgets(HISTORY, { asOf: AUG15 }).categories["Halal Food"]).toBe(180);
  });

  it("IGNORES the current, partial month", () => {
    // Including it would drag every suggestion down by the days not yet lived.
    const withCurrent = [...HISTORY, { date: "2026-08-09", amount: 999, category: ["Halal Food"] }];
    expect(suggestBudgets(withCurrent, { asOf: AUG15 }).categories["Halal Food"]).toBe(180);
  });

  it("zero-pads a category that only appears in some months", () => {
    // $300 once in three months is $100/mo, not a $300 envelope. Rollover then
    // accumulates toward the occasional big month.
    expect(suggestBudgets(HISTORY, { asOf: AUG15 }).categories.Travel).toBe(100);
  });

  it("never suggests an income category as a spending envelope", () => {
    // spentByCategory returns positive for a credit; treating that as spend
    // turns a salary into a $2,665/mo budget line.
    const { categories } = suggestBudgets(HISTORY, { asOf: AUG15 });
    expect(categories).not.toHaveProperty("INCOME");
    expect(Object.keys(categories).sort()).toEqual(["Halal Food", "Travel"]);
  });

  it("suggests income separately, from inflow", () => {
    // 8000 over 3 months, rounded to the nearest 5.
    expect(suggestBudgets(HISTORY, { asOf: AUG15 }).income).toBe(2665);
  });

  it("suggests nothing at all without a complete month of history", () => {
    // A suggestion from no data is a guess wearing a suit.
    expect(suggestBudgets([], { asOf: AUG15 })).toEqual({ categories: {}, income: 0, monthsUsed: 0 });
    const brandNew = [{ date: "2026-08-02", amount: 50, category: ["Halal Food"] }];
    expect(suggestBudgets(brandNew, { asOf: AUG15 }).monthsUsed).toBe(0);
  });

  it("only averages over months the account actually existed for", () => {
    // Two months of history must not be divided by a three-month lookback.
    const twoMonths = [
      { date: "2026-06-04", amount: 200, category: ["Halal Food"] },
      { date: "2026-07-04", amount: 200, category: ["Halal Food"] },
    ];
    const r = suggestBudgets(twoMonths, { asOf: AUG15 });
    expect(r.monthsUsed).toBe(2);
    expect(r.categories["Halal Food"]).toBe(200);   // not 133
  });

  it("rounds to a readable step", () => {
    const odd = [{ date: "2026-07-04", amount: 187.34, category: ["Halal Food"] }];
    const r = suggestBudgets(odd, { asOf: AUG15, lookbackMonths: 1 });
    expect(r.categories["Halal Food"] % 5).toBe(0);
  });

  it("survives junk without throwing", () => {
    expect(() => suggestBudgets(null, { asOf: AUG15 })).not.toThrow();
    expect(() => suggestBudgets([{}, null], { asOf: AUG15 })).not.toThrow();
  });
});
