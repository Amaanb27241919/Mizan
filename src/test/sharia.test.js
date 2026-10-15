// Sharia screening engine — the pure ratio/verdict logic (no network).
// Focus: the fail-CLOSED contract. When debt cannot be verified the engine must
// resolve to "review", never a false "halal" — a false halal is the single worst
// output this product can produce. See lib/sharia.mjs.
import { describe, it, expect } from "vitest";
import { verdictFromFundamentals, evaluateAgainst, STANDARDS, impermissibleIncome, ACTIVITY_EXCLUSIONS, activityExclusion } from "../../lib/sharia.mjs";

// A clean, non-financial industry so the sector screen doesn't interfere — the
// verdict is then driven purely by the ratios (which is what we're testing).
const CLEAN = "Semiconductors";
// Both denominators supplied (in millions) so all 7 standards evaluate.
const base = { industry: CLEAN, mc: 1000, assets: 1000, cash: 100, recv: 0, source: "test" };

describe("verdictFromFundamentals — debt screen", () => {
  it("known low debt (10% of mc) → halal", () => {
    const v = verdictFromFundamentals("TEST", { ...base, debt: 100 });
    expect(v.status).toBe("halal");
    expect(v.debtKnown).toBe(true);
    expect(v.passCount).toBe(7);
  });

  it("known ZERO debt (genuinely debt-free) → halal, not over-failed", () => {
    // Regression guard: der === 0 is a KNOWN zero. The fail-closed change must
    // not punish a legitimately debt-free company by flipping it to "review".
    const v = verdictFromFundamentals("TEST", { ...base, debt: 0 });
    expect(v.status).toBe("halal");
    expect(v.debtKnown).toBe(true);
  });

  it("UNKNOWN debt (null) with real assets/mc → review, debtKnown=false", () => {
    // The core fail-closed assertion: unverifiable debt must NOT clear the
    // leverage screen at "0.0%". It falls to "review", not "halal".
    const v = verdictFromFundamentals("TEST", { ...base, debt: null });
    expect(v.status).toBe("review");
    expect(v.debtKnown).toBe(false);
    expect(v.passCount).toBe(0); // no standard counts as a clean pass
    expect(v.failCount).toBe(0); // and unknown is NOT a hard fail either
  });

  it("known HIGH debt (50% of mc, over the 33% cap) → haram", () => {
    const v = verdictFromFundamentals("TEST", { ...base, debt: 500 });
    expect(v.status).not.toBe("halal");
    expect(v.status).toBe("haram");
    expect(v.debtKnown).toBe(true);
  });
});

describe("verdictFromFundamentals — sector + missing data", () => {
  it("prohibited sector (banks) → haram regardless of ratios", () => {
    const v = verdictFromFundamentals("BANK", { ...base, industry: "Banks", debt: 0 });
    expect(v.status).toBe("haram");
  });

  it("whole balance sheet missing (assets 0, debt null) → review", () => {
    // Mirrors screenViaFinnhub's fallback: profile marketCap present, but no
    // balance sheet → asset-denominated standards guard on assets<=0 and
    // marketCap-denominated standards can't reach the >=5 pass threshold.
    const v = verdictFromFundamentals("NOBS", { ...base, assets: 0, debt: null, cash: 0 });
    expect(v.status).toBe("review");
  });
});

describe("evaluateAgainst — per-standard debt handling", () => {
  const ctx = { sector: "halal", cash: 100, recv: 0, mc: 1000, assets: 1000, nonPermPct: undefined };

  it("unknown debt → pass:null (unverifiable), not a pass and not a fail", () => {
    const r = evaluateAgainst(STANDARDS.AAOIFI, { ...ctx, debt: null });
    expect(r.pass).toBe(null);
    const debtTest = r.tests.find(t => t.rule.startsWith("Debt/"));
    expect(debtTest.pass).toBe(null);
    expect(debtTest.detail).toBe("unknown");
  });

  it("known low debt → pass:true", () => {
    const r = evaluateAgainst(STANDARDS.AAOIFI, { ...ctx, debt: 100 });
    expect(r.pass).toBe(true);
  });

  it("known high debt → pass:false (hard fail)", () => {
    const r = evaluateAgainst(STANDARDS.AAOIFI, { ...ctx, debt: 500 });
    expect(r.pass).toBe(false);
    expect(r.fails.some(t => t.rule.startsWith("Debt/"))).toBe(true);
  });
});

// AAOIFI Shari'ah Standard No. 21, as AAOIFI's Secretary-General presents it:
// interest-bearing debt and deposits each NOT EXCEEDING 30% of market value,
// impermissible income not exceeding 5% of total income, and no receivables
// limit. Corrected 2026-10-14 from 33% / 33% / 49% (the index providers').
describe("AAOIFI — the limits are the standard's own", () => {
  const ctx = { sector: "halal", cash: 0, recv: 0, mc: 1000, assets: 1000, debt: 0 };
  const debtTest = (r) => r.tests.find((t) => t.rule.startsWith("Debt/"));
  it("debt at exactly 30% passes (not exceeding); just over fails", () => {
    expect(debtTest(evaluateAgainst(STANDARDS.AAOIFI, { ...ctx, debt: 300 })).pass).toBe(true);
    expect(debtTest(evaluateAgainst(STANDARDS.AAOIFI, { ...ctx, debt: 301 })).pass).toBe(false);
  });
  it("cash at 30% passes; 32% fails AAOIFI but still passes Dow Jones (33%, less than)", () => {
    expect(evaluateAgainst(STANDARDS.AAOIFI, { ...ctx, cash: 300 }).pass).toBe(true);
    expect(evaluateAgainst(STANDARDS.AAOIFI, { ...ctx, cash: 320 }).pass).toBe(false);
    expect(evaluateAgainst(STANDARDS.DOWJONES, { ...ctx, cash: 320 }).pass).toBe(true);
    expect(evaluateAgainst(STANDARDS.DOWJONES, { ...ctx, cash: 330 }).pass).toBe(false);
  });
  it("AAOIFI runs no receivables test; S&P still does", () => {
    const r = evaluateAgainst(STANDARDS.AAOIFI, { ...ctx, recv: 900 });
    expect(r.tests.some((t) => t.rule.startsWith("A/R"))).toBe(false);
    expect(r.pass).toBe(true);
    expect(evaluateAgainst(STANDARDS.SP_SHARIAH, { ...ctx, recv: 900 }).pass).toBe(false);
  });
  it("measured impermissible income over 5% fails; at 5% passes", () => {
    expect(evaluateAgainst(STANDARDS.AAOIFI, { ...ctx, nonPermPct: 5, nonPermBasis: "interest_income" }).pass).toBe(true);
    const r = evaluateAgainst(STANDARDS.AAOIFI, { ...ctx, nonPermPct: 6.2, nonPermBasis: "interest_income" });
    expect(r.pass).toBe(false);
    expect(r.fails[0].rule).toBe("Non-permissible income");
  });
  it("an ESTIMATE from other income may clear the test but never fails it — over the limit it is review", () => {
    expect(evaluateAgainst(STANDARDS.AAOIFI, { ...ctx, nonPermPct: 3.2, nonPermBasis: "other_income_estimate" }).pass).toBe(true);
    const r = evaluateAgainst(STANDARDS.AAOIFI, { ...ctx, nonPermPct: 8, nonPermBasis: "other_income_estimate" });
    expect(r.pass).toBe(null);
    expect(r.tests.at(-1).detail).toBe("≈8.0% (other income)");
  });
  it("not measurable → not evaluated, as before", () => {
    const r = evaluateAgainst(STANDARDS.AAOIFI, { ...ctx, nonPermPct: undefined });
    expect(r.tests.some((t) => t.rule === "Non-permissible income")).toBe(false);
    expect(r.pass).toBe(true);
  });
});

describe("impermissibleIncome — read from the income statement", () => {
  const row = (concept, value) => ({ concept: `us-gaap_${concept}`, value });
  it("measures reported interest income against revenue (NVDA-shaped)", () => {
    expect(impermissibleIncome([row("Revenues", 215938e6), row("InvestmentIncomeInterest", 2300e6), row("NonoperatingIncomeExpense", 11063e6)]))
      .toEqual({ nonPermPct: 1.07, nonPermBasis: "interest_income" });
  });
  it("estimates from positive other income when interest is not broken out (MSFT-shaped)", () => {
    expect(impermissibleIncome([row("RevenueFromContractWithCustomerExcludingAssessedTax", 331839e6), row("NonoperatingIncomeExpense", 10697e6)]))
      .toEqual({ nonPermPct: 3.22, nonPermBasis: "other_income_estimate" });
  });
  it("a negative other-income line tells us nothing → not measured (AAPL-shaped)", () => {
    expect(impermissibleIncome([row("RevenueFromContractWithCustomerExcludingAssessedTax", 416161e6), row("NonoperatingIncomeExpense", -321e6)]))
      .toEqual({ nonPermPct: null, nonPermBasis: null });
  });
  it("no revenue or malformed input → not measured", () => {
    expect(impermissibleIncome([row("InvestmentIncomeInterest", 5)])).toEqual({ nonPermPct: null, nonPermBasis: null });
    expect(impermissibleIncome(null)).toEqual({ nonPermPct: null, nonPermBasis: null });
    expect(impermissibleIncome([null, { concept: 5 }])).toEqual({ nonPermPct: null, nonPermBasis: null });
  });
});

// Finnhub files every drinks company as "Beverages" and casinos under "Hotels,
// Restaurants & Leisure", so the label screen never caught them. A debt-free
// brewer with clean ratios must still be haram (2026-10-15).
describe("business activity by company", () => {
  const clean = { industry: "Beverages", mc: 1000, assets: 1000, cash: 50, recv: 0, debt: 0, source: "test" };
  it("a low-debt brewer labelled 'Beverages' is haram, with the activity named", () => {
    const v = verdictFromFundamentals("SAM", clean);
    expect(v.status).toBe("haram");
    expect(v.reason).toBe("Prohibited sector: Alcohol (brewer)");
    expect(Object.values(v.byStandard).every((b) => b.pass === false)).toBe(true);
  });
  it("casinos and sportsbooks are haram, not 'review'", () => {
    expect(verdictFromFundamentals("DKNG", { ...clean, industry: "Hotels, Restaurants & Leisure" }).status).toBe("haram");
    expect(verdictFromFundamentals("LVS", { ...clean, industry: "Hotels, Restaurants & Leisure" }).reason).toMatch(/Gambling/);
  });
  it("Coca-Cola and Pepsi — same 'Beverages' label — are judged on their ratios as before", () => {
    expect(verdictFromFundamentals("KO", clean).status).toBe("halal");
    expect(verdictFromFundamentals("PEP", clean).status).toBe("halal");
  });
  it("is case-insensitive, and every entry names an activity", () => {
    expect(activityExclusion("bud")).toBe("Alcohol (brewer)");
    expect(activityExclusion("AAPL")).toBeNull();
    for (const [tk, why] of Object.entries(ACTIVITY_EXCLUSIONS)) {
      expect(tk).toMatch(/^[A-Z]{1,5}(\.[A-Z])?$/);
      expect(why).toMatch(/^(Alcohol|Gambling|Pork)/);
    }
  });
});
