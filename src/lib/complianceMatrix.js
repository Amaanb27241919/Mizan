/**
 * Holdings × screening standards. Pure — no React, no I/O.
 *
 * Mīzan screens against seven methodologies and the app's `status` field is a
 * MAJORITY aggregate (four or more failures ⇒ haram). That is fine until the
 * standards disagree — and on 2026-10-02 four live holdings turned out to pass
 * AAOIFI, Dow Jones and S&P Shariah while failing FTSE, MSCI, SC Malaysia and
 * IFSB, every one of them on the same Cash/Assets test. CRWD at 47.2%, NTAP at
 * 33.4%. The market-cap-denominated standards passed them; the
 * asset-denominated ones did not.
 *
 * I found that with a throwaway script. It should have been on a screen, which
 * is what this is for.
 *
 * ── THE DISTINCTION THAT MATTERS MOST ─────────────────────────────────────
 * "Evaluated and inconclusive" and "we could not fetch the data" both surface
 * as `review`, and conflating them is actively dangerous: on a rate-limited
 * Finnhub every standard returns pass:null with reason "No marketCap data",
 * which reads as 175 of 214 names failing a screen they were never actually
 * put through. I nearly rebuilt a live portfolio on exactly that confusion.
 *
 * So `NO_DATA` is its own state here. It is never counted as a pass, never
 * counted as a fail, and a row carrying it is explicitly not comparable.
 * Same principle as the nisab fix: show "unavailable" rather than a number
 * that looks authoritative and is not.
 */

export const STANDARDS = Object.freeze([
  "AAOIFI", "DOWJONES", "SP_SHARIAH", "FTSE_SHARIAH", "MSCI_ISLAMIC", "SC_MALAYSIA", "IFSB",
]);

/** Short labels for a dense column header. */
export const STANDARD_LABELS = Object.freeze({
  AAOIFI: "AAOIFI", DOWJONES: "DJ", SP_SHARIAH: "S&P", FTSE_SHARIAH: "FTSE",
  MSCI_ISLAMIC: "MSCI", SC_MALAYSIA: "SC-MY", IFSB: "IFSB",
});

export const MARK = Object.freeze({
  PASS: "pass", FAIL: "fail", REVIEW: "review", NO_DATA: "no_data",
});

/** Phrases the engine uses when it had nothing to evaluate. */
const NO_DATA_REASON = /\bno\s+(market\s*cap|marketcap|total\s*assets|totalassets|data)\b/i;

/**
 * One standard's mark for one verdict.
 *
 * Reads `byStandard[std]` directly rather than going through
 * statusForStandard, because that helper collapses "inconclusive" and
 * "no data" into the same `review` — which is the exact collapse this module
 * exists to undo.
 */
export function markFor(verdict, standard) {
  if (!verdict || typeof verdict !== "object") return MARK.NO_DATA;

  // A prohibited SECTOR is categorical and applies to every standard.
  if (verdict.status === "haram" && typeof verdict.reason === "string" && verdict.reason) {
    return MARK.FAIL;
  }

  const bs = verdict.byStandard && verdict.byStandard[standard];
  if (!bs) return MARK.NO_DATA;
  if (bs.pass === true) return MARK.PASS;
  if (bs.pass === false) return MARK.FAIL;
  // pass === null: either genuinely inconclusive, or nothing was fetched.
  if (typeof bs.reason === "string" && NO_DATA_REASON.test(bs.reason)) return MARK.NO_DATA;
  return MARK.REVIEW;
}

/**
 * A row per holding: every standard's mark, plus whether the governing
 * standard disagrees with the rest.
 *
 * `governing` is the standard that actually decides — AAOIFI by default, and
 * by owner decision for the trading universe. The point of `divergent` is to
 * surface the case where the thing you are relying on and the consensus of the
 * others point different ways, rather than leaving it to be discovered.
 */
export function complianceRow(symbol, verdict, { governing = "AAOIFI" } = {}) {
  const marks = {};
  for (const std of STANDARDS) marks[std] = markFor(verdict, std);

  const evaluated = STANDARDS.filter((s) => marks[s] !== MARK.NO_DATA);
  const passes = evaluated.filter((s) => marks[s] === MARK.PASS);
  const fails = evaluated.filter((s) => marks[s] === MARK.FAIL);

  const gov = marks[governing];
  // Comparable only when the governing standard produced a verdict AND enough
  // others did to form an opinion worth contrasting it with.
  const comparable = gov !== MARK.NO_DATA && evaluated.length >= 2;

  const othersFail = fails.filter((s) => s !== governing).length;
  const othersPass = passes.filter((s) => s !== governing).length;

  return {
    symbol: String(symbol || "").toUpperCase(),
    marks,
    governing,
    governingMark: gov,
    evaluated: evaluated.length,
    passes: passes.length,
    fails: fails.length,
    comparable,
    // The finding worth surfacing: the standard you rely on says one thing and
    // most of the others say the opposite.
    divergent: comparable && (
      (gov === MARK.PASS && othersFail > othersPass) ||
      (gov === MARK.FAIL && othersPass > othersFail)
    ),
    // Null, never a guess, when the data was not there to decide on.
    unscreened: gov === MARK.NO_DATA,
  };
}

/**
 * The whole book.
 *
 * `holdings` is [{ symbol, value }]; value is optional and only used to sort
 * the biggest positions first, because a divergence in a 7% position matters
 * more than one in a 0.3% position.
 */
export function complianceMatrix(holdings, verdicts, opts) {
  // Not a destructuring default: `= {}` never fires for null.
  const o = opts && typeof opts === "object" ? opts : {};
  const governing = o.governing || "AAOIFI";
  // Sharia-screened FUNDS (SPUS, SPSK…) hold a basket, not a balance sheet, so
  // the ratio screen never produces a verdict for them. They are covered by
  // their issuer's screen — the same "eligible by construction" rule the
  // strategies use (lib/trading/screenGate.mjs HALAL_FUNDS) — and counting
  // them as missing data made a fully covered book read "26/27 screened".
  const funds = o.funds instanceof Set ? o.funds : new Set();
  const list = Array.isArray(holdings) ? holdings : [];
  const map = verdicts && typeof verdicts === "object" ? verdicts : {};

  const rows = list
    .map((h) => {
      const sym = String(h?.symbol ?? h?.sym ?? h ?? "").toUpperCase();
      if (!sym) return null;
      const row = complianceRow(sym, map[sym], { governing });
      const fund = funds.has(sym);
      return { ...row, value: Number(h?.value) || 0, ...(fund ? { fund: true, unscreened: false, divergent: false } : {}) };
    })
    .filter(Boolean)
    .sort((a, b) => b.value - a.value);

  const screened = rows.filter((r) => !r.unscreened && !r.fund);

  return {
    rows,
    governing,
    total: rows.length,
    funds: rows.filter((r) => r.fund).length,
    // Covered = screened stocks + issuer-screened funds.
    screened: screened.length + rows.filter((r) => r.fund).length,
    // Stated plainly so a surface can say "4 of 25 not screened" instead of
    // rendering a confident-looking matrix over missing data.
    unscreened: rows.filter((r) => r.unscreened).length,
    divergent: rows.filter((r) => r.divergent).map((r) => r.symbol),
    failingGoverning: screened.filter((r) => r.governingMark === MARK.FAIL).map((r) => r.symbol),
  };
}
