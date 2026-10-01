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
  "pending_cancel", "pending_replace", "held", "calculated", "stopped",
  "suspended",
  // done_for_day is OPEN, not terminal. The docs say it "will not receive
  // further updates UNTIL THE NEXT TRADING DAY" — a GTC order here resumes and
  // can fill tomorrow. Treating it as final is the classic reconciliation bug,
  // and this module had it wrong for an hour.
  "done_for_day",
  // `held` is in Alpaca's enum with ZERO documentation. Deliberately parked
  // here as open rather than assigned a meaning we cannot cite.
]));

/** States that will never change again. */
// Only these four carry the docs' phrase "no further updates will occur".
// `replaced` is added because the order id itself is finished — but it has a
// successor in `replaced_by`, so a caller reconciling a replaced order must
// follow the child rather than assume the position never happened.
export const TERMINAL_STATUSES = Object.freeze(new Set([
  "filled", "canceled", "cancelled", "expired", "rejected", "replaced",
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
 *   outcome: "filled"|"partial"|"open"|"dead"|"replaced"|"unknown",
 *   filledAt: string|null,    // broker fill time — NOT reconciliation time
 *   replacedBy: string|null,  // successor order id, when outcome is "replaced"
 * }}
 */
export function readFill(order) {
  if (!order || typeof order !== "object") {
    // Unknown is NOT the same as dead. A network blip must leave the row alone
    // rather than resolve it to a state the broker never reported.
    return { known: false, terminal: false, filledQty: 0, avgPrice: null, status: null, outcome: "unknown" };
  }
  const status = String(order.status || "").toLowerCase() || null;
  const replacedBy = order.replaced_by ? String(order.replaced_by) : null;
  // Codex: realized P&L orders by executed_at. Stamping reconciliation time
  // reorders history whenever a pass runs late — a Friday fill reconciled on
  // Monday would sort after Monday's trades.
  const filledAt = order.filled_at ? String(order.filled_at) : null;
  const filledQty = num(order.filled_qty);
  const avgRaw = Number(order.filled_avg_price);
  const avgPrice = Number.isFinite(avgRaw) && avgRaw > 0 ? avgRaw : null;

  const terminal = status !== null && TERMINAL_STATUSES.has(status);
  const open = status !== null && OPEN_STATUSES.has(status);

  let outcome;
  if (status === null) outcome = "unknown";
  // `replaced` before the terminal test: this order id is finished, but the
  // ORDER may live on under replaced_by. Collapsing it into "dead" would
  // discard a position whose successor filled.
  else if (status === "replaced") outcome = "replaced";
  else if (filledQty > 0 && terminal) outcome = "filled";
  else if (filledQty > 0) outcome = "partial";           // open and partly done
  else if (terminal) outcome = "dead";                    // terminal, nothing filled
  else if (open) outcome = "open";
  else outcome = "unknown";                               // a status we do not model

  return { known: status !== null, terminal, filledQty, avgPrice, status, outcome, replacedBy, filledAt };
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
      return {
        status: "executed", qty: fill.filledQty,
        ...(fill.avgPrice ? { suggested_price: fill.avgPrice } : {}),
        ...(fill.filledAt ? { executed_at: fill.filledAt } : {}),
      };
    case "dead":
      // Terminal with nothing filled: canceled, expired, rejected. It never
      // became a position and must not count as one.
      return { status: "rejected", qty: 0 };
    case "replaced":
      // Deliberately no verdict. The row must neither claim the position (the
      // successor may not have filled) nor discard it (it may have). A caller
      // follows `replacedBy` and reconciles the child; until then, silence is
      // the only honest answer. We never call Alpaca's replace endpoint, so
      // this arrives only via a corporate action — rare, and exactly the kind
      // of rare thing that corrupts a ledger quietly.
      return null;
    case "partial":
      // No verdict. I briefly wrote these as `submitted` with the filled
      // quantity, to stop the book understating a part-filled position. Codex
      // caught why that is worse than the problem: every reader filters
      // status = "executed", so it changed nothing visible, AND it made `qty`
      // mean "intended" on one submitted row and "filled so far" on another.
      // One column, two meanings, decided by reconciliation history.
      //
      // So: a `submitted` row's qty is ALWAYS the intent, readers ignore
      // submitted entirely, and only `executed` carries broker truth. One
      // meaning per state. Recording partials properly needs its own
      // filled_qty column, which is a migration and a separate decision.
      return null;
    case "open":
    case "unknown":
    default:
      return null;   // nothing has happened, or we do not know — leave it alone
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
  // Shares that have actually changed hands, terminal or not. A partial fill
  // on a still-open order is a real position; the order simply is not finished.
  return fill.filledQty;
}
