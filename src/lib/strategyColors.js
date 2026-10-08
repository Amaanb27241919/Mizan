/**
 * Pure: one identity colour per strategy (owner request, 2026-10-08).
 *
 * Eight categorical hues in a FIXED order — the dataviz reference palette's
 * dark steps, validated against the cockpit surface #16213a (all six checks
 * pass; worst adjacent CVD ΔE 8.4, normal-vision 19.3). Colour follows the
 * ENTITY, never its rank or position in a list: A is always blue, whatever
 * else is on screen. A ninth strategy is never a generated hue — it is
 * neutral (null → the caller's muted ink).
 *
 * The owner chose one colour each over a family scheme knowing some hues
 * resemble gain/loss/warning. So a strategy colour is IDENTITY ONLY: it goes
 * on a chip edge, an allocation segment or a card's accent bar — never on a
 * number or its text, which keep gain/loss/neutral ink.
 */
import { strategyLabel } from "./deskBlotter.js";

export const STRATEGY_PALETTE = Object.freeze({
  A: "#3987e5",   // blue
  B: "#d95926",   // orange
  C: "#199e70",   // aqua
  D: "#c98500",   // yellow
  E: "#d55181",   // magenta — both E sleeves (one experiment)
  F: "#008300",   // green
  LV: "#9085e9",  // violet — the live control strategy
  SH: "#e66767",  // red — the shadow research panel
});

/** Which palette slot a strategy owns, or null (neutral). */
export function strategyColorKey(strat) {
  const s = strat && typeof strat === "object" && !Array.isArray(strat) ? strat : null;
  if (!s) return null;
  const p = s.params && typeof s.params === "object" ? s.params : {};
  if (p.layer === "shadow") return "SH";
  const { code } = strategyLabel(s);
  const letter = String(code || "").charAt(0);
  if (letter && STRATEGY_PALETTE[letter]) return letter;
  // The live control: an un-lettered paper rank strategy (97b5b48e).
  if (!code && s.strategy_type === "rank_rebalance" && p.broker === "alpaca_paper") return "LV";
  return null;
}

/** The strategy's identity colour, or null for neutral. */
export function strategyColor(strat) {
  const k = strategyColorKey(strat);
  return k ? STRATEGY_PALETTE[k] : null;
}

/** id → colour, for surfaces that only carry a strategy_id (tape, committee, signals). */
export function strategyColorMap(strategies) {
  const m = new Map();
  for (const s of Array.isArray(strategies) ? strategies : []) {
    if (s && s.id) m.set(String(s.id), strategyColor(s));
  }
  return m;
}
