import { describe, it, expect } from "vitest";
import { expiresIn, pendingRows, historyRows, ticketScreenLine } from "../lib/orderQueue.js";

const NOW = Date.parse("2026-10-08T14:00:00Z");
const S = [{ id: "a1", params: { experiment: "A: reference system + AI gate" } }];

describe("orderQueue", () => {
  it("states expiry in minutes and hours", () => {
    expect(expiresIn("2026-10-08T14:42:00Z", NOW)).toBe("in 42 min");
    expect(expiresIn("2026-10-08T15:05:00Z", NOW)).toBe("in 1 h 5 min");
    expect(expiresIn("2026-10-08T13:59:00Z", NOW)).toBe("expired");
    expect(expiresIn("nope", NOW)).toBeNull();
  });

  it("names the strategy a pending signal came from", () => {
    const [r] = pendingRows([{ id: "s", status: "pending", strategy_id: "a1", side: "buy", qty: 3, ticker: "mu", suggested_price: "101.5", expires_at: "2026-10-08T14:30:00Z", paper: true }], S, NOW);
    expect(r).toMatchObject({ code: "A", name: "Reference system + AI gate", side: "buy", qty: 3, ticker: "MU", price: 101.5, expires: "in 30 min", paper: true });
    expect(pendingRows([{ status: "executed" }], S, NOW)).toEqual([]);
  });

  it("history leaves AI reviews out and says why an order failed", () => {
    const rows = historyRows([
      { id: "1", status: "shadow", ticker: "COHR", created_at: "2026-10-08T13:00:00Z" },
      { id: "2", status: "executed", strategy_id: "a1", ticker: "MU", side: "buy", qty: 1, executed_at: "2026-10-08T13:33:00Z" },
      { id: "3", status: "approved", error_msg: "insufficient_cash", ticker: "SPWO", side: "buy", qty: 1, created_at: "2026-10-08T13:40:00Z" },
      { id: "4", status: "rejected", error_msg: "sharia_blocked", ticker: "JPM", side: "buy", qty: 1, created_at: "2026-10-08T13:20:00Z" },
    ], S);
    expect(rows.map((r) => r.id)).toEqual(["3", "2", "4"]);
    expect(rows[0]).toMatchObject({ mark: "block", label: "Failed", reason: "insufficient cash", name: "hand order" });
    expect(rows[1]).toMatchObject({ mark: "ok", label: "Filled", code: "A" });
    expect(rows[2]).toMatchObject({ mark: "block", label: "Refused", reason: "sharia blocked" });
  });

  it("the ticket's Sharia line comes from a real verdict, never a static green", () => {
    const v = (pass) => ({ status: pass ? "halal" : "review", byStandard: { AAOIFI: { pass } } });
    expect(ticketScreenLine(v(true), "ready")).toEqual({ mark: "ok", text: "passes AAOIFI" });
    expect(ticketScreenLine(v(false), "ready").mark).toBe("block");
    expect(ticketScreenLine(v(false), "ready").text).toMatch(/does not stop it/);
    expect(ticketScreenLine(v(false), "ready", true).text).toBe("fails AAOIFI — a buy will be refused");
    expect(ticketScreenLine(v(false), "ready", true, "sell").text).toBe("fails AAOIFI — selling it is always allowed");
    expect(ticketScreenLine({ status: "review", byStandard: { AAOIFI: { pass: null } } }, "ready", true).text).toMatch(/refused until it passes/);
    expect(ticketScreenLine({ status: "review", byStandard: { AAOIFI: { pass: null } } }, "ready").mark).toBe("warn");
    expect(ticketScreenLine(null, "ready").mark).toBe("unknown");
    expect(ticketScreenLine(null, "loading").text).toMatch(/screening/);
  });
});
