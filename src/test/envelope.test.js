// Envelope budgeting math (src/lib/envelope.js), ported from actualbudget/actual.
// The rules being pinned:
//   leftover  = budgeted + spent + (carryover ? prevLeftover : max(0, prevLeftover))
//   overspent = Σ min(0, prevLeftover) over carryover=false categories
//   toBudget  = income + overspent − Σ budgeted
import { describe, it, expect } from "vitest";
import {
  monthKey, prevMonth, nextMonth, spentByCategory, leftoverByCategory,
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
