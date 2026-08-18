// Guards the fix for the 2026-08-18 user report: "the compliance status is not
// changing if users pick the different screener."
//
// The bug was that `status` came from a cross-standard VOTE in lib/sharia.mjs
// (halal if >= 5 of 7 frameworks pass) and the user's chosen standard fed only a
// single checkmark column. These tests pin the property that actually matters:
// the SAME holding must be able to produce DIFFERENT verdicts under DIFFERENT
// standards, because real standards disagree.
import { describe, it, expect } from "vitest";
import { statusForStandard, statusMapForStandard, DEFAULT_STANDARD } from "../lib/shariaStatus.js";

/** A holding that clears AAOIFI's 49% receivables cap but fails Dow Jones' 33%. */
const splitVerdict = {
  tk: "ACME",
  status: "halal",                 // the old vote said halal
  byStandard: {
    AAOIFI:     { pass: true,  ratios: { recv: 41 } },
    DOWJONES:   { pass: false, fails: [{ rule: "Receivables" }] },
    SP_SHARIAH: { pass: true },
  },
};

describe("statusForStandard", () => {
  it("returns a DIFFERENT verdict for the same holding under different standards", () => {
    // This single assertion is the whole bug. Before the fix both were "halal".
    expect(statusForStandard(splitVerdict, "AAOIFI")).toBe("halal");
    expect(statusForStandard(splitVerdict, "DOWJONES")).toBe("haram");
  });

  it("ignores the server's vote-based status when the chosen standard disagrees", () => {
    // The payload says status:"halal". Dow Jones says no. The user picked Dow Jones.
    expect(splitVerdict.status).toBe("halal");
    expect(statusForStandard(splitVerdict, "DOWJONES")).not.toBe("halal");
  });

  it("never blesses an unevaluated standard — crypto stays 'review'", () => {
    // Crypto has no balance sheet, so every standard comes back pass:null. This
    // is the rule that stopped DOGE/XRP being auto-labelled halal in Aug 2026.
    const crypto = {
      tk: "DOGE", status: "review", assetType: "crypto",
      byStandard: { AAOIFI: { pass: null, note: "not evaluated — crypto" } },
    };
    expect(statusForStandard(crypto, "AAOIFI")).toBe("review");
    expect(statusForStandard(crypto, "AAOIFI")).not.toBe("halal");
  });

  it("keeps a prohibited SECTOR haram even if byStandard is missing or malformed", () => {
    // A data gap must never launder an alcohol name into "review".
    const sector = { tk: "BUD", status: "haram", reason: "Prohibited sector: Beverages - Brewers" };
    expect(statusForStandard(sector, "AAOIFI")).toBe("haram");
    expect(statusForStandard({ ...sector, byStandard: undefined }, "DOWJONES")).toBe("haram");
  });

  it("falls back to the server status when the chosen standard is absent", () => {
    // e.g. a Zoya verdict, which only carries AAOIFI.
    const zoya = { tk: "AAPL", status: "halal", byStandard: { AAOIFI: { pass: true } } };
    expect(statusForStandard(zoya, "SP_SHARIAH")).toBe("halal");
  });

  it("never upgrades an unknown into a pass", () => {
    expect(statusForStandard({ tk: "X", status: "unknown" }, "AAOIFI")).toBe("unknown");
    expect(statusForStandard(null, "AAOIFI")).toBe("unknown");
    expect(statusForStandard(undefined)).toBe("unknown");
  });

  it("defaults to AAOIFI", () => {
    expect(statusForStandard(splitVerdict)).toBe(statusForStandard(splitVerdict, DEFAULT_STANDARD));
    expect(DEFAULT_STANDARD).toBe("AAOIFI");
  });
});

describe("statusMapForStandard", () => {
  it("re-labels a whole portfolio when the standard changes", () => {
    const results = {
      ACME: splitVerdict,
      BUD:  { status: "haram", reason: "Prohibited sector: Brewers" },
      DOGE: { status: "review", byStandard: { AAOIFI: { pass: null }, DOWJONES: { pass: null } } },
    };
    const a = statusMapForStandard(results, "AAOIFI");
    const d = statusMapForStandard(results, "DOWJONES");

    expect(a).toEqual({ ACME: "halal",  BUD: "haram", DOGE: "review" });
    expect(d).toEqual({ ACME: "haram",  BUD: "haram", DOGE: "review" });
    // The compliance PERCENTAGE a user sees therefore moves with the standard,
    // which is exactly what was reported broken.
    const pctHalal = (m) => Object.values(m).filter((s) => s === "halal").length / Object.keys(m).length;
    expect(pctHalal(a)).toBeGreaterThan(pctHalal(d));
  });
});
