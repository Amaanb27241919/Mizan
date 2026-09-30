/**
 * Which broker executes a strategy's orders — the seam the engine never had.
 *
 * Until now `placeAlpacaOrder` had exactly one caller: the manual Order Ticket.
 * Every automated path — DCA, momentum buy, momentum sell, signal approval —
 * called `executeSnapTradeOrder`, which is LIVE money at a real broker. A
 * strategy therefore could not be forward-tested on paper at all, which is the
 * evidence Trade Lab §17 makes the only valid proof that research adds value.
 * See docs/TRADE_PIPELINE.md.
 *
 * This is the minimal form of the §15 broker adapter: pure routing, capability
 * rules and result normalization. The dispatch itself stays in handlers.mjs
 * where both executors and their credentials already live, so nothing about
 * how an order is actually placed moves in this change.
 *
 * TWO SAFETY PROPERTIES, both deliberate:
 *
 * 1. ABSENT MEANS SNAPTRADE. Every existing strategy row has no `params.broker`,
 *    and must keep executing exactly as it does today. Absent → snaptrade.
 *
 * 2. PRESENT-BUT-UNKNOWN IS AN ERROR, NOT A DEFAULT. A typo like "alpaca" must
 *    not silently resolve anywhere. Defaulting it to snaptrade would route a
 *    strategy someone intended as paper onto live money; defaulting it to paper
 *    would silently stop a funded live strategy trading. Neither is a guess
 *    worth making, so an unrecognized value refuses and says what it saw.
 */

export const BROKERS = Object.freeze({
  SNAPTRADE:    "snaptrade",
  ALPACA_PAPER: "alpaca_paper",
});

/**
 * What each venue can actually do. SnapTrade's trade-enabled brokers are
 * whole-shares-only in practice — E*TRADE rejects a fractional order with
 * "Units to purchase should be whole units" — so a notional intent must be
 * refused here rather than truncated into a different order than was asked for.
 */
export const BROKER_CAPABILITIES = Object.freeze({
  [BROKERS.SNAPTRADE]:    Object.freeze({ notional: false, fractional: false, paper: false }),
  [BROKERS.ALPACA_PAPER]: Object.freeze({ notional: true,  fractional: true,  paper: true  }),
});

const isWhole = (n) => Number.isFinite(n) && Math.floor(n) === n;

/**
 * @returns {{ok:true, broker:string, paper:boolean} | {ok:false, error:string, code:string}}
 */
/**
 * Paper routing is built but NOT YET SAFE TO ENABLE, and this is why.
 *
 * `pending_signals` (migration 020) has no broker, paper or order_id column,
 * and position tracking plus realized P&L select purely on
 * `status = "executed"` (handlers.mjs ~1755, ~1789). A paper fill would
 * therefore be counted as a real position, at a real average entry, in a real
 * strategy's P&L — silently corrupting the record of a funded live strategy.
 *
 * Found by Codex on the first independent review of this seam. Distinguishing
 * them needs columns on pending_signals, which is a schema migration and needs
 * an explicit owner ask (CLAUDE.md §8). Until that lands, routing refuses the
 * paper venue rather than producing a ledger that cannot be trusted.
 *
 * Flip this to true in the same commit as the migration, not before.
 */
export const PAPER_ROUTING_ENABLED = false;

export function resolveBroker(strategy) {
  const raw = strategy?.params?.broker;
  if (raw === undefined || raw === null || raw === "") {
    return { ok: true, broker: BROKERS.SNAPTRADE, paper: false };
  }
  if (raw === BROKERS.ALPACA_PAPER && !PAPER_ROUTING_ENABLED) {
    return {
      ok: false, code: "paper_routing_disabled",
      error: "Paper routing is disabled: pending_signals cannot distinguish a paper fill from a live one, so a paper trade would be counted in a real strategy's positions and P&L.",
    };
  }
  if (raw === BROKERS.SNAPTRADE || raw === BROKERS.ALPACA_PAPER) {
    return { ok: true, broker: raw, paper: BROKER_CAPABILITIES[raw].paper };
  }
  return { ok: false, code: "unknown_broker", error: `unknown broker "${raw}" — expected ${BROKERS.SNAPTRADE} or ${BROKERS.ALPACA_PAPER}` };
}

/**
 * Can this venue place this order? Refuses rather than reshaping: an order
 * quietly converted from $50 notional into 0 whole shares is a silent no-trade,
 * and one converted into 1 whole share is a different order than was intended.
 */
export function validateIntent({ broker, qty = null, notional = null } = {}) {
  const caps = BROKER_CAPABILITIES[broker];
  if (!caps) return { ok: false, code: "unknown_broker", error: `unknown broker "${broker}"` };

  const n = notional === null || notional === undefined || notional === "" ? null : Number(notional);
  const q = qty === null || qty === undefined || qty === "" ? null : Number(qty);

  if (n !== null && q !== null) return { ok: false, code: "qty_and_notional", error: "Pass either qty or notional, not both." };
  if (n === null && q === null) return { ok: false, code: "no_size", error: "qty or notional is required." };

  if (n !== null && !caps.notional) {
    return { ok: false, code: "notional_unsupported", error: `${broker} cannot place notional orders — it is whole-shares only.` };
  }
  if (q !== null && !isWhole(q) && !caps.fractional) {
    return { ok: false, code: "fractional_unsupported", error: `${broker} cannot place fractional quantities — it is whole-shares only.` };
  }
  return { ok: true };
}

/**
 * One result shape from two executors that answer differently. SnapTrade
 * returns `tradeId`, Alpaca returns `json.id`; both carry `ok`/`status`/`error`.
 * Callers should read THIS, so a third venue later does not require touching
 * every branch that inspects an order result.
 */
export function normalizeResult(broker, raw) {
  const r = raw || {};
  const orderId = r.orderId || r.tradeId || r.json?.id || null;
  if (r.ok) return { ok: true, broker, orderId, status: r.status ?? 200, paper: !!BROKER_CAPABILITIES[broker]?.paper };
  return {
    ok: false, broker, orderId,
    status: r.status ?? 500,
    code: r.code || (r.sharia_blocked ? "sharia_blocked" : r.market_closed ? "market_closed" : null),
    error: r.error || "execution_failed",
    paper: !!BROKER_CAPABILITIES[broker]?.paper,
  };
}
