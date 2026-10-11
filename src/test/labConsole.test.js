import { describe, it, expect } from "vitest";
import { consoleAlerts, alertCounts, orderQueue, stageGeometry, yTicks, lastActivity, nyDay } from "../lib/labConsole.js";

// Friday 2026-10-09, 15:00 ET.
const NOW = Date.parse("2026-10-09T19:00:00Z");
const items = [
  { id: 1, ticker: "mu", side: "buy", status: "rejected", paper: true, error_msg: "potential wash trade detected", strategy_id: "e", created_at: "2026-10-09T18:30:00Z" },
  { id: 2, ticker: "AMAT", side: "buy", status: "executed", paper: true, strategy_id: "e", created_at: "2026-10-09T18:30:00Z", executed_at: "2026-10-09T18:31:00Z" },
  { id: 3, ticker: "SPWO", side: "buy", status: "rejected", paper: false, error_msg: "custodial 1140", strategy_id: "dca", created_at: "2026-10-08T14:00:00Z" },
  { id: 4, ticker: "TER", side: "buy", status: "submitted", paper: true, strategy_id: "e", created_at: "2026-10-09T18:32:00Z" },
  { id: 5, ticker: "COHR", side: "buy", status: "shadow", strategy_id: "sh", created_at: "2026-10-09T13:00:00Z" },
  { id: 6, ticker: "OLD", side: "buy", status: "rejected", paper: false, created_at: "2026-10-01T14:00:00Z" },
  { id: 7, ticker: "X", side: "buy", status: "pending", strategy_id: "a", created_at: "2026-10-09T17:00:00Z" },
];
const codes = new Map([["e", "E·core"], ["dca", "LIVE"]]);

describe("consoleAlerts", () => {
  const alerts = consoleAlerts({ items, codes, pending: 1, compliance: { failing: 2 },
    pipeline: { stages: [{ key: "ai", label: "AI committee", mark: "warn", detail: "1 of 3 answering" }, { key: "cash", label: "Cash", mark: "ok" }] } }, { now: NOW });
  it("puts critical first: a rejected LIVE order and failing AAOIFI holdings", () => {
    expect(alerts.slice(0, 2).map((a) => a.level)).toEqual(["crit", "crit"]);
    expect(alerts.map((a) => a.title)).toContain("Rejected · BUY SPWO");
    expect(alerts.map((a) => a.title)).toContain("2 holdings fail AAOIFI");
  });
  it("a rejected PAPER order is a warning, named with its strategy and the broker's reason", () => {
    const mu = alerts.find((a) => a.title === "Rejected · BUY MU");
    expect(mu).toMatchObject({ level: "warn", who: "E·core", detail: "potential wash trade detected" });
  });
  it("never lists AI reviews as orders, drops what is older than the horizon, and ignores a healthy stage", () => {
    const titles = alerts.map((a) => a.title).join("|");
    expect(titles).not.toMatch(/COHR|OLD|Cash/);
    expect(titles).toMatch(/AI committee/);
  });
  it("counts info lines as a log, not as active alerts", () => {
    expect(alerts.find((a) => a.title === "Filled · BUY AMAT").level).toBe("info");
    expect(alertCounts(alerts)).toEqual({ active: alerts.length - 1, crit: 2 });
  });
  it("an unknown pending count is not an alert", () => {
    expect(consoleAlerts({ items: [], pending: null }, { now: NOW })).toEqual([]);
    expect(consoleAlerts(null, null)).toEqual([]);
  });
});

describe("orderQueue", () => {
  const q = orderQueue(items, { now: NOW });
  it("counts today in New York, and never counts an AI review", () => {
    expect(q).toMatchObject({ waiting: 1, working: 1, filled: 1, refused: 1 });
    expect(q.tape.map((t) => t.ticker)).toEqual(["X", "MU", "AMAT", "TER"]);
  });
  it("histograms orders per day, oldest first", () => {
    expect(q.days.map((d) => d.day)).toEqual(["2026-10-01", "2026-10-08", "2026-10-09"]);
    expect(q.days.at(-1).n).toBe(4);
  });
  it("New York's day, not UTC's: 01:00 UTC Saturday is still Friday", () => {
    expect(nyDay(Date.parse("2026-10-10T01:00:00Z"))).toBe("2026-10-09");
  });
});

describe("stageGeometry", () => {
  const curves = {
    a: { points: [{ day: "2026-10-07", returnPct: 0, benchPct: 0 }, { day: "2026-10-08", returnPct: -1, benchPct: -0.5 }, { day: "2026-10-09", returnPct: 1, benchPct: 0.2 }] },
    e: { points: [{ day: "2026-10-08", returnPct: 0, benchPct: 0 }, { day: "2026-10-09", returnPct: -0.2, benchPct: 0.4 }] },
    f: { points: [{ day: "2026-10-09", returnPct: 0 }] },
  };
  const rows = [{ id: "a", code: "A", color: "#123" }, { id: "e", code: "E·core" }, { id: "f", code: "F" }];
  it("puts every strategy on one calendar: a later start begins further right", () => {
    const g = stageGeometry(curves, rows, new Set(["a", "e", "f"]), { w: 1000, h: 300, pad: 0 });
    const [a, e] = g.lines;
    expect(g.days).toEqual(["2026-10-07", "2026-10-08", "2026-10-09"]);
    expect(a.xy[0][0]).toBe(0);
    expect(e.xy[0][0]).toBe(500);
    expect(g.lines.map((l) => l.id)).toEqual(["a", "e"]);   // F has one point: nothing to draw
    expect(a.lastPct).toBe(1);
  });
  it("one shared scale that contains 0, and SPUS from the longest-measured strategy", () => {
    const g = stageGeometry(curves, rows, new Set(["a", "e"]), { w: 1000, h: 300, pad: 0 });
    expect(g.lo).toBeLessThan(-1);
    expect(g.hi).toBeGreaterThan(1);
    expect(g.bench).toHaveLength(3);
    expect(g.ticks.map((t) => t.v)).toContain(0);
  });
  it("draws only the layers switched on, and nothing when none are", () => {
    expect(stageGeometry(curves, rows, new Set(["e"])).lines.map((l) => l.id)).toEqual(["e"]);
    expect(stageGeometry(curves, rows, new Set())).toBeNull();
    expect(stageGeometry(null, null, null, null)).toBeNull();
  });
});

describe("helpers", () => {
  it("yTicks are round numbers including 0", () => {
    expect(yTicks(-1.2, 2.1)).toEqual([-1, 0, 1, 2]);
    expect(yTicks(-0.6, 0.6)).toEqual([-0.5, -0.25, 0, 0.25, 0.5]);
    expect(yTicks(null, 1)).toEqual([]);
  });
  it("lastActivity is the newest order or review", () => {
    expect(lastActivity(items, [{ created_at: "2026-10-09T18:45:00Z" }])).toBe(Date.parse("2026-10-09T18:45:00Z"));
    expect(lastActivity(null, null)).toBeNull();
  });
});
