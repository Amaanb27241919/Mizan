/**
 * Pure (no I/O): the Trade Lab summary the owner's 8:30 ET morning brief reads
 * (GET /api/owner/brief → the Lima brief's Mizan section).
 *
 * Every figure here is passed through from a source that already exists — the
 * strategy scoreboard (strategyScore), today's AI-panel rows, the rank plan's
 * recorded Sharia screen, the shared verdict cache. Nothing is estimated or
 * re-derived, so the brief can never disagree with the Trade Lab.
 */
import { HALAL_FUNDS } from "./trading/screenGate.mjs";

const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : null);

/**
 * Today's AI-panel rows → who answered. null when nothing was reviewed, so
 * "no review was needed" never reads as "the panel failed".
 */
export function summarizePanel(rows) {
  const list = arr(rows).map((r) => obj(r?.rationale)).filter((r) => r && r.kind === "ai_panel");
  if (!list.length) return null;
  const reviews = list.filter((r) => !r.screen_only);
  const byProvider = {};
  const slot = (p) => (byProvider[p] ||= { answered: 0, failed: 0, codes: [] });
  let complete = reviews.length > 0;
  for (const r of reviews) {
    for (const m of arr(r.ensemble?.per_model)) if (m?.provider) slot(String(m.provider)).answered++;
    for (const f of arr(r.failures)) {
      if (!f?.provider) continue;
      const s = slot(String(f.provider));
      s.failed++;
      if (f.code && !s.codes.includes(String(f.code))) s.codes.push(String(f.code));
    }
    const asked = Number(r.panel?.asked), answered = Number(r.panel?.answered);
    if (!(asked > 0) || answered !== asked) complete = false;
  }
  return { reviewed: reviews.length, screenOnly: list.length - reviews.length, complete, byProvider };
}

/** Held stocks whose cached verdict FAILS AAOIFI. Funds and unscreened names are never listed. */
export function failingHeld(book, verdicts, standard = "AAOIFI") {
  const b = obj(book) || {}, v = obj(verdicts) || {};
  return Object.keys(b)
    .filter((tk) => Number(b[tk]) > 0 && !HALAL_FUNDS.has(tk))
    .filter((tk) => obj(v[tk])?.byStandard?.[standard]?.pass === false)
    .sort();
}

/** The rank plan's recorded screen for today (params.last_screen), or why there is none. */
export function screenSummary(lastScreen, today, due) {
  const s = obj(lastScreen);
  if (!s || s.date !== today) return { due: Boolean(due), ran: false };
  return {
    due: Boolean(due), ran: true, standard: s.standard || "AAOIFI",
    excluded: arr(s.excluded), sells: arr(s.sells), unverified: arr(s.unverified), waiting: Boolean(s.waiting),
  };
}

/** Live DCA: is it waiting for a deposit, and what happened last time it tried. */
export function dcaSummary(params, lastSignal) {
  const p = obj(params) || {}, l = obj(lastSignal);
  return {
    waitingForFunds: typeof p.dca_waiting_for_funds === "string" ? p.dca_waiting_for_funds : null,
    last: l ? { date: String(l.created_at || "").slice(0, 10) || null, status: l.status || null, error: l.error_msg || null } : null,
  };
}

const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** One strategy's line in the brief. Returns are null until it has traded. */
/** "Experiment A — reference (uncle) system: …" → "Experiment A". */
export function shortLabel(text) {
  const t = String(text || "").trim();
  const cut = t.split(/ — | - |[.:,]/)[0].trim();
  return (cut || t).slice(0, 48);
}

export function strategyBrief(input) {
  const { strategy, account, paper, progress, panel = null, screen = null, failing = [], dca = null } = obj(input) || {};
  const s = obj(strategy) || {}, p = obj(progress) || {}, params = obj(s.params) || {};
  const traded = Number(p.trades_executed) > 0;
  return {
    id: String(s.id || "").slice(0, 8),
    label: String(params.label || params.name || shortLabel(s.nl_description) || s.strategy_type || "strategy").slice(0, 60),
    type: s.strategy_type || null,
    account: account || null,
    venue: paper ? "paper" : "live",
    score: {
      traded,
      equity: num(p.equity),
      returnPct: traded ? num(p.return_pct) : null,
      benchReturnPct: traded ? num(p.bench_return_pct) : null,
      alphaPct: traded ? num(p.alpha_pct) : null,
      startedAt: p.started_at || null,
    },
    panel, screen, failingHeld: arr(failing), dca,
  };
}
