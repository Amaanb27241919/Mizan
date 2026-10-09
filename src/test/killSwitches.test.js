import { describe, it, expect } from "vitest";
import { killSwitchRows } from "../lib/killSwitches.js";

describe("killSwitchRows", () => {
  const paper = (id, enabled = true) => ({ id, enabled, params: { broker: "alpaca_paper" } });
  it("states all five levels and names what is not built", () => {
    const rows = killSwitchRows([paper("a"), paper("b", false), { id: "dca", enabled: true, strategy_type: "dca", params: {} }]);
    expect(rows.map((r) => r.level)).toEqual(["Global", "Strategy", "Account", "Symbol", "Broker"]);
    expect(rows[0]).toMatchObject({ state: "not engaged", mark: "off" });
    expect(rows[1]).toMatchObject({ state: "1 paused", mark: "warn" });
    expect(rows[2].state).toMatch(/^1 real-money strategy;/);
    expect(rows[4]).toMatchObject({ built: false });
  });
  it("global reads engaged only when every strategy is paused", () => {
    expect(killSwitchRows([paper("a", false)])[0]).toMatchObject({ mark: "block", state: "engaged — every strategy is paused" });
    expect(killSwitchRows([])[0].state).toBe("no strategies");
    expect(killSwitchRows(null)).toHaveLength(5);
  });
  it("the shadow panel is not counted as real money", () => {
    expect(killSwitchRows([{ id: "s", params: { layer: "shadow" } }])[2].state).toBe("no real-money strategies");
  });
});
