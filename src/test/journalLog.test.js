import { describe, it, expect } from "vitest";
import { journalLog, nyDay } from "../lib/journalLog.js";

const S = [{ id: "a", params: { experiment: "A: reference system + AI gate" } }];
const ACT = [
  { id: "1", strategy_id: "a", side: "buy", ticker: "MU", qty: 34.55, status: "executed", paper: true, executed_at: "2026-10-08T13:33:00Z" },
  { id: "2", strategy_id: "a", side: "buy", ticker: "SPWO", qty: 1, status: "approved", paper: false, error_msg: "insufficient_cash", created_at: "2026-10-09T12:30:00Z" },
  { id: "3", strategy_id: "a", status: "shadow", ticker: "COHR", created_at: "2026-10-09T12:00:00Z" },
];
const RES = [
  { id: "r1", strategy_id: "a", ticker: "LRCX", at: "2026-10-09T12:32:00Z", packet_hash: "abcdef1234567890", missing: ["news"],
    ensemble: { ok: true, consensus: "BUY", unanimous: false, opposed: false, per_model: [{ provider: "google", action: "BUY", model: "gemini-x" }, { provider: "openrouter", action: "HOLD", model: "ds" }] },
    failures: [{ provider: "anthropic", code: "http_400", detail: "Your credit balance is too low" }] },
  { id: "r2", strategy_id: "a", ticker: "STX", at: "2026-10-09T12:20:00Z", screen_only: true, sharia_verdict: "haram" },
];

describe("journalLog", () => {
  it("merges orders and reviews into New York days, newest first; AI reviews never appear twice", () => {
    const log = journalLog(ACT, RES, S);
    expect(log.map((d) => d.day)).toEqual(["2026-10-09", "2026-10-08"]);
    expect(log[0].events.map((e) => e.id)).toEqual(["rv-r1", "or-2", "rv-r2"]);
    expect(log[0].events.find((e) => e.id === "or-2")).toMatchObject({ what: "Buy 1 SPWO — failed (real money)", why: "insufficient cash", mark: "block", code: "A" });
  });
  it("a review names each model, the panel view, failures in words, and its evidence", () => {
    const r = journalLog([], RES, S)[0].events[0];
    expect(r.what).toBe("LRCX reviewed — panel: buy, split");
    expect(r.why).toBe("Gemini buy · DeepSeek hold · Claude failed (no credits)");
    expect(r.evidence).toEqual({ hash: "abcdef123456", missing: ["news"], models: ["gemini-x", "ds"] });
    expect(journalLog([], RES, S)[0].events[1].what).toMatch(/stopped by the Sharia screen \(haram\)/);
    const noLabel = journalLog([], [{ id: "x", ticker: "COHR", at: "2026-10-08T12:30:00Z", ensemble: { ok: true, unanimous: true, per_model: [] } }], S)[0].events[0];
    expect(noLabel.what).toBe("COHR reviewed — panel: agreed");
  });
  it("filters by kind and strategy", () => {
    expect(journalLog(ACT, RES, S, { kind: "order" }).flatMap((d) => d.events).every((e) => e.kind === "order")).toBe(true);
    expect(journalLog(ACT, RES, S, { strategyId: "zzz" })).toEqual([]);
    expect(journalLog(null, null, null)).toEqual([]);
    expect(nyDay("2026-10-09T03:00:00Z")).toBe("2026-10-08");
  });
});
