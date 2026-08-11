// Sharia screening engine — the pure ratio/verdict logic (no network).
// Focus: the fail-CLOSED contract. When debt cannot be verified the engine must
// resolve to "review", never a false "halal" — a false halal is the single worst
// output this product can produce. See lib/sharia.mjs.
import { describe, it, expect } from "vitest";
import { verdictFromFundamentals, evaluateAgainst, STANDARDS, normalizeOpenBBFundamentals } from "../../lib/sharia.mjs";

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

// ── OpenBB adapter mapping (PROTOTYPE) ───────────────────────────────────────
// The adapter's job is to turn OpenBB's normalized balance sheet into the same
// shape/units fhFundamentals() produces. The contract that must survive the swap
// is fail-CLOSED debt: a balance sheet with NO debt field is UNKNOWN (null), never
// a 0 that would clear the leverage screen. Pure function ⇒ no backend needed.
describe("normalizeOpenBBFundamentals", () => {
  // OpenBB returns raw dollars; the ratio engine works in millions.
  const balance = {
    total_assets: 352_583_000_000,
    total_debt: 106_629_000_000,
    cash_and_cash_equivalents: 29_943_000_000,
    short_term_investments: 35_228_000_000,
    accounts_receivable: 33_410_000_000,
  };
  const profile = { market_cap: 3_400_000_000_000, industry: "Consumer Electronics", name: "Apple Inc.", country: "US" };

  it("converts dollars to millions across every field", () => {
    const f = normalizeOpenBBFundamentals({ balance, profile });
    expect(f.assets).toBeCloseTo(352_583, 0);
    expect(f.debt).toBeCloseTo(106_629, 0);
    expect(f.recv).toBeCloseTo(33_410, 0);
    expect(f.mc).toBeCloseTo(3_400_000, 0);
  });

  it("sums cash + short-term investments when the combined field is absent", () => {
    const f = normalizeOpenBBFundamentals({ balance, profile });
    expect(f.cash).toBeCloseTo(65_171, 0); // 29,943 + 35,228
  });

  it("prefers the combined cash field when the provider supplies it", () => {
    const f = normalizeOpenBBFundamentals({ balance: { ...balance, cash_and_short_term_investments: 70_000_000_000 }, profile });
    expect(f.cash).toBeCloseTo(70_000, 0);
  });

  it("uses total_debt directly — no ratio×equity reconstruction", () => {
    const f = normalizeOpenBBFundamentals({ balance, profile });
    expect(f.debtSource).toBe("total_debt");
  });

  it("falls back to summed components when total_debt is missing (intrinio shape)", () => {
    const { total_debt, ...noTotal } = balance;
    const f = normalizeOpenBBFundamentals({
      balance: { ...noTotal, short_term_debt: 20_000_000_000, long_term_debt: 80_000_000_000 },
      profile,
    });
    expect(f.debt).toBeCloseTo(100_000, 0);
    expect(f.debtSource).toBe("components");
  });

  it("includes current_portion_of_long_term_debt (sec shape) — must not understate debt", () => {
    // Regression guard for a real defect: sec's long_term_debt is NONCURRENT only and
    // reports the current portion separately. Summing just short+long dropped $30B here,
    // pulling debt/MC from 33.3% (fails the AAOIFI 33% cap) to 23.3% (passes) — i.e. a
    // leveraged company silently screened halal. Understating debt is the one direction
    // that produces a false halal, so this is the highest-severity mapping bug class.
    const { total_debt, ...noTotal } = balance;
    const secShape = {
      ...noTotal,
      short_term_debt: 20_000_000_000,
      current_portion_of_long_term_debt: 30_000_000_000,
      long_term_debt: 50_000_000_000,
    };
    const f = normalizeOpenBBFundamentals({ balance: secShape, profile: { ...profile, market_cap: 300_000_000_000 } });
    expect(f.debt).toBeCloseTo(100_000, 0); // 20 + 30 + 50, not 70

    // Assert the consequence on the standard the omission actually flips. Against a
    // 300,000M market cap: correct 100,000M = 33.3% → FAILS AAOIFI's 33% cap;
    // understated 70,000M = 23.3% → PASSES. Same company, opposite verdict.
    const ctx = { sector: "halal", cash: f.cash, recv: f.recv, mc: f.mc, assets: f.assets };
    expect(evaluateAgainst(STANDARDS.AAOIFI, { ...ctx, debt: f.debt }).pass).toBe(false);
    expect(evaluateAgainst(STANDARDS.AAOIFI, { ...ctx, debt: 70_000 }).pass).toBe(true);
  });

  it("reads sec's cash_and_equivalents spelling, not just cash_and_cash_equivalents", () => {
    // sec names the field cash_and_equivalents; missing it reads cash as 0, which
    // silently PASSES the cash screen at 0.0% instead of evaluating it.
    const { cash_and_cash_equivalents, ...noFmpCash } = balance;
    const f = normalizeOpenBBFundamentals({
      balance: { ...noFmpCash, cash_and_equivalents: 29_943_000_000 },
      profile,
    });
    expect(f.cash).toBeCloseTo(65_171, 0); // 29,943 + 35,228 short_term_investments
  });

  it("FAIL-CLOSED: no debt field at all → debt null, never 0", () => {
    // The single most important assertion in this file. A 0 here would read as
    // "0% leverage", clear all seven standards, and bless a leveraged name halal.
    const { total_debt, ...noDebt } = balance;
    const f = normalizeOpenBBFundamentals({ balance: noDebt, profile });
    expect(f.debt).toBeNull();
    expect(f.debtSource).toBeNull();
    expect(verdictFromFundamentals("X", { industry: "Semiconductors", ...f }).status).toBe("review");
  });

  it("preserves a genuine ZERO debt as known (not unknown)", () => {
    const f = normalizeOpenBBFundamentals({ balance: { ...balance, total_debt: 0 }, profile });
    expect(f.debt).toBe(0);
    expect(f.debtSource).toBe("total_debt");
  });

  it("falls back to metrics for market cap when the profile lacks it", () => {
    const f = normalizeOpenBBFundamentals({ balance, profile: { industry: "Semiconductors" }, metrics: { market_cap: 500_000_000_000 } });
    expect(f.mc).toBeCloseTo(500_000, 0);
  });

  it("missing market cap → 0, so MC-denominated standards go unverifiable", () => {
    const f = normalizeOpenBBFundamentals({ balance, profile: { industry: "Semiconductors" } });
    expect(f.mc).toBe(0);
  });

  it("falls back to sector when industry is absent, and survives an empty payload", () => {
    expect(normalizeOpenBBFundamentals({ balance, profile: { sector: "Financial Services" } }).industry).toBe("Financial Services");
    const empty = normalizeOpenBBFundamentals({});
    expect(empty.debt).toBeNull();
    expect(empty.assets).toBe(0);
    expect(empty.industry).toBe("");
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
