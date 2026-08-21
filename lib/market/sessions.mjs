/**
 * The US equity market clock — ONE definition, shared by everything.
 *
 * This module exists because "is the market open" stopped being a yes/no the
 * moment extended-hours trading entered the picture. The old `usMarketStatus`
 * answered `{ open, reason }` and folded pre-market and after-hours into
 * "closed", which is correct for a market order and wrong for a limit order in
 * a session where limit orders are exactly what Alpaca accepts.
 *
 * Rather than add a second, subtly-different clock next to the first — the
 * failure this codebase has paid for repeatedly (two net-worth series, two
 * Sharia verdicts) — `usMarketStatus` is now a thin wrapper over `marketSession`
 * and keeps its old contract byte-for-byte, so the bot cron and the SnapTrade
 * execution gate are untouched.
 *
 * SESSIONS (America/New_York), per Alpaca's order documentation:
 *   pre      04:00 – 09:30   limit orders only
 *   regular  09:30 – 16:00   any order type
 *   after    16:00 – 20:00   limit orders only
 *
 * Alpaca also runs an OVERNIGHT session (20:00–04:00). It is deliberately NOT
 * modelled here and reports `closed`. Overnight liquidity is thinner again than
 * after-hours, and the owner asked for "before and after hour" trading — adding
 * a session nobody requested, in the thinnest book of the day, is not a default
 * a finance app should pick on a user's behalf. Add it explicitly if wanted.
 */

// Update each year, or replace with Alpaca's /v2/clock once keys are set (it is
// authoritative and includes half-days, which this set deliberately does not —
// on an early close the 13:00–16:00 window still reads regular and a late order
// takes a harmless broker reject).
export const MARKET_HOLIDAYS = new Set([
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19",
  "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15",
]);

const MIN = (h, m = 0) => h * 60 + m;
export const SESSION_BOUNDS = {
  preOpen:      MIN(4, 0),
  regularOpen:  MIN(9, 30),
  regularClose: MIN(16, 0),
  afterClose:   MIN(20, 0),
};

/** Wall-clock parts in America/New_York, robust to the ICU "24" midnight quirk. */
function etParts(now) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(now).reduce((o, x) => (o[x.type] = x.value, o), {});
  let hour = parseInt(p.hour, 10);
  if (hour === 24) hour = 0;
  return {
    dateKey: `${p.year}-${p.month}-${p.day}`,
    weekday: p.weekday,
    minutes: hour * 60 + parseInt(p.minute, 10),
  };
}

/**
 * The current session.
 *
 * Returns:
 *   session       "pre" | "regular" | "after" | "closed"
 *   tradeable     can an order be accepted right now at all
 *   extendedHours must the order carry Alpaca's extended_hours flag
 *   requiresLimit must the order be a LIMIT order (Alpaca rejects everything
 *                 else outside regular hours — this is a broker rule, not a
 *                 house preference, so callers must not "helpfully" relax it)
 *   reason        stable machine string, kept compatible with the old contract
 */
export function marketSession(now = new Date(), holidays = MARKET_HOLIDAYS) {
  const { dateKey, weekday, minutes } = etParts(now);

  if (weekday === "Sat" || weekday === "Sun") {
    return build("closed", "weekend");
  }
  if (holidays.has(dateKey)) {
    return build("closed", "holiday");
  }
  const { preOpen, regularOpen, regularClose, afterClose } = SESSION_BOUNDS;
  if (minutes < preOpen)      return build("closed",  "overnight");
  if (minutes < regularOpen)  return build("pre",     "pre_market");
  if (minutes < regularClose) return build("regular", "open");
  if (minutes < afterClose)   return build("after",   "after_hours");
  return build("closed", "overnight");
}

function build(session, reason) {
  const extended = session === "pre" || session === "after";
  return {
    session,
    reason,
    tradeable:     session !== "closed",
    extendedHours: extended,
    requiresLimit: extended,
    label:         LABELS[session],
  };
}

const LABELS = {
  pre:     "Pre-market",
  regular: "Open",
  after:   "After-hours",
  closed:  "Closed",
};

/**
 * Back-compatible view for callers that only trade during regular hours.
 *
 * Contract preserved EXACTLY: `{ open, reason }` where reason is one of
 * weekend | holiday | pre_market | after_hours | open. The SnapTrade execution
 * gate and the bot cron both depend on this being unchanged — a market order
 * must still be refused in pre/after, because Alpaca and every real broker
 * reject it. `overnight` is a new reason value, but it only ever appears with
 * open:false, and both call sites branch on `.open` and log `.reason`.
 */
export function usMarketStatus(now = new Date(), holidays = MARKET_HOLIDAYS) {
  const s = marketSession(now, holidays);
  return { open: s.session === "regular", reason: s.reason };
}

/**
 * Validate an order against the session, returning a normalized shape or an
 * explicit refusal. Pure, so the rule is testable without touching a broker.
 *
 * The rules are Alpaca's, confirmed against their order documentation:
 *  - extended hours accepts LIMIT only; anything else is rejected outright
 *  - time_in_force must be `day` or `gtc` for an extended-hours order
 *  - a market order placed outside regular hours is not rejected by Alpaca so
 *    much as QUEUED to the next session, which is worse than a refusal: the
 *    user believes they traded, and they fill at an unknown price hours later.
 *    Mizan refuses it instead, and says why.
 */
export function validateSessionOrder({ type, timeInForce = "day", limitPrice = null }, now = new Date(), holidays = MARKET_HOLIDAYS) {
  const s = marketSession(now, holidays);

  if (!s.tradeable) {
    return { ok: false, code: "market_closed", session: s, error: `Market is closed (${s.reason}).` };
  }
  if (!s.extendedHours) {
    return { ok: true, session: s, extendedHours: false, timeInForce };
  }
  if (type !== "limit") {
    return {
      ok: false, code: "limit_required", session: s,
      error: `${s.label} accepts limit orders only. A market order would be queued to the next session and filled at a price you have not seen.`,
    };
  }
  if (!(Number(limitPrice) > 0)) {
    return { ok: false, code: "limit_price_required", session: s, error: "A limit price is required outside regular hours." };
  }
  if (timeInForce !== "day" && timeInForce !== "gtc") {
    return { ok: false, code: "bad_tif", session: s, error: "Extended-hours orders must use a day or GTC time-in-force." };
  }
  return { ok: true, session: s, extendedHours: true, timeInForce };
}
