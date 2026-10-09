/**
 * Pure (no I/O): which tickers a strategy may BUY, and which holdings it must
 * SELL, under its Sharia screening standard.
 *
 * Owner decision 2026-10-07: every strategy screens against AAOIFI. Until then
 * the rank strategies trusted the SPUS constituent list and screened nothing,
 * while the AI gate read the server's CROSS-STANDARD VOTE (halal at >=5 of 7
 * standards, haram at >=4 fails) — so STX, CRWD and FTNT, which pass AAOIFI and
 * S&P Shariah, were dropped from one strategy and held by the others.
 *
 * The verdict rule itself is statusForStandard (src/lib/shariaVerdict.js), the
 * same function the app's surfaces use, so a strategy can never trade on a
 * different definition of "halal" than the one the user is shown.
 */
import { statusForStandard } from "../../src/lib/shariaVerdict.js";

/**
 * Sharia-screened funds. They hold a basket, not a balance sheet, so the ratio
 * engine has nothing to evaluate and returns "review" — which would wrongly
 * block the very funds a halal portfolio is built from. Eligible by
 * construction; every one is itself screened by its issuer.
 */
export const HALAL_FUNDS = Object.freeze(new Set(["SPUS", "HLAL", "UMMA", "SPSK", "SPWO", "SPTE", "SPRE"]));

/**
 * @returns {"eligible"|"blocked"|"unverified"}
 *   eligible   — passes the standard (or is a halal fund)
 *   blocked    — fails it, or was evaluated and could not be confirmed
 *   unverified — the screen did not complete (throttled, pending, missing);
 *                retry, never trade on it
 */
export function tradeEligibility(verdict, ticker, opts) {
  const standard = opts?.standard || "AAOIFI";
  if (HALAL_FUNDS.has(String(ticker || "").toUpperCase())) return "eligible";
  if (!verdict || typeof verdict !== "object") return "unverified";
  const st = statusForStandard(verdict, standard);
  if (st === "halal") return "eligible";
  if (st === "haram" || st === "review") return "blocked";
  return "unverified";
}

/**
 * Turn screen verdicts into plan inputs.
 * - Buy candidates that are not eligible are excluded.
 * - A holding is SOLD only when it is screened and FAILS the standard — a
 *   data gap is never a reason to sell.
 * - While a buy candidate is unverified the rebalance should WAIT (the screen
 *   fills in over later ticks); past the cutoff it is excluded instead, so a
 *   chronically unscreenable name can neither freeze the book nor be bought.
 */
export function screenPlanInputs(input) {
  const { candidates, held, verdicts, standard = "AAOIFI", pastCutoff = false } = input || {};
  const arr = (x) => (Array.isArray(x) ? x : []);
  const v = verdicts && typeof verdicts === "object" ? verdicts : {};
  const excludeBuys = [], forceSells = [], unverified = [];
  for (const raw of arr(candidates)) {
    const tk = String(raw).toUpperCase();
    const e = tradeEligibility(v[tk], tk, { standard });
    if (e === "blocked") excludeBuys.push(tk);
    else if (e === "unverified") { unverified.push(tk); if (pastCutoff) excludeBuys.push(tk); }
  }
  for (const raw of arr(held)) {
    const tk = String(raw).toUpperCase();
    if (HALAL_FUNDS.has(tk)) continue;
    const vv = v[tk];
    if (vv && statusForStandard(vv, standard) === "haram") forceSells.push(tk);
  }
  return { excludeBuys, forceSells, unverified, waiting: !pastCutoff && unverified.length > 0 };
}

/**
 * Hand orders (owner decision 2026-10-09): held to the same AAOIFI rule as the
 * strategies. Before this, the order path refused only a fixed blocklist, so a
 * hand BUY of a name failing AAOIFI went through.
 *  - A buy must be eligible (tradeEligibility above; halal funds pass by
 *    construction).
 *  - A buy that cannot be screened right now is refused with "try again" —
 *    never placed on an assumption, the same as a strategy's unverified name.
 *  - A sell is always allowed: leaving a position is never blocked, and
 *    selling a failing holding is exactly what the screen asks for.
 * @returns {{ok:true}|{ok:false, code:"sharia_failed"|"sharia_unverified", status:403|503, error:string}}
 */
export function handOrderGate(input) {
  const { side, ticker, verdict, standard = "AAOIFI" } = input || {};
  const tk = String(ticker || "").toUpperCase();
  if (side === "sell") return { ok: true };
  const e = tradeEligibility(verdict, tk, { standard });
  if (e === "eligible") return { ok: true };
  if (e === "blocked") return { ok: false, code: "sharia_failed", status: 403,
    error: `${tk} does not pass the ${standard} Sharia screen, so it can't be bought here.` };
  return { ok: false, code: "sharia_unverified", status: 503,
    error: `${tk} couldn't be screened right now, so it can't be bought yet. Try again in a minute.` };
}
