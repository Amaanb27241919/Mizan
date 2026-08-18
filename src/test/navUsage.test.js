// Nav-usage instrumentation. Owner-requested 2026-08-18 to answer "are there
// too many tabs?" with evidence.
//
// The properties under test are mostly about what this must NOT do: never
// block navigation, never throw, never send anything but a nav path, and never
// count a destination repeatedly while someone sits on it.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const calls = [];
vi.mock("../lib/apiFetch.js", () => ({
  apiFetch: (url, opts) => {
    calls.push({ url, body: JSON.parse(opts?.body || "{}") });
    return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
  },
}));

const load = async () => {
  const m = await import("../lib/navUsage.js");
  m._resetNavUsageThrottle();
  return m;
};

beforeEach(() => { calls.length = 0; vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("recordNavView", () => {
  it("sends only the nav path — nothing else can ride along", async () => {
    const { recordNavView } = await load();
    recordNavView("goals/zakat");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/nav-usage");
    // The entire payload. If a balance or ticker ever appears here, that is a
    // privacy regression, not a feature.
    expect(Object.keys(calls[0].body)).toEqual(["path"]);
    expect(calls[0].body.path).toBe("goals/zakat");
  });

  it("counts a destination once per minute, not once per render", async () => {
    const { recordNavView } = await load();
    recordNavView("overview");
    recordNavView("overview");
    recordNavView("overview");
    expect(calls).toHaveLength(1);
    vi.advanceTimersByTime(61_000);
    recordNavView("overview");
    expect(calls).toHaveLength(2);
  });

  it("throttles per destination, so flipping between tabs still counts both", async () => {
    const { recordNavView } = await load();
    recordNavView("overview");
    recordNavView("portfolio");
    expect(calls.map((c) => c.body.path)).toEqual(["overview", "portfolio"]);
  });

  it("drops anything that is not a nav path", async () => {
    const { recordNavView } = await load();
    for (const junk of [
      "", null, undefined, 42, {},
      "a".repeat(200),                    // oversized
      "goals?balance=52000",              // query string
      "<script>alert(1)</script>",        // markup
      "https://evil.example/x",           // absolute URL
      "goals\nzakat",                     // newline
    ]) {
      recordNavView(junk);
    }
    expect(calls).toHaveLength(0);
  });

  it("never throws, even when the network rejects", async () => {
    vi.resetModules();
    vi.doMock("../lib/apiFetch.js", () => ({
      apiFetch: () => Promise.reject(new Error("offline")),
    }));
    const m = await import("../lib/navUsage.js");
    m._resetNavUsageThrottle();
    // A metrics failure must never surface to the user or break navigation.
    expect(() => m.recordNavView("settings")).not.toThrow();
  });
});
