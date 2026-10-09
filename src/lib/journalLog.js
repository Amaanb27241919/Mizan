/**
 * Pure: the Trade Lab Journal's day-by-day record (proposal §18 — who, what,
 * when, why, and which model saw which evidence). Two sources the tab already
 * reads are merged into one dated log:
 *   · orders  — /api/bot/activity (historyRows: outcome + reason)
 *   · reviews — /api/ai/research  (each model's answer, the panel's view, the
 *               evidence packet's hash and what it was missing)
 * Newest first, grouped by New York trading date.
 */
import { historyRows } from "./orderQueue.js";
import { strategyLabel } from "./deskBlotter.js";
import { failureCode } from "./committee.js";

const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : null);
const NY_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
export const nyDay = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? NY_DAY.format(new Date(t)) : null; };
const NAME = { anthropic: "Claude", google: "Gemini", openrouter: "DeepSeek" };
const verb = (a) => { const x = String(a || "").toUpperCase(); return x === "INSUFFICIENT_DATA" ? "not enough data" : x.toLowerCase(); };

function reviewEvent(r, strategies, models) {
  const s = arr(strategies).find((x) => obj(x) && String(x.id) === String(r.strategy_id));
  const l = s ? strategyLabel(s) : { code: "", name: "research" };
  const at = r.at || r.created_at || null;
  if (r.screen_only) {
    return { id: `rv-${r.id}`, at, kind: "review", strategyId: String(r.strategy_id || ""), code: l.code, name: l.name,
      what: `${r.ticker} stopped by the Sharia screen (${r.sharia_verdict || "not halal"}) — no model was asked`, why: null, mark: "off", evidence: null };
  }
  const e = obj(r.ensemble) || {};
  const answers = arr(e.per_model).filter(obj).map((m) => `${NAME[m.provider] || m.provider} ${verb(m.action)}`);
  const fails = arr(r.failures).filter(obj).map((f) => `${NAME[f.provider] || f.provider} failed (${String(failureCode(f)).replace(/_/g, " ")})`);
  const view = e.ok ? `panel: ${e.consensus ? verb(e.consensus) : "agreed"}${e.opposed ? ", opposed" : !e.unanimous ? ", split" : ""}` : "panel: no view";
  const used = arr(e.per_model).filter(obj).map((m) => models?.[m.provider] || m.model).filter(Boolean);
  return {
    id: `rv-${r.id}`, at, kind: "review", strategyId: String(r.strategy_id || ""), code: l.code, name: l.name,
    what: `${r.ticker} reviewed — ${view}`,
    why: [...answers, ...fails].join(" · ") || null,
    mark: e.ok ? (e.consensus === "SELL" ? "block" : "ok") : "warn",
    evidence: { hash: r.packet_hash ? String(r.packet_hash).slice(0, 12) : null, missing: arr(r.missing), models: [...new Set(used)] },
  };
}

function orderEvent(h) {
  const qty = h.qty == null ? "" : Number.isInteger(h.qty) ? `${h.qty} ` : `${h.qty.toFixed(2)} `;
  return {
    id: `or-${h.id}`, at: h.at, kind: "order", strategyId: h.strategyId, code: h.code, name: h.name,
    what: `${h.side === "sell" ? "Sell" : "Buy"} ${qty}${h.ticker} — ${h.label.toLowerCase()}${h.live ? " (real money)" : ""}`,
    why: h.reason, mark: h.mark, evidence: null,
  };
}

/**
 * → [{ day, events: [...] }] newest day first, newest event first.
 * opts.kind: "all" | "order" | "review"; opts.strategyId: filter.
 * opts.models: { provider: modelId } — the configured model ids, for §18's "which model".
 */
export function journalLog(activity, research, strategies, opts) {
  const o = obj(opts) || {};
  const kind = o.kind || "all";
  const orders = kind === "review" ? [] : historyRows(activity, strategies, 500).map(orderEvent);
  const reviews = kind === "order" ? [] : arr(research).filter(obj).map((r) => reviewEvent(r, strategies, o.models));
  const all = [...orders, ...reviews]
    .filter((e) => !o.strategyId || e.strategyId === String(o.strategyId))
    .filter((e) => nyDay(e.at))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const days = new Map();
  for (const e of all) { const d = nyDay(e.at); (days.get(d) || days.set(d, []).get(d)).push(e); }
  return [...days].map(([day, events]) => ({ day, events }));
}
