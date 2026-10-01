/**
 * Did the order actually fill?
 *
 * The engine has been marking a signal `executed` the moment the broker
 * answered 2xx. Alpaca answers 2xx on ACCEPT, not on fill — a market order
 * placed outside session hours is queued and fills at the next open, and a
 * notional order can fill partially. So "executed" has meant "we sent it",
 * while every downstream reader (bookFromSignals, realized P&L, the rebalance
 * plan) treats it as "we own it".
 *
 * That gap is the whole reason the rank-rebalance branch ships disabled. A
 * forward test whose ledger drifts from the broker proves nothing, and a
 * rebalancer that thinks it owns the wrong book will sell what it does not
 * have and re-buy what it already holds.
 *
 * Pure: an order payload in, a verdict out. No network, no clock, no database,
 * because this is the function that decides what the ledger believes.
 */

/**
 * Alpaca order states that can still change. Anything here means "ask again
 * later" — NOT "it failed", which is the mistake that would cancel live orders
 * the broker is still working.
 */
export const OPEN_STATUSES = Object.freeze(new Set([
  "new", "accepted", "pending_new", "accepted_for_bidding", "partially_filled",
  "pending_cancel", "pending_replace", "pending_review", "held", "calculated",
  "stopped", "suspended", "replaced",
]));

/** States that will never change again. */
export const TERMINAL_STATUSES = Object.freeze(new Set([
  "filled", "canceled", "cancelled", "expired", "rejected", "done_for_day",
]));

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * @param {object} order  Alpaca order payload (or null if it could not be read)
 * @returns {{
 *   known: boolean,      // did we learn anything at all
 *   terminal: boolean,   // will this change again
 *   filledQty: number,   // shares actually filled (0 if none)
 *   avgPrice: number|null,
 *   status: string|null,
 *   outcome: "filled"|"partial"|"open"|"dead"|"unknown",
 * }}
 */
export function readFill(order) {
  if (!order || typeof order !== "object") {
    // Unknown is NOT the same as dead. A network blip must leave the row alone
    // rather than resolve it to a state the broker never reported.
    return { known: false, terminal: false, filledQty: 0, avgPrice: null, status: null, outcome: "unknown" };
  }
  const status = String(order.status || "").toLowerCase() || null;
  const filledQty = num(order.filled_qty);
  const avgRaw = Number(order.filled_avg_price);
  const avgPrice = Number.isFinite(avgRaw) && avgRaw > 0 ? avgRaw : null;

  const terminal = status !== null && TERMINAL_STATUSES.has(status);
  const open = status !== null && OPEN_STATUSES.has(status);

  let outcome;
  if (status === null) outcome = "unknown";
  else if (filledQty > 0 && terminal) outcome = "filled";
  else if (filledQty > 0) outcome = "partial";           // open and partly done
  else if (terminal) outcome = "dead";                    // terminal, nothing filled
  else if (open) outcome = "open";
  else outcome = "unknown";                               // a status we do not model

  return { known: status !== null, terminal, filledQty, avgPrice, status, outcome };
}

/**
 * What the ledger row should become, given the broker's answer.
 *
 * Returns null when nothing should change — which is the important case. An
 * order the broker is still working, or one we could not read, must leave the
 * row exactly as it is. Writing a guess here is how a ledger starts lying.
 *
 * @param {ReturnType<readFill>} fill
 * @returns {{status:string, qty:number, suggested_price?:number}|null}
 */
export function reconcileSignal(fill) {
  // NOTE ON TWO REDUNDANT BRANCHES. `!fill.known` and the explicit "partial"
  // case below both fall through to the same answer `default` already gives,
  // so mutation testing correctly reports them as behaviourally dead. They are
  // kept because this function decides what the ledger believes, and a reader
  // should SEE that a partial fill and an unreadable order are deliberately
  // not resolved rather than inferring it from a default. The enumeration is
  // documentation; `default` is the safety net.
  if (!fill || !fill.known) return null;
  switch (fill.outcome) {
    case "filled":
      // The ONLY path that may claim a position. qty becomes what the broker
      // says filled, not what we asked for — a notional order's share count is
      // not knowable until this moment.
      return { status: "executed", qty: fill.filledQty, ...(fill.avgPrice ? { suggested_price: fill.avgPrice } : {}) };
    case "dead":
      // Terminal with nothing filled: canceled, expired, rejected. It never
      // became a position and must not count as one.
      return { status: "rejected", qty: 0 };
    case "partial":
    case "open":
    case "unknown":
    default:
      return null;   // still working, or we do not know — leave it alone
  }
}

/**
 * A partially filled order that is now terminal (done_for_day with a part
 * fill) still owns shares. Separated from reconcileSignal because it is the
 * case most likely to be got wrong: terminal + partial means we DO hold
 * something, just less than we asked for.
 */
export function settledQty(fill) {
  if (!fill || !fill.known) return 0;
  return fill.terminal ? fill.filledQty : 0;
}
