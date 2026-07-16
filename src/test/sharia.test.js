// Sharia screening engine — the pure ratio/verdict logic (no network).
// Focus: the fail-CLOSED contract. When debt cannot be verified the engine must
// resolve to "review", never a false "halal" — a false halal is the single worst
// output this product can produce. See lib/sharia.mjs.
import { describe, it, expect } from "vitest";
import { verdictFromFundamentals, evaluateAgainst, STANDARDS } from "../../lib/sharia.mjs";

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
