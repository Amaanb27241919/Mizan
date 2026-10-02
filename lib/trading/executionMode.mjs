/**
 * The execution-mode ladder, named. Pure — no I/O, no clock, no DB.
 *
 * The Trade Lab proposal (§13) asks for one global state variable across
 * READ_ONLY / SHADOW / PAPER / LIVE_CONFIRM / LIVE_AUTO / HALTED. Most of that
 * ladder ALREADY EXISTS in this codebase under other names — it was simply
 * never named, so nothing could assert on it:
 *
 *   LIVE_AUTO     mode='full' + the user's full-auto allowlist + per-account opt-in
 *   LIVE_CONFIRM  layer='semi' — the signal waits for a human to approve it
 *   PAPER         params.broker = 'alpaca_paper'  (ORTHOGONAL to the layer)
 *   HALTED        enabled=false, or the global kill switch
 *   READ_ONLY     no enabled strategies at all
 *   SHADOW        did not exist
 *
 * So this module does not invent a new state machine on top of a working one.
 * It names what is there, and adds the single genuinely missing rung.
 *
 * ── WHY SHADOW MATTERS ────────────────────────────────────────────────────
 * It is the mode the AI research work needs before it can exist safely: a
 * strategy that PROPOSES and can never execute, by any path, so a model's
 * output can be recorded and scored for months without a broker ever being
 * reachable. §17 is explicit that a forward record is the only valid evidence,
 * and you cannot build that record if the only way to generate signals is to
 * also be able to trade them.
 *
 * `canExecute` is the whole point: one predicate, used by every execution
 * path, that cannot be talked out of a refusal. The AI never decides it —
 * §25 requires that execution modes cannot be changed by a model.
 */

export const MODES = Object.freeze({
  READ_ONLY:    "READ_ONLY",
  SHADOW:       "SHADOW",
  PAPER:        "PAPER",
  LIVE_CONFIRM: "LIVE_CONFIRM",
  LIVE_AUTO:    "LIVE_AUTO",
  HALTED:       "HALTED",
});

/** Layers a strategy may declare in params.layer. */
export const LAYERS = Object.freeze(["shadow", "manual", "semi", "full"]);

/**
 * What mode is this strategy actually operating in right now?
 *
 * Order matters, and it is deliberately most-restrictive-first. A halted
 * strategy is halted even if it also says `full`; a shadow strategy is shadow
 * even if full-auto is armed for the account. A permission can only ever
 * NARROW what happens, never widen it.
 */
export function resolveMode(strategy, opts) {
  const { fullAutoAllowed = false, globalHalt = false } = opts || {};
  if (globalHalt) return MODES.HALTED;
  // Array.isArray, because `typeof [] === "object"` — an array fell straight
  // through this guard and resolved to LIVE_CONFIRM, an EXECUTING mode. Caught
  // by this module's own garbage test. Eighth time this codebase has been bitten
  // by a truthy non-object passing a typeof check.
  if (!strategy || typeof strategy !== "object" || Array.isArray(strategy)) return MODES.READ_ONLY;
  // Affirmatively enabled, not merely "not disabled". A malformed row with no
  // `enabled` field must not inherit permission to trade — fail closed.
  if (strategy.enabled !== true) return MODES.HALTED;

  const layer = resolveLayer(strategy);
  if (layer === "shadow") return MODES.SHADOW;
  if (layer === "manual") return MODES.READ_ONLY;   // proposes nothing on its own

  const paper = strategy?.params?.broker === "alpaca_paper";

  // Full-auto needs BOTH the strategy's own declaration and the external
  // permission. Either alone is a confirm-first strategy.
  if (layer === "full" && strategy.mode === "full" && fullAutoAllowed) {
    return paper ? MODES.PAPER : MODES.LIVE_AUTO;
  }
  // Paper is its own rung: it executes without a human, but no real money is
  // reachable, so it is not LIVE_AUTO and should not be described as such.
  if (paper) return MODES.PAPER;
  return MODES.LIVE_CONFIRM;
}

/** The declared layer, falling back to the legacy `mode` column. */
export function resolveLayer(strategy) {
  const raw = strategy?.params?.layer;
  if (LAYERS.includes(raw)) return raw;
  return strategy?.mode === "full" ? "full" : "semi";
}

/**
 * May an order actually reach a broker in this mode?
 *
 * The single predicate every execution path consults. SHADOW, READ_ONLY and
 * HALTED all return false — a shadow strategy's signal must be unexecutable by
 * the cron, by the approval endpoint, and by anything written later that
 * forgets this module exists. That last case is why the refusal lives in one
 * named function rather than as an `if` in each branch.
 */
export function canExecute(mode) {
  return mode === MODES.PAPER || mode === MODES.LIVE_CONFIRM || mode === MODES.LIVE_AUTO;
}

/** May this mode place an order WITHOUT a human approving it first? */
export function isAutonomous(mode) {
  return mode === MODES.PAPER || mode === MODES.LIVE_AUTO;
}

/** Does real money move in this mode? Used for the louder confirmations. */
export function isRealMoney(mode) {
  return mode === MODES.LIVE_CONFIRM || mode === MODES.LIVE_AUTO;
}

/** Why a mode refused, in words a user and a log can both use. */
export function refusalReason(mode) {
  switch (mode) {
    case MODES.SHADOW:
      return "shadow_mode: this strategy records what it would have done and can never place an order";
    case MODES.HALTED:
      return "halted: the strategy is disabled or trading is globally halted";
    case MODES.READ_ONLY:
      return "read_only: this strategy does not execute on its own";
    default:
      return null;   // not a refusal
  }
}
