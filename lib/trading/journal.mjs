/**
 * Pure (no I/O): a strategy's journal — every order, AI review and
 * screen-only skip it ever recorded — as a CSV that opens in Excel.
 *
 * The findings of the paper experiments live in pending_signals (orders and
 * their rationale) and its shadow rows (AI panel reviews). They were only
 * reachable by SQL; this puts them in a file the owner can keep, compare and
 * study months later (GET /api/bot/journal.csv?strategy_id=).
 */
import { csvCell } from "./closedLots.mjs";

export const JOURNAL_COLS = [
  "date", "executed_at", "strategy", "kind", "side", "ticker", "qty", "price", "status",
  "rank", "momentum", "volatility", "target_weight", "excluded",
  "claude", "gemini", "deepseek", "panel_result", "sharia_verdict", "error",
];
const PROVIDER_COL = { anthropic: "claude", google: "gemini", openrouter: "deepseek" };

const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : null);
const arr = (v) => (Array.isArray(v) ? v : []);
const n = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

function rowOf(r, strategy) {
  const rat = obj(r.rationale) || {};
  const isPanel = rat.kind === "ai_panel";
  const kind = isPanel ? (rat.screen_only ? "screen_only" : "ai_review") : "order";
  const votes = {};
  for (const m of arr(rat.ensemble?.per_model)) { const c = PROVIDER_COL[m?.provider]; if (c) votes[c] = m.action ?? ""; }
  for (const f of arr(rat.failures)) { const c = PROVIDER_COL[f?.provider]; if (c && !votes[c]) votes[c] = `failed:${f.code || "error"}`; }
  return {
    date: r.created_at || null, executed_at: r.executed_at || null, strategy, kind,
    side: r.side || null, ticker: r.ticker || null,
    qty: isPanel ? null : n(r.qty), price: isPanel ? null : n(r.suggested_price), status: r.status || null,
    rank: n(rat.rank), momentum: n(rat.momentum), volatility: n(rat.volatility), target_weight: n(rat.target_weight),
    excluded: arr(rat.excluded).join(" "),
    claude: votes.claude ?? "", gemini: votes.gemini ?? "", deepseek: votes.deepseek ?? "",
    panel_result: isPanel && !rat.screen_only ? (rat.ensemble?.ok ? (rat.ensemble?.action || "ok") : (rat.ensemble?.code || "")) : "",
    sharia_verdict: rat.sharia_verdict || "", error: r.error_msg || "",
  };
}

export function journalCsv(rows, opts) {
  const strategy = String(obj(opts)?.strategy || "");
  const list = arr(rows).filter((r) => obj(r)).slice()
    .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
  const lines = [JOURNAL_COLS.join(",")];
  for (const r of list) {
    const row = rowOf(r, strategy);
    lines.push(JOURNAL_COLS.map((c) => csvCell(row[c])).join(","));
  }
  return lines.join("\n") + "\n";
}
