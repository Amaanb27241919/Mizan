import { describe, test, expect } from "vitest";
import {
  computeBudgetMonth, computeBudgetSeries, splitOfIncome, outflow,
  inheritedTotal, spendingCategories, categoryIcon, prettyCategory,
  EVERYTHING_ELSE,
} from "../lib/budgetPlan.js";

const M = "2026-08-01";
const MID = new Date("2026-08-15T12:00:00Z");   // roughly half the month elapsed
const END = new Date("2026-09-05T12:00:00Z");   // August is finished

/** spentByCategory's convention: outflow NEGATIVE, credit positive. */
const out = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, -v]));

describe("outflow", () => {
  test("treats a credit as zero spending, not negative spending", () => {
    // The bug this pins: taking Math.abs of both signs turned a $4,000 salary
    // into a $4,000 spending line.
    expect(outflow(4000)).toBe(0);
    expect(outflow(-250)).toBe(250);
    expect(outflow(0)).toBe(0);
    expect(outflow(undefined)).toBe(0);
  });
});

describe("splitOfIncome", () => {
  test("income splits into save and budget, and they sum back to income", () => {
    const s = splitOfIncome(3396, 2750);
    expect(s.budget).toBe(2750);
    expect(s.save).toBe(646);
    expect(s.budget + s.save).toBe(3396);
    expect(s.budgetPct).toBe(81);
    expect(s.savePct).toBe(19);
  });

  test("reports no percentages when income is unknown", () => {
    // Most Mizan users have no bank linked. Rendering "0% saved" for them would
    // state a savings rate that is not a fact.
    const s = splitOfIncome(0, 2750);
    expect(s.savePct).toBeNull();
    expect(s.budgetPct).toBeNull();
    expect(s.budget).toBe(2750);
  });

  test("a budget larger than income cannot produce negative savings", () => {
    const s = splitOfIncome(1000, 2500);
    expect(s.save).toBe(0);
    expect(s.budgetPct).toBe(100);
  });
});

describe("computeBudgetMonth", () => {
  // The exact shape of the Origin budget screen, so the model is pinned to a
  // real reference rather than to my own arithmetic.
  const origin = () => computeBudgetMonth({
    month: M, total: 2750, income: 3396, now: END,
    limits: { "Drinks & dining": 400, Other: 200, Groceries: 100, Shopping: 300 },
    spent: out({
      "Drinks & dining": 1160, Other: 411, Groceries: 377, Shopping: 113,
      Rent: 2000, Misc: 948,
    }),
  });

  test("Everything else absorbs the budget nobody named", () => {
    const r = origin();
    expect(r.allocated).toBe(1000);            // 400+200+100+300
    expect(r.everythingElse.limit).toBe(1750); // 2750 − 1000
  });

  test("Everything else absorbs the SPENDING nobody named", () => {
    const r = origin();
    // Rent 2000 + Misc 948 — categories with no limit and therefore no row.
    expect(r.everythingElse.spent).toBe(2948);
    expect(r.spent).toBe(5009);
  });

  test("the named rows plus Everything else account for every dollar spent", () => {
    // The property that makes this model trustworthy: nothing falls through.
    const r = origin();
    const sum = r.rows.reduce((s, x) => s + x.spent, 0) + r.everythingElse.spent;
    expect(sum).toBeCloseTo(r.spent, 2);
  });

  test("the named limits plus Everything else account for every dollar budgeted", () => {
    const r = origin();
    const sum = r.rows.reduce((s, x) => s + x.limit, 0) + r.everythingElse.limit;
    expect(sum).toBeCloseTo(r.total, 2);
  });

  test("reports the overspend against the whole budget", () => {
    const r = origin();
    expect(r.left).toBe(-2259);   // 2750 − 5009
    expect(r.over).toBe(true);
  });

  test("an unset budget is null, not a zero the user never chose", () => {
    const r = computeBudgetMonth({ month: M, total: null, spent: out({ Food: 50 }), now: END });
    expect(r.isSet).toBe(false);
    expect(r.total).toBeNull();
    expect(r.everythingElse).toBeNull();
    // Spending is still counted — the user has a real number to plan against.
    expect(r.spent).toBe(50);
  });

  test("flags limits that add up to more than the budget", () => {
    const r = computeBudgetMonth({
      month: M, total: 1000, limits: { A: 700, B: 600 }, spent: {}, now: END,
    });
    expect(r.overAllocated).toBe(true);
    expect(r.unallocated).toBe(-300);
    // Everything else cannot be negative — the contradiction is reported, not
    // smuggled into a bucket as a negative cap.
    expect(r.everythingElse.limit).toBe(0);
  });

  test("income is never counted as spending", () => {
    const r = computeBudgetMonth({
      month: M, total: 2000, income: 4000, now: END,
      limits: { Food: 500 },
      spent: { Food: -300, Payroll: 4000 },   // Payroll is a credit
    });
    expect(r.spent).toBe(300);
    expect(r.everythingElse.spent).toBe(0);
  });

  test("a refund inside a category nets its spending down", () => {
    const r = computeBudgetMonth({
      month: M, total: 500, limits: { Shopping: 200 }, now: END,
      spent: { Shopping: -70 },   // $100 spent, $30 refunded
    });
    expect(r.rows[0].spent).toBe(70);
    expect(r.rows[0].left).toBe(130);
  });

  test("colours the month by pace, not raw usage", () => {
    // 60% of the budget spent halfway through August is on track; the same 60%
    // on the 5th is not. paceStatus owns the rule — this pins that the total
    // goes through it rather than a bare ratio.
    const mid = computeBudgetMonth({ month: M, total: 1000, spent: out({ X: 600 }), now: MID });
    const early = computeBudgetMonth({ month: M, total: 1000, spent: out({ X: 600 }), now: new Date("2026-08-05T12:00:00Z") });
    expect(mid.pace.state).toBe("over-pace");
    expect(early.pace.state).toBe("over-pace");
    expect(early.pace.projected).toBeGreaterThan(mid.pace.projected);
  });
});

describe("computeBudgetSeries — rollover", () => {
  const ctx = (rollover) => ({
    rollover, now: END,
    plans:        { "2026-07-01": { total: 1000 }, "2026-08-01": { total: 1000 } },
    limitsByMonth:{ "2026-07-01": {},              "2026-08-01": {} },
    spentByMonth: { "2026-07-01": out({ X: 400 }), "2026-08-01": out({ X: 100 }) },
    incomeByMonth:{},
  });
  const MONTHS = ["2026-07-01", "2026-08-01"];

  test("carries last month's surplus forward when rollover is on", () => {
    const s = computeBudgetSeries(MONTHS, ctx(true));
    expect(s["2026-07-01"].left).toBe(600);
    expect(s["2026-08-01"].carriedIn).toBe(600);
    expect(s["2026-08-01"].available).toBe(1600);
    expect(s["2026-08-01"].left).toBe(1500);
  });

  test("carries an overspend forward too — rollover is not a one-way gift", () => {
    const c = ctx(true);
    c.spentByMonth["2026-07-01"] = out({ X: 1400 });
    const s = computeBudgetSeries(MONTHS, c);
    expect(s["2026-08-01"].carriedIn).toBe(-400);
    expect(s["2026-08-01"].available).toBe(600);
  });

  test("carries nothing when rollover is off", () => {
    const s = computeBudgetSeries(MONTHS, ctx(false));
    expect(s["2026-08-01"].carriedIn).toBe(0);
    expect(s["2026-08-01"].available).toBe(1000);
  });

  test("a month with no budget passes the balance through rather than erasing it", () => {
    // A gap in the history must not silently consume a surplus the user earned.
    const c = ctx(true);
    c.plans = { "2026-07-01": { total: 1000 }, "2026-09-01": { total: 1000 } };
    c.limitsByMonth["2026-09-01"] = {};
    c.spentByMonth["2026-09-01"] = {};
    const s = computeBudgetSeries(["2026-07-01", "2026-08-01", "2026-09-01"], c);
    expect(s["2026-08-01"].isSet).toBe(false);
    expect(s["2026-09-01"].carriedIn).toBe(600);
  });

  test("is order-independent — an unsorted month list still chains correctly", () => {
    const s = computeBudgetSeries(["2026-08-01", "2026-07-01"], ctx(true));
    expect(s["2026-08-01"].carriedIn).toBe(600);
  });
});

describe("inheritedTotal", () => {
  const plans = { "2026-06-01": { total: 2500 }, "2026-08-01": { total: 2750 } };

  test("uses the month's own budget when it has one", () => {
    expect(inheritedTotal(plans, "2026-08-01")).toEqual({ total: 2750, from: "2026-08-01", inherited: false });
  });

  test("carries the last set budget forward into a new month", () => {
    // Otherwise every September opens empty and the user retypes the same
    // number twelve times a year.
    const r = inheritedTotal(plans, "2026-09-01");
    expect(r.total).toBe(2750);
    expect(r.inherited).toBe(true);
  });

  test("does not reach forward from a later month", () => {
    expect(inheritedTotal(plans, "2026-07-01").total).toBe(2500);
    expect(inheritedTotal(plans, "2026-05-01").total).toBeNull();
  });

  test("survives a missing or malformed plan map", () => {
    expect(inheritedTotal(undefined, "2026-08-01").total).toBeNull();
    expect(inheritedTotal({}, null).total).toBeNull();
  });
});

describe("spendingCategories", () => {
  const txns = [
    { date: "2026-08-02", amount: 300, category: ["Groceries"] },
    { date: "2026-08-03", amount: 50,  category: ["Groceries"] },
    { date: "2026-08-04", amount: 120, category: ["Shopping"] },
    { date: "2026-08-05", amount: -4000, category: ["Payroll"] },   // credit
    { date: "2026-07-30", amount: 900, category: ["Rent"] },        // other month
  ];

  test("ranks this month's spending, biggest first", () => {
    const r = spendingCategories(txns, M);
    expect(r.map(x => x.category)).toEqual(["Groceries", "Shopping"]);
    expect(r[0].spent).toBe(350);
  });

  test("never offers an income category as something to cap", () => {
    expect(spendingCategories(txns, M).some(r => r.category === "Payroll")).toBe(false);
  });

  test("returns nothing rather than throwing on junk input", () => {
    expect(spendingCategories(null, M)).toEqual([]);
    expect(spendingCategories(txns, "not-a-month")).toEqual([]);
  });
});

describe("presentation helpers", () => {
  test("gives Islamic categories their own glyphs", () => {
    expect(categoryIcon("Zakat")).toBe("☾");
    expect(categoryIcon("Sadaqah")).toBe("◈");
    expect(categoryIcon("Masjid")).toBe("☪");
    expect(categoryIcon("Hajj / Umrah")).toBe("▲");
  });

  test("matches Plaid's SCREAMING_SNAKE categories too", () => {
    expect(categoryIcon("FOOD_AND_DRINK")).toBe("◆");
    expect(categoryIcon(EVERYTHING_ELSE)).toBe("∞");
  });

  test("falls back rather than rendering nothing for an unknown category", () => {
    expect(categoryIcon("Wibble")).toBe("•");
    expect(categoryIcon("")).toBe("•");
    expect(categoryIcon(null)).toBe("•");
  });

  test("makes a provider category readable without touching a human one", () => {
    expect(prettyCategory("FOOD_AND_DRINK")).toBe("Food & Drink");
    expect(prettyCategory("GENERAL_MERCHANDISE")).toBe("General Merchandise");
    expect(prettyCategory("Halal Food")).toBe("Halal Food");
    expect(prettyCategory("")).toBe("Uncategorized");
  });
});
