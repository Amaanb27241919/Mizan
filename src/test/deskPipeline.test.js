import { describe, it, expect } from "vitest";
import { deskPipeline, latestRoundAnswering, MARK_GLYPH } from "../lib/deskPipeline.js";
import { sparkPaths, pinToday } from "../lib/sparkline.js";

const row = (o) => ({ code: "A", name: "x", venue: "paper", unpriced: false, status: { text: "rebalance in 3d", tone: "ok" }, ...o });
const stage = (p, k) => p.stages.find((s) => s.key === k);

describe("deskPipeline", () => {
  it("reads every gate clear on a healthy desk", () => {
    const p = deskPipeline({
      session: { session: "regular", tradeable: true }, committee: { reviews: 4, complete: 4, anyAnswer: true, required: 3 },
      rows: [row()], bookState: "ready", compliance: { total: 27, screened: 27, failing: [] },
      account: { cash: "149825.12" }, deskState: "ready",
    });
    expect(p.stages.map((s) => s.mark)).toEqual(["ok", "ok", "ok", "ok", "ok", "ok"]);
    expect(stage(p, "sharia").detail).toBe("27/27 pass AAOIFI");
    expect(p.pauses).toMatchObject({ mark: "off", detail: "nothing paused" });
  });

  it("names what needs attention, and blocks on a failing holding or negative cash", () => {
    const p = deskPipeline({
      session: { session: "closed", tradeable: false }, committee: { reviews: 3, complete: 1, anyAnswer: true, required: 3 },
      rows: [row({ status: { text: "paused" } }), row({ code: "DCA", venue: "live", status: { text: "waiting for a deposit" } })],
      bookState: "ready", compliance: { total: 3, screened: 3, failing: ["XYZ"] },
      account: { cash: -5 }, deskState: "ready",
    });
    expect(stage(p, "market").mark).toBe("off");
    expect(stage(p, "ai")).toMatchObject({ mark: "warn", detail: "2 of 3 reviews missing an analyst" });
    expect(stage(deskPipeline({ committee: { reviews: 2, complete: 0, anyAnswer: false, required: 3 } }), "ai").mark).toBe("block");
    expect(stage(p, "sharia")).toMatchObject({ mark: "block", detail: "XYZ fail AAOIFI" });
    expect(stage(p, "cash").mark).toBe("block");
    expect(stage(p, "brokers")).toMatchObject({ mark: "warn" });
    expect(stage(p, "brokers").detail).toContain("DCA waiting for a deposit");
    expect(p.pauses.mark).toBe("warn");
  });

  it("an unscreened holding is a warning, never a pass or a fail", () => {
    const p = deskPipeline({ compliance: { total: 27, screened: 26, failing: [] } });
    expect(stage(p, "sharia")).toMatchObject({ mark: "warn", detail: "26/27 pass · 1 unscreened" });
  });

  it("says unknown — not clear — when nothing has been measured", () => {
    const p = deskPipeline(null);
    for (const s of p.stages) expect(s.mark).toBe("unknown");
    expect(stage(deskPipeline({ deskState: "unavailable" }), "brokers").mark).toBe("block");
    expect(MARK_GLYPH.unknown).toBeTruthy();
  });
});

describe("latestRoundAnswering", () => {
  it("counts reviews that heard from every analyst — per review, never as a union", () => {
    const rows = [
      { at: "2026-10-07T13:00:00Z", ensemble: { per_model: [{ provider: "google" }, { provider: "anthropic" }, { provider: "openrouter" }] } },
      { at: "2026-10-08T12:30:00Z", ensemble: { per_model: [{ provider: "google" }] } },
      { at: "2026-10-08T12:31:00Z", ensemble: { per_model: [{ provider: "anthropic" }] } },
      { at: "2026-10-08T12:32:00Z", ensemble: { per_model: [{ provider: "google" }, { provider: "anthropic" }, { provider: "openrouter" }] } },
      { at: "2026-10-08T13:05:00Z", screen_only: true },
    ];
    expect(latestRoundAnswering(rows, [], 3)).toEqual({ day: "2026-10-08", reviews: 3, complete: 1, anyAnswer: true, required: 3 });
    expect(latestRoundAnswering([], [], 3)).toBeNull();
    expect(latestRoundAnswering(null, null, null)).toBeNull();
  });
});

describe("sparkPaths", () => {
  it("draws both lines on one scale that always contains zero", () => {
    const g = sparkPaths([{ returnPct: 0, benchPct: 0 }, { returnPct: 1, benchPct: 2 }], { w: 100, h: 50, pad: 0 });
    expect(g.zeroY).toBe(50);
    expect(g.bench.split(" ").at(-1)).toBe("100.0,0.0");
    expect(g.strategy.split(" ").at(-1)).toBe("100.0,25.0");
  });
  it("needs two points, and skips missing values instead of plotting zero", () => {
    expect(sparkPaths([{ returnPct: 1 }])).toBeNull();
    const g = sparkPaths([{ returnPct: 0, benchPct: null }, { returnPct: 1, benchPct: null }]);
    expect(g.bench).toBeNull();
    expect(g.strategy).toBeTruthy();
  });
  it("pins today's live score as the last point", () => {
    const pts = [{ day: "2026-10-07", returnPct: 0 }, { day: "2026-10-08", returnPct: 0.5 }];
    expect(pinToday(pts, "2026-10-08", { returnPct: 1.02, benchPct: -0.1 }).at(-1)).toEqual({ day: "2026-10-08", returnPct: 1.02, benchPct: -0.1 });
    expect(pinToday(pts, "2026-10-08", null)).toHaveLength(1);
  });
});
