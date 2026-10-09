import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// 2026-10-08: a browser price fallback called Claude with web search and a
// 6,000-token budget on every background refresh of an open tab, ~25 times an
// hour around the clock, until the Anthropic account ran dry. These pin the
// fix at both ends.
const read = (f) => readFileSync(path.resolve(__dirname, "../..", f), "utf8");

describe("the Assistant endpoint decides what a call may cost", () => {
  const SRC = read("lib/handlers.mjs");
  const route = SRC.slice(SRC.indexOf('if (pathname === "/api/advisor" && method === "POST")'), SRC.indexOf('if (pathname === "/api/advisor/count"'));
  it("never forwards tools (no web search through the proxy)", () => {
    expect(route).toMatch(/const tools = null;/);
    // A request carrying tools is refused before any Anthropic call is made.
    const refuse = route.indexOf('error: "tools_not_supported"'), call = route.indexOf('api.anthropic.com');
    expect(refuse).toBeGreaterThan(-1);
    expect(refuse).toBeLessThan(call);
    expect(route).not.toMatch(/SAFE_TOOLS/);
  });
  it("caps the reply and pins the model server-side", () => {
    expect(route).toMatch(/const ADVISOR_MAX_TOKENS = 1500;/);
    expect(route).toMatch(/Math\.min\(ADVISOR_MAX_TOKENS/);
    expect(route).toMatch(/const model = process\.env\.ADVISOR_MODEL \|\| "claude-sonnet-4-6";/);
    expect(route).not.toMatch(/parsed\.model/);
  });
});

describe("the app never asks a chatbot for prices", () => {
  const APP = read("src/components/MizanApp.jsx");
  it("has no Claude price or news fallback", () => {
    expect(APP).not.toMatch(/fetchAIPrices|fetchAINews/);
    expect(APP).not.toMatch(/web_search_20250305/);
  });
});
