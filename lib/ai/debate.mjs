/**
 * Adversarial bull/bear debate on one candidate. Pure — no I/O, no clock.
 *
 * ⚠️ OWNER-ONLY. T2; see lib/ai/signalSchema.mjs. Never consumer-facing.
 *
 * Why (2026-10-16). Our panel asks four models the same question independently
 * and takes an equal-weighted consensus (lib/ai/ensemble.mjs). That is honest
 * about disagreement, but it AVERAGES the bear case away: a model that quietly
 * notices the one disqualifying fact is outvoted three to one, and its reason
 * never reaches the decision. TradingAgents (TauricResearch, Apache-2.0) is
 * built around a structured bull-vs-bear argument instead. We took the idea,
 * not the code — its own published evidence is three stocks over 62 days with
 * models whose training data covers the test window, which is not evidence.
 *
 * The one rule that makes this safe to add to an order path:
 *
 *   A DEBATE CAN ONLY EVER TIGHTEN THE GATE, NEVER OPEN IT.
 *
 * The debate may block a buy the ensemble would have allowed. It may never
 * turn a blocked or declined candidate into a permitted one. A new AI stage
 * that can unlock a trade is a new way to lose money; one that can only veto
 * is a safety net. Every branch below preserves that, and a test pins it.
 *
 * The honest default is still to decline: a debate missing a side, or whose
 * sides failed to produce checkable claims, returns "undecided" and changes
 * nothing. An undecided debate is NOT a veto — it falls back to the ensemble.
 */
const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (typeof v === "string" ? v.trim() : "");

/** The two sides, in the order the record should read. */
export const SIDES = ["bull", "bear"];

/**
 * Split the available analysts into the two sides for one ticker.
 *
 * Deterministic on `ticker`, so re-running a round reproduces the same pairing
 * and the journal stays interpretable. The rotation is what stops one model
 * being the permanent bull — a role a model holds every round becomes a role
 * bias in the record, and we would be measuring the assignment, not the model.
 * Needs at least two analysts; one model arguing with itself is theatre.
 */
export function assignRoles(providers, ticker) {
  const list = arr(providers).map((p) => (typeof p === "string" ? p : str(p?.provider))).filter(Boolean);
  if (list.length < 2) return null;
  // A stable integer from the ticker; no clock, no randomness.
  let h = 0;
  for (const ch of String(ticker || "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const rotated = [...list.slice(h % list.length), ...list.slice(0, h % list.length)];
  const bull = [], bear = [];
  rotated.forEach((p, i) => (i % 2 === 0 ? bull : bear).push(p));
  // An odd count leaves the sides uneven; that is fine, but both must be held.
  return bear.length ? { bull, bear } : null;
}

/**
 * The side-specific instruction appended to the shared market packet.
 *
 * Deliberately asks for FALSIFIERS, not conviction. A case that cannot say
 * what would prove it wrong is rhetoric, and `debateOutcome` discards it —
 * which is the only reason this is worth more than a second opinion.
 */
export function debatePrompt(input) {
  const { side, ticker, opposingClaims = [] } = input || {};
  const s = str(side);
  if (s !== "bull" && s !== "bear") return null;
  const tk = str(ticker).toUpperCase() || "this company";
  const stance = s === "bull"
    ? `Argue the case FOR buying ${tk} now.`
    : `Argue the case AGAINST buying ${tk} now.`;
  const lines = [
    stance,
    "",
    "You are one side of a two-sided review. Argue your side as well as the evidence honestly allows — and no further.",
    "Rules:",
    "- Every claim must cite an evidence id from the packet above. A claim you cannot cite, you must drop.",
    "- For every claim, state what observable fact would prove it WRONG (its falsifier).",
    "- Do not restate the Sharia verdict. It is an input, already settled, and never yours to re-litigate.",
    "- If the evidence does not support your side, say so plainly. A weak case stated honestly is worth more than a strong one invented; conceding is a valid outcome.",
  ];
  if (arr(opposingClaims).length) {
    lines.push(
      "",
      "The other side has argued:",
      ...arr(opposingClaims).map((c, i) => `  ${i + 1}. ${str(c?.claim ?? c)}`),
      "",
      "Address each point directly. For any you cannot answer from the evidence, say so.",
    );
  }
  return lines.join("\n");
}

/** A side's usable claims: those that cite evidence AND name a falsifier. */
export function usableClaims(side) {
  return arr(side?.claims)
    .filter((c) => c && str(c.claim) && str(c.evidence_id) && str(c.falsifier))
    .map((c) => ({ claim: str(c.claim), evidence_id: str(c.evidence_id), falsifier: str(c.falsifier), addressed: c.addressed === true }));
}

/**
 * The outcome of one debate, combined with the ensemble that preceded it.
 *
 *   bull, bear  { ok, claims:[{claim, evidence_id, falsifier, addressed}] }
 *   ensemble    aggregate() output — the independent panel's view
 *
 * → { ok, verdict, reason, unanswered, bullClaims, bearClaims, tightened }
 *   verdict: "proceed" | "blocked" | "undecided"
 *
 * "blocked" only ever means: the bear named checkable risks and the bull
 * answered none of them. Anything less decisive is "undecided", which leaves
 * the ensemble's decision exactly as it was.
 */
export function debateOutcome(input) {
  const { bull, bear, ensemble } = input || {};
  const base = { bullClaims: 0, bearClaims: 0, unanswered: [], tightened: false };

  // A side that failed, declined, or produced nothing checkable ends the
  // debate without a view. Never a veto on its own — a model timing out must
  // not be able to block a trade.
  if (!bull?.ok || !bear?.ok) {
    return { ...base, ok: false, verdict: "undecided", reason: "a side did not report" };
  }
  const bullClaims = usableClaims(bull);
  const bearClaims = usableClaims(bear);
  base.bullClaims = bullClaims.length;
  base.bearClaims = bearClaims.length;

  if (!bearClaims.length) {
    return { ...base, ok: true, verdict: "undecided", reason: "the bear case named no checkable risk" };
  }

  // The bear's points the bull did not answer. `addressed` is set by the
  // second pass, where the bull is shown the bear's claims.
  const unanswered = bearClaims.filter((c) => !c.addressed);
  base.unanswered = unanswered.map((c) => c.claim);

  // If the ensemble already declined or said SELL, the debate has nothing to
  // add: the candidate is not being bought either way. Reporting "blocked"
  // here would overstate the debate's role in the record.
  const consensus = ensemble?.ok ? str(ensemble.consensus) : null;
  if (consensus === null || consensus === "SELL") {
    return { ...base, ok: true, verdict: "undecided", reason: "the panel was not going to buy regardless" };
  }

  if (unanswered.length) {
    return {
      ...base, ok: true, verdict: "blocked", tightened: true,
      reason: `the bear named ${unanswered.length} risk${unanswered.length === 1 ? "" : "s"} the bull did not answer`,
    };
  }
  return { ...base, ok: true, verdict: "undecided", reason: "the bull answered every risk the bear raised" };
}

/**
 * Apply a debate to the gate. THE ONLY PLACE the debate touches a decision.
 *
 * `allowedByEnsemble` is what the existing gate decided. The return can go
 * from true to false and never from false to true — the safety property this
 * whole module is built around.
 */
export function applyDebate(allowedByEnsemble, outcome) {
  const allowed = allowedByEnsemble === true;
  if (!allowed) return { allowed: false, vetoed: false, reason: "not permitted before the debate" };
  if (outcome?.verdict === "blocked") {
    return { allowed: false, vetoed: true, reason: str(outcome.reason) || "blocked by the debate" };
  }
  return { allowed: true, vetoed: false, reason: str(outcome?.reason) || "unchanged by the debate" };
}
