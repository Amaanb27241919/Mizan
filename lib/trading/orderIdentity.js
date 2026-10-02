/**
 * Order identity and protective-stop shaping. Pure — no I/O, no clock.
 *
 * Two Tier-1 safety concerns that are really one idea: an order placed twice is
 * a different order than the one intended, and a position with no stop is a
 * different trade than the one intended.
 *
 * ── IDEMPOTENCY ───────────────────────────────────────────────────────────
 * `placeAlpacaOrder` goes through fetchWithRetry, which retries on failure.
 * A request that TIMES OUT may already have reached the broker, so the retry
 * places a second order: $500 becomes $1,000. SnapTrade has no broker-level
 * idempotency key at all, and Alpaca only has one if you supply it.
 *
 * Verified live on the paper account 2026-10-02: posting the same
 * `client_order_id` twice returns `422 client_order_id must be unique`. So a
 * DETERMINISTIC id derived from the signal turns a double-submit from a
 * duplicate position into a harmless rejection. The id must depend only on
 * things that are stable across a retry — never on a clock or a random value,
 * because then the retry computes a different id and the protection evaporates.
 *
 * ── PROTECTIVE STOPS ──────────────────────────────────────────────────────
 * Also measured live, and it contradicted the obvious design:
 *
 *   whole qty  + stop        + GTC   ACCEPTED
 *   whole qty  + bracket/OTO         ACCEPTED
 *   fractional + stop        + DAY   ACCEPTED
 *   fractional + stop        + GTC   REJECTED "not enabled"
 *   fractional + trailing_stop       REJECTED
 *   notional   + bracket/OTO         REJECTED "must be simple orders"
 *
 * The strategy buys NOTIONAL, which produces fractional positions. So a stop
 * cannot ride along with the entry, and a fractional stop cannot be GTC — it
 * must be a separate DAY order, re-armed every session. That is why
 * `stopOrderFor` exists and why `needsRearm` is part of this module.
 */

/**
 * The price a protective stop is measured from.
 *
 * A fractional position cannot use Alpaca's native trailing_stop (rejected:
 * "fractional orders must be market, limit, stop, or stop_limit"), so a trail
 * has to be emulated by re-arming a DAY stop each session. That emulation has
 * one rule it must never break:
 *
 *   A PROTECTIVE STOP MUST NEVER MOVE DOWN.
 *
 * Re-arming naively from the current price would lower the stop every time the
 * price fell — widening the loss on exactly the day protection matters, which
 * is the precise opposite of a stop. So the reference ratchets: it is the
 * highest of the entry price, the current price, and any prior high-water mark,
 * and never anything less.
 */
export function stopReference({ entryPrice = null, currentPrice = null, priorHighWater = null } = {}) {
  const cands = [entryPrice, currentPrice, priorHighWater]
    .map(Number)
    .filter((v) => Number.isFinite(v) && v > 0);
  if (!cands.length) return null;
  return Math.max(...cands);
}

/** Alpaca's own limit; ours stay far shorter than this. */
export const MAX_CLIENT_ORDER_ID = 128;

/**
 * A stable id for the order belonging to one signal.
 *
 * Deterministic by construction: same signal in, same id out, forever. An
 * `attempt` is available for the rare case where a DELIBERATE re-placement is
 * wanted (a cancelled order being re-sent), because reusing the id would then
 * be rejected — but it defaults to 0 so the safe path is the default path.
 */
export function clientOrderId(signalId, { prefix = "mz", attempt = 0 } = {}) {
  const raw = String(signalId ?? "").trim();
  if (!raw) return null;                       // no signal, no idempotency key
  // Alpaca accepts a broad charset, but punctuation varies by broker; keep it
  // to the intersection that every venue tolerates.
  const safe = raw.replace(/[^A-Za-z0-9-]/g, "").slice(0, 64);
  if (!safe) return null;
  const n = Number(attempt);
  const suffix = Number.isFinite(n) && n > 0 ? `-r${Math.floor(n)}` : "";
  return `${prefix}-${safe}${suffix}`.slice(0, MAX_CLIENT_ORDER_ID);
}

/** Is this quantity fractional? Decides tif and whether a stop can be GTC. */
export function isFractional(qty) {
  const n = Number(qty);
  if (!Number.isFinite(n)) return false;
  return Math.abs(n - Math.round(n)) > 1e-9;
}

/**
 * The protective sell-stop for a position, or a refusal.
 *
 * `stopPct` is how far BELOW the reference price the stop sits, as a positive
 * percent — 5 means "sell if it falls 5%".
 *
 * Returns { ok:false, code } rather than a half-formed order whenever the
 * broker would reject it or the maths cannot be trusted. Silently reshaping an
 * order here is how a 5% stop becomes something else.
 */
export function stopOrderFor({ symbol, qty, referencePrice, stopPct = 5, limitOffsetPct = null, livePrice = null } = {}) {
  const sym = String(symbol || "").trim().toUpperCase();
  if (!sym) return { ok: false, code: "no_symbol" };

  const q = Number(qty);
  if (!Number.isFinite(q) || q <= 0) return { ok: false, code: "no_qty" };

  const px = Number(referencePrice);
  if (!Number.isFinite(px) || px <= 0) return { ok: false, code: "no_price" };

  const pct = Number(stopPct);
  if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) return { ok: false, code: "bad_stop_pct" };

  const stopPrice = round2(px * (1 - pct / 100));
  if (!(stopPrice > 0)) return { ok: false, code: "bad_stop_price" };

  // A stop at or above the live price triggers the instant it is accepted,
  // turning "protect me if it falls 5%" into "sell at market right now". That
  // happens whenever the reference is a high-water mark and the price has
  // already fallen past the trail — the position is ALREADY below its stop, and
  // the honest answer is to refuse and let a human look, not to dump it on a
  // possibly-stale quote. Callers treat this as a signal, not an error.
  const live = Number(livePrice);
  if (Number.isFinite(live) && live > 0 && stopPrice >= live) {
    return { ok: false, code: "would_trigger_immediately", stopPrice, livePrice: live };
  }

  const fractional = isFractional(q);
  const order = {
    symbol: sym,
    // The EXACT held quantity. Rounding 15.977489415 to 15.9775 is rejected
    // with "insufficient qty available" — measured, not guessed.
    qty: String(q),
    side: "sell",
    type: "stop",
    stop_price: String(stopPrice),
    // Fractional stops cannot be GTC ("not enabled"), so they are DAY and must
    // be re-armed each session. Whole-share stops may rest as GTC.
    time_in_force: fractional ? "day" : "gtc",
  };

  if (limitOffsetPct !== null && limitOffsetPct !== undefined) {
    const off = Number(limitOffsetPct);
    if (!Number.isFinite(off) || off < 0 || off >= 100) return { ok: false, code: "bad_limit_offset" };
    const limitPrice = round2(stopPrice * (1 - off / 100));
    if (!(limitPrice > 0)) return { ok: false, code: "bad_limit_price" };
    order.type = "stop_limit";
    order.limit_price = String(limitPrice);
  }

  return { ok: true, order, fractional, rearmDaily: fractional, stopPrice };
}

/**
 * Which held positions still need a protective stop.
 *
 * `openStops` is whatever sell-stops already rest at the broker. A position is
 * covered only when the resting stop covers the WHOLE quantity — a stop on 15
 * of 15.977 shares leaves a sliver unprotected, and reporting that as covered
 * would be the kind of comfortable lie this module exists to avoid.
 */
export function needsRearm(positions, openStops, { tolerance = 1e-6 } = {}) {
  const pos = Array.isArray(positions) ? positions : [];
  const stops = Array.isArray(openStops) ? openStops : [];

  const covered = new Map();
  for (const s of stops) {
    if (!s || String(s.side || "").toLowerCase() !== "sell") continue;
    const t = String(s.type || "").toLowerCase();
    if (t !== "stop" && t !== "stop_limit" && t !== "trailing_stop") continue;
    const sym = String(s.symbol || "").toUpperCase();
    const q = Number(s.qty);
    if (!sym || !Number.isFinite(q)) continue;
    covered.set(sym, (covered.get(sym) || 0) + q);
  }

  const out = [];
  for (const p of pos) {
    if (!p) continue;
    const sym = String(p.symbol || "").toUpperCase();
    const held = Number(p.qty);
    if (!sym || !Number.isFinite(held) || held <= 0) continue;   // shorts are out of scope
    const have = covered.get(sym) || 0;
    if (have + tolerance < held) out.push({ symbol: sym, qty: held, covered: have, gap: held - have });
  }
  return out;
}

/** Cents. Brokers reject sub-cent prices on equities above $1. */
function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}
