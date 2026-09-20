/**
 * Order SIZING rules — is this order well-formed, and can it be paid for in cash?
 *
 * Separated from the broker I/O so the arithmetic can be tested without a
 * network, the same way `sessions.mjs` holds the clock. `sessions.mjs` answers
 * "may this order be sent right now"; this answers "is this order a legal
 * shape, and is it affordable without borrowing".
 *
 * TWO RULES LIVE HERE.
 *
 * 1. FRACTIONAL ORDERS ARE DAY ORDERS. Alpaca supports fractional quantities
 *    and `notional` dollar amounts for market, limit, stop and stop-limit, but
 *    only with time_in_force=day. Any other TIF is rejected by the broker, so
 *    we reject it first with an error that names the reason instead of relaying
 *    a 422. `qty` and `notional` are mutually exclusive — sending both is an
 *    API error, and sending neither is a silent no-op.
 *
 * 2. THE CEILING IS CASH, NEVER BUYING POWER. This one is a Sharia rule, not a
 *    broker rule, and it inverts the usual meaning of a buying-power check. An
 *    Alpaca account reports 4x buying power against cash by default — the paper
 *    account opened for Trade Lab shows $400,000 against $100,000 — and
 *    spending any part of that gap is margin, which is riba. Every other
 *    platform validates against buying_power in order to PERMIT leverage; here
 *    the check exists to forbid it. `buying_power` must never be the
 *    denominator in an affordability test anywhere in this codebase.
 *
 *    The existing SnapTrade execution path already sizes on cash
 *    (`handlers.mjs` reads `b.cash`, never `b.buying_power`). This keeps the
 *    Alpaca path honest by the same standard rather than by memory.
 */

/** Alpaca only accepts fractional/notional orders with this time-in-force. */
export const FRACTIONAL_TIF = "day";

const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
const isWhole = (n) => Number.isFinite(n) && Math.floor(n) === n;

/**
 * Validate the shape of an order's size.
 * @returns {{ok:boolean, isFractional?:boolean, error?:string, code?:string}}
 */
export function validateOrderSizing({ qty = null, notional = null, type = "market", timeInForce = FRACTIONAL_TIF } = {}) {
  const q = num(qty);
  const n = num(notional);

  if (q !== null && n !== null) {
    return { ok: false, code: "qty_and_notional", error: "Pass either qty or notional, not both." };
  }
  if (q === null && n === null) {
    return { ok: false, code: "no_size", error: "qty or notional is required." };
  }
  if (n !== null) {
    if (!Number.isFinite(n) || n <= 0) return { ok: false, code: "bad_notional", error: "notional must be a positive dollar amount." };
    // Alpaca takes notional to 2dp; more precision is silently truncated, and a
    // silently-changed order amount is worse than a refusal.
    if (Math.round(n * 100) !== +(n * 100).toFixed(6)) {
      return { ok: false, code: "notional_precision", error: "notional accepts at most 2 decimal places." };
    }
  }
  if (q !== null && (!Number.isFinite(q) || q <= 0)) {
    return { ok: false, code: "bad_qty", error: "qty must be a positive number." };
  }

  const isFractional = n !== null || (q !== null && !isWhole(q));
  if (isFractional) {
    if (!["market", "limit", "stop", "stop_limit"].includes(type)) {
      return { ok: false, code: "fractional_type", error: `Fractional orders support market, limit, stop and stop_limit — not ${type}.` };
    }
    if (String(timeInForce).toLowerCase() !== FRACTIONAL_TIF) {
      return { ok: false, code: "fractional_tif", error: `Fractional and notional orders require time_in_force=${FRACTIONAL_TIF}.` };
    }
  }
  return { ok: true, isFractional };
}

/**
 * What will this order cost, if we can know it before sending?
 * Returns null when the value is genuinely unknowable client-side — a market
 * order given a share count and no quote. Null means "do not claim to know",
 * not "free".
 */
export function estimateOrderValue({ qty = null, notional = null, price = null } = {}) {
  const n = num(notional);
  if (n !== null && Number.isFinite(n)) return n;
  const q = num(qty), p = num(price);
  if (q !== null && p !== null && Number.isFinite(q) && Number.isFinite(p) && p > 0) return q * p;
  return null;
}

/**
 * Refuse to borrow. Buys must fit inside settled cash.
 * @returns {{ok:boolean, enforced:boolean, error?:string, code?:string}}
 */
export function withinCashCeiling({ side, estimatedValue = null, cash = null } = {}) {
  if (side !== "buy") return { ok: true, enforced: false };           // sells raise cash
  const v = num(estimatedValue), c = num(cash);
  // Unknown value or unknown cash — say so rather than pretending to have
  // checked. The caller still sizes on cash; this is the backstop, not the
  // only control.
  if (v === null || c === null || !Number.isFinite(v) || !Number.isFinite(c)) {
    return { ok: true, enforced: false };
  }
  if (v > c) {
    return {
      ok: false, enforced: true, code: "exceeds_cash",
      error: `Order value $${v.toFixed(2)} exceeds settled cash $${c.toFixed(2)}. The balance would be margin, which is riba — buying power is not the ceiling.`,
    };
  }
  return { ok: true, enforced: true };
}
