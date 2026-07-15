// Compliance guardrail — the advisor output filter and policy tiers.
// See docs/COMPLIANCE.md + lib/compliance/*.
import { describe, it, expect } from "vitest";
import {
  scanForProhibited, filterAdvisorText, filterAdvisorResponse,
} from "../../lib/compliance/advisor-filter.mjs";
import {
  DATA_TIERS, COMPLIANCE_REDIRECT, PROHIBITED_PATTERNS, assertImpersonal,
} from "../../lib/compliance/policy.mjs";

// Representative GENERATED answers that ARE personalized advice → must be flagged.
const PROHIBITED_OUTPUTS = [
  "You should buy AAPL now.",
  "You should sell your NVDA before earnings.",
  "I'd recommend selling your TSLA position.",
  "I suggest you add more VOO to your portfolio.",
  "Given your goals, I recommend adding VOO.",
  "Based on your portfolio, you should rebalance into tech.",
  "The best stock for you is NVDA.",
  "Here are the top picks for your retirement goals.",
  "A price target of $250 makes sense here.",
  "Buy below $150 and set a stop-loss at $140.",
  "Sell your winners and hold the rest.",
];

// Representative answers that are IMPERSONAL, educational, ACCOUNT_SERVICING, or
// the model's own refusal → must pass through unflagged.
const ALLOWED_OUTPUTS = [
  "NVDA is flagged non-compliant because its debt-to-market-cap ratio exceeds the 33% AAOIFI threshold.",
  "An ETF is a basket of securities that trades like a single stock.",
  "Your cost basis on TSLA is $210.40 across 12 shares.",
  "Your portfolio is 62% equities and 18% cash right now.",
  "Zakat on your gold: you should donate 2.5% of its value above the nisab threshold.",
  "Dividend purification means giving the impure portion of a dividend to charity.",
  "Riba is interest, which is why conventional bonds are screened out.",
  "I can't tell you whether to buy or sell your NVDA — that decision is yours.",
  "I won't recommend buying any specific stock for you, but I can explain the screening.",
  COMPLIANCE_REDIRECT,
];

describe("advisor filter — flags personalized advice", () => {
  it.each(PROHIBITED_OUTPUTS)("flags + redirects: %j", (text) => {
    const out = filterAdvisorText(text);
    expect(out.flagged).toBe(true);
    expect(out.matched.length).toBeGreaterThan(0);
    expect(out.text).toBe(COMPLIANCE_REDIRECT);
  });
});

describe("advisor filter — passes impersonal / educational / account-servicing", () => {
  it.each(ALLOWED_OUTPUTS)("allows unchanged: %j", (text) => {
    const out = filterAdvisorText(text);
    expect(out.flagged).toBe(false);
    expect(out.text).toBe(text);
  });
});

describe("advisor filter — no re-flag loop", () => {
  it("the compliant redirect itself is never flagged", () => {
    expect(scanForProhibited(COMPLIANCE_REDIRECT)).toHaveLength(0);
  });
});

describe("filterAdvisorResponse — Anthropic body rewrite", () => {
  it("rewrites text blocks to the redirect on a flag (immutably)", () => {
    const body = { id: "m", content: [{ type: "text", text: "You should buy AAPL now." }], usage: {} };
    const { body: out, flagged, matched } = filterAdvisorResponse(body);
    expect(flagged).toBe(true);
    expect(matched.length).toBeGreaterThan(0);
    expect(out.content[0].text).toBe(COMPLIANCE_REDIRECT);
    // original untouched (immutability)
    expect(body.content[0].text).toBe("You should buy AAPL now.");
  });

  it("leaves a clean answer untouched", () => {
    const body = { content: [{ type: "text", text: "Your cost basis on TSLA is $210.40." }] };
    const { body: out, flagged } = filterAdvisorResponse(body);
    expect(flagged).toBe(false);
    expect(out).toBe(body);
  });

  it("preserves tool_use blocks and only collapses text", () => {
    const body = { content: [
      { type: "text", text: "You should sell your NVDA." },
      { type: "tool_use", id: "t1", name: "web_search", input: {} },
    ] };
    const { body: out, flagged } = filterAdvisorResponse(body);
    expect(flagged).toBe(true);
    expect(out.content.find(b => b.type === "tool_use")).toBeTruthy();
    expect(out.content.filter(b => b.type === "text")).toHaveLength(1);
    expect(out.content.find(b => b.type === "text").text).toBe(COMPLIANCE_REDIRECT);
  });

  it("no-ops on malformed bodies", () => {
    expect(filterAdvisorResponse(null).flagged).toBe(false);
    expect(filterAdvisorResponse({}).flagged).toBe(false);
    expect(filterAdvisorResponse({ content: [] }).flagged).toBe(false);
  });
});

describe("policy module", () => {
  it("exposes the three tiers", () => {
    expect(DATA_TIERS).toEqual({
      IMPERSONAL: "impersonal",
      ACCOUNT_SERVICING: "account_servicing",
      PROHIBITED: "prohibited",
    });
  });

  it("has a non-empty prohibited-pattern list of {name, re}", () => {
    expect(PROHIBITED_PATTERNS.length).toBeGreaterThan(4);
    for (const p of PROHIBITED_PATTERNS) {
      expect(typeof p.name).toBe("string");
      expect(p.re).toBeInstanceOf(RegExp);
    }
  });

  it("assertImpersonal is a no-op in production and validates in dev", () => {
    const prev = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      expect(() => assertImpersonal("")).not.toThrow();     // no-op in prod
      process.env.NODE_ENV = "test";
      expect(() => assertImpersonal("candles route")).not.toThrow();
      expect(() => assertImpersonal("")).toThrow();          // fail-loud in dev
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
