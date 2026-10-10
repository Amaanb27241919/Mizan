import { describe, it, expect } from "vitest";
import { isRetryableRefusal, recordRefusals, retryDue, afterRetry, MAX_ATTEMPTS, EXPIRE_DAYS } from "../../lib/trading/rebalanceRetry.mjs";

const WASH = "potential wash trade detected. use complex orders";

describe("rebalanceRetry (BACKLOG F18)", () => {
  it("retries what waiting can fix, never a Sharia block or a cash shortfall", () => {
    expect(isRetryableRefusal(WASH)).toBe(true);
    expect(isRetryableRefusal("HTTP 503")).toBe(true);
    expect(isRetryableRefusal("XYZ does not pass the AAOIFI Sharia screen")).toBe(false);
    expect(isRetryableRefusal("insufficient buying power")).toBe(false);
    expect(isRetryableRefusal("asset FOO is not tradable")).toBe(false);
    expect(isRetryableRefusal("")).toBe(false);
  });
  it("remembers the refused orders only when something was placed", () => {
    const refused = [
      { sym: "mu", side: "buy", qty: 4, notional: null, price: 1034.76, error: WASH },
      { sym: "JPM", side: "buy", qty: 1, error: "sharia_blocked" },
    ];
    expect(recordRefusals(refused, "2026-10-09", 1)).toEqual({ date: "2026-10-09",
      orders: [{ sym: "MU", side: "buy", qty: 4, notional: null, price: 1034.76, attempts: 0, last_error: WASH }] });
    expect(recordRefusals(refused, "2026-10-09", 0)).toBeNull();   // nothing placed: the whole rebalance re-runs instead
    expect(recordRefusals([{ sym: "JPM", error: "sharia_blocked" }], "2026-10-09", 3)).toBeNull();
  });
  it("retries the same day and the next days, then expires", () => {
    const s = { date: "2026-10-09", orders: [{ sym: "MU", side: "buy", qty: 4, attempts: 0 }] };
    expect(retryDue(s, "2026-10-09").orders).toHaveLength(1);
    expect(retryDue(s, "2026-10-12").orders).toHaveLength(1);           // Fri → Mon is 3 days
    expect(retryDue(s, `2026-10-${9 + EXPIRE_DAYS + 1}`)).toEqual({ orders: [], expired: true });
    expect(retryDue(null, "2026-10-09").expired).toBe(true);
    expect(retryDue({ date: "2026-10-09", orders: [{ sym: "MU", side: "buy", attempts: MAX_ATTEMPTS }] }, "2026-10-09").expired).toBe(true);
  });
  it("after a retry: placed and dropped leave, a retryable failure counts an attempt, a permanent one leaves", () => {
    const s = { date: "2026-10-09", orders: [
      { sym: "MU", side: "buy", attempts: 0 }, { sym: "AMD", side: "buy", attempts: 0 },
      { sym: "TER", side: "buy", attempts: 0 }, { sym: "CRWD", side: "buy", attempts: 0 }, { sym: "FIX", side: "buy", attempts: 2 } ] };
    const next = afterRetry(s, [
      { sym: "MU", side: "buy", ok: true },
      { sym: "AMD", side: "buy", ok: false, error: WASH },
      { sym: "TER", side: "buy", ok: false, error: "insufficient buying power" },
      { sym: "CRWD", side: "buy", drop: true },
    ]);
    expect(next.orders.map((o) => [o.sym, o.attempts])).toEqual([["AMD", 1], ["FIX", 2]]);
    expect(afterRetry({ date: "d", orders: [{ sym: "MU", side: "buy", attempts: MAX_ATTEMPTS - 1 }] }, [{ sym: "MU", side: "buy", ok: false, error: WASH }])).toBeNull();
    expect(afterRetry(null, [])).toBeNull();
  });
});
