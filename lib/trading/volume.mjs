/**
 * Pure (no I/O): relative volume — "is this stock trading on unusual volume
 * today?" — for the volume-confirmed swing entry (Experiment E · swing).
 *
 * Today's partial volume is compared with the SAME SHARE of an average day,
 * because at 10:30 a stock has naturally traded a fraction of its daily
 * volume. The share is linear in time, which slightly flatters the first hour
 * (volume is U-shaped); requiring 30 visible minutes keeps that bounded.
 *
 * Feed it SIP daily bars (fetchAlpacaBars' default). IEX is a median 4.4% of
 * real volume and varies 0.07–21% by symbol, so an IEX ratio would reorder
 * candidates by feed coverage, not by interest. Recent SIP is embargoed 15
 * minutes, which sessionFraction subtracts.
 */
const SESSION_MIN = 390, EMBARGO_MIN = 15, MIN_VISIBLE_MIN = 30;

const NY_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const nyDay = (t) => { const ms = Date.parse(t); return Number.isFinite(ms) ? NY_DAY.format(new Date(ms)) : null; };

/** Fraction of a regular session visible in the data, or null if too early to judge. */
export function sessionFraction(minutesSinceOpen) {
  const m = Number(minutesSinceOpen);
  if (minutesSinceOpen === null || minutesSinceOpen === undefined || !Number.isFinite(m)) return null;
  const visible = Math.min(SESSION_MIN, m - EMBARGO_MIN);
  return visible < MIN_VISIBLE_MIN ? null : visible / SESSION_MIN;
}

/**
 * today's volume ÷ (average of the previous `lookback` days × session fraction).
 * null when there is no bar for today, fewer than `lookback` prior days, or
 * too little of the session — callers must treat null as "unconfirmed".
 */
export function relativeVolume(input) {
  const { bars, today, minutesSinceOpen, lookback = 20 } = input || {};
  if (!Array.isArray(bars) || !today) return null;
  const frac = sessionFraction(minutesSinceOpen);
  if (frac === null) return null;
  const rows = bars.filter((b) => b && Number(b.v) >= 0 && nyDay(b.t));
  const todayBar = rows.find((b) => nyDay(b.t) === today);
  const prior = rows.filter((b) => nyDay(b.t) < today).slice(-lookback);
  if (!todayBar || prior.length < lookback) return null;
  const avg = prior.reduce((t, b) => t + Number(b.v), 0) / prior.length;
  if (!(avg > 0)) return null;
  return Number(todayBar.v) / (avg * frac);
}
