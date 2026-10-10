/**
 * Pure (no I/O): retrying the orders a rank rebalance could NOT place (BACKLOG F18).
 *
 * A rebalance that places some orders consumes its cadence (last_rebalance =
 * today), so before this the refused ones waited a full cycle — on 2026-10-09
 * E·core placed 1 of 10 buys and would have sat on 9 unbought names for 30
 * days. Re-running the whole rebalance is NOT the fix: a buy still `submitted`
 * (not yet reconciled to `executed`) is invisible to the book, so a re-run
 * could buy it twice. Instead the refused orders themselves are remembered in
 * params.rebalance_retry and only those are retried on later ticks.
 *
 * Bounded on purpose: a refusal that cannot succeed by waiting (a Sharia
 * block, no cash, an unknown symbol) is never retried; each order gets
 * MAX_ATTEMPTS; the whole list expires after EXPIRE_DAYS so a stale order
 * from last week is never sent into a different market.
 */
const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : null);
const fin = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
export const MAX_ATTEMPTS = 6;
export const EXPIRE_DAYS = 3;

/** Waiting cannot fix these, so they are never retried. */
const PERMANENT = /sharia|haram|aaoifi|insufficient|buying power|not (tradable|fractionable|found|active)|invalid|unknown symbol|asset .* not|forbidden|unauthori[sz]ed|trading_not_enabled/i;
export function isRetryableRefusal(error) {
  const e = String(error || "");
  return e.length > 0 && !PERMANENT.test(e);
}

/**
 * The retry list after a rebalance. Only when SOMETHING was placed — a run that
 * placed nothing keeps its cadence and simply re-runs whole on the next tick.
 * refused: [{sym, side, qty, notional, price, error}]
 */
export function recordRefusals(refused, today, placed) {
  if (!(fin(placed) > 0)) return null;
  const orders = arr(refused).filter((r) => obj(r) && r.sym && isRetryableRefusal(r.error))
    .map((r) => ({ sym: String(r.sym).toUpperCase(), side: r.side === "sell" ? "sell" : "buy",
      qty: fin(r.qty), notional: fin(r.notional), price: fin(r.price), attempts: 0, last_error: String(r.error).slice(0, 160) }));
  return orders.length ? { date: String(today), orders } : null;
}

const days = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);

/** What to retry now. `expired` means drop the whole list. */
export function retryDue(state, today) {
  const s = obj(state);
  if (!s || !s.date || !arr(s.orders).length) return { orders: [], expired: true };
  const age = days(s.date, String(today));
  if (!Number.isFinite(age) || age < 0 || age > EXPIRE_DAYS) return { orders: [], expired: true };
  const orders = arr(s.orders).filter((o) => obj(o) && o.sym && (fin(o.attempts) ?? 0) < MAX_ATTEMPTS);
  return { orders, expired: orders.length === 0 };
}

/**
 * The list after a retry pass. outcomes: [{sym, side, ok, error, drop}] —
 * `drop` for an order that must not be retried again (no longer eligible,
 * nothing left to sell). Placed and dropped orders leave; a retryable failure
 * stays with attempts+1; a permanent one leaves.
 */
export function afterRetry(state, outcomes) {
  const s = obj(state);
  if (!s) return null;
  const key = (o) => `${o.side}:${String(o.sym).toUpperCase()}`;
  const byKey = new Map(arr(outcomes).filter(obj).map((o) => [key(o), o]));
  const left = [];
  for (const o of arr(s.orders).filter(obj)) {
    const r = byKey.get(key(o));
    if (!r) { left.push(o); continue; }
    if (r.ok || r.drop || !isRetryableRefusal(r.error)) continue;
    const attempts = (fin(o.attempts) ?? 0) + 1;
    if (attempts < MAX_ATTEMPTS) left.push({ ...o, attempts, last_error: String(r.error || "").slice(0, 160) });
  }
  return left.length ? { ...s, orders: left } : null;
}
