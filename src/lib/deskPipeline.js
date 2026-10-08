/**
 * Pure (no React, no I/O): the Trade Lab desk's ORDER PIPELINE — one status
 * mark per gate an order passes, in the order it passes them:
 *   market → AI committee → strategies → Sharia gate → cash (no margin) → brokers
 * plus the pause state. Each stage is { key, label, mark, detail } where mark is
 *   ok    ●  clear
 *   warn  ◐  needs attention, not blocking
 *   block ■  stops orders
 *   off   ○  idle / switched off
 *   unknown  not measured — rendered as such, never as clear
 *
 * Every mark comes from data the desk already holds. Nothing here is a
 * threshold invented for the screen: "risk" is the one rule the order path
 * itself enforces — cash is the ceiling, because margin is riba.
 */
const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : null);
const fin = (v) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export const MARK_GLYPH = { ok: "●", warn: "◐", block: "■", off: "○", unknown: "·" };

function marketStage(session) {
  const s = obj(session);
  if (!s) return { key: "market", label: "Market", mark: "unknown", detail: "session unknown" };
  if (s.session === "regular") return { key: "market", label: "Market", mark: "ok", detail: "open" };
  if (s.tradeable) return { key: "market", label: "Market", mark: "warn", detail: String(s.label || "extended hours").toLowerCase() };
  return { key: "market", label: "Market", mark: "off", detail: "closed" };
}

/** committee: latestRoundAnswering(...) output, or null. */
function committeeStage(committee) {
  const c = obj(committee);
  const n = fin(c?.reviews), done = fin(c?.complete), need = fin(c?.required);
  if (!c || !(n > 0) || done === null || !(need > 0)) return { key: "ai", label: "AI committee", mark: "unknown", detail: "no reviews yet" };
  if (done >= n) return { key: "ai", label: "AI committee", mark: "ok", detail: `all ${need} analysts answering` };
  if (!c.anyAnswer) return { key: "ai", label: "AI committee", mark: "block", detail: "no analyst answering" };
  return { key: "ai", label: "AI committee", mark: "warn", detail: `${n - done} of ${n} reviews missing an analyst` };
}

/** rows: blotterRows(...) output. */
function strategiesStage(rows, state) {
  if (state !== "ready") return { key: "strategies", label: "Strategies", mark: "unknown", detail: state === "loading" ? "loading" : "unavailable" };
  const list = arr(rows);
  const running = list.filter((r) => r?.status?.text !== "paused").length;
  const unpriced = list.filter((r) => r?.unpriced).length;
  if (unpriced) return { key: "strategies", label: "Strategies", mark: "warn", detail: `${unpriced} can't be priced` };
  return { key: "strategies", label: "Strategies", mark: running ? "ok" : "off", detail: `${running} running` };
}

/** compliance: { total, screened, failing:[sym] } over the desk's holdings, or null. */
function shariaStage(compliance) {
  const c = obj(compliance);
  if (!c || !(fin(c.total) > 0)) return { key: "sharia", label: "Sharia gate", mark: c && fin(c.total) === 0 ? "ok" : "unknown", detail: c && fin(c.total) === 0 ? "nothing held" : "not screened yet" };
  const failing = arr(c.failing), total = fin(c.total), screened = fin(c.screened) ?? 0;
  if (failing.length) return { key: "sharia", label: "Sharia gate", mark: "block", detail: `${failing.join(", ")} fail AAOIFI` };
  const passing = screened - failing.length;
  if (screened < total) return { key: "sharia", label: "Sharia gate", mark: "warn", detail: `${passing}/${total} pass · ${total - screened} unscreened` };
  return { key: "sharia", label: "Sharia gate", mark: "ok", detail: `${passing}/${total} pass AAOIFI` };
}

function cashStage(account) {
  const cash = fin(obj(account)?.cash);
  if (cash === null) return { key: "cash", label: "Cash", mark: "unknown", detail: "paper desk not read" };
  return cash < 0
    ? { key: "cash", label: "Cash", mark: "block", detail: "below zero — margin in use" }
    : { key: "cash", label: "Cash", mark: "ok", detail: "no margin" };
}

/** Paper broker from the desk's own read; live from strategy statuses. */
function brokersStage(deskState, rows) {
  const parts = [];
  let mark = "ok";
  if (deskState === "ready") parts.push("Alpaca paper linked");
  else if (deskState === "unavailable") { parts.push("Alpaca unreachable"); mark = "block"; }
  else { parts.push(deskState === "loading" ? "Alpaca loading" : "Alpaca not read"); mark = "unknown"; }
  const waiting = arr(rows).filter((r) => r?.venue === "live" && /deposit/.test(String(r?.status?.text || "")));
  if (waiting.length) {
    parts.push(`${waiting.map((r) => r.code || r.name).join(", ")} waiting for a deposit`);
    if (mark === "ok") mark = "warn";
  }
  return { key: "brokers", label: "Brokers", mark, detail: parts.join(" · ") };
}

function pausesStage(rows, state) {
  if (state !== "ready") return { key: "pauses", label: "Pauses", mark: "unknown", detail: "—" };
  const paused = arr(rows).filter((r) => r?.status?.text === "paused");
  return paused.length
    ? { key: "pauses", label: "Pauses", mark: "warn", detail: `${paused.length} paused: ${paused.map((r) => r.code || r.name).join(", ")}` }
    : { key: "pauses", label: "Pauses", mark: "off", detail: "nothing paused" };
}

export function deskPipeline(input) {
  const i = obj(input) || {};
  return {
    stages: [
      marketStage(i.session),
      committeeStage(i.committee),
      strategiesStage(i.rows, i.bookState),
      shariaStage(i.compliance),
      cashStage(i.account),
      brokersStage(i.deskState, i.rows),
    ],
    pauses: pausesStage(i.rows, i.bookState),
  };
}

/**
 * The latest day's research reviews: how many of them heard from EVERY
 * configured analyst. Counted per review, not as a union across reviews — a
 * day where Gemini answered one review and Claude another is not "all
 * answering" (an early version said 3 of 3 for exactly that day).
 * rows: /api/ai/research rows; required: analysts configured.
 * → { day, reviews, complete, required } or null when there is nothing to count.
 */
export function latestRoundAnswering(rows, providers, required) {
  // /api/ai/research names the timestamp `at`; accept `created_at` too.
  const when = (r) => (typeof r?.at === "string" ? r.at : typeof r?.created_at === "string" ? r.created_at : null);
  const reviews = arr(rows).filter((r) => obj(r) && !r.screen_only && when(r));
  const need = fin(required) ?? arr(providers).filter((p) => p?.available).length;
  if (!reviews.length || !(need > 0)) return null;
  const last = reviews.map((r) => when(r).slice(0, 10)).sort().at(-1);
  const today = reviews.filter((r) => when(r).slice(0, 10) === last);
  const complete = today.filter((r) => new Set(arr(obj(r.ensemble)?.per_model).map((m) => m?.provider).filter(Boolean)).size >= need).length;
  const anyAnswer = today.some((r) => arr(obj(r.ensemble)?.per_model).length > 0);
  return { day: last, reviews: today.length, complete, anyAnswer, required: need };
}
