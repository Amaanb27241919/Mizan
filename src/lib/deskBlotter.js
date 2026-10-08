/**
 * Pure (no React, no I/O): the Trade Lab Command Center's strategy blotter.
 *
 * Several strategies share one paper account — each with its own sleeve of the
 * pot, its own ledger, its own AI reviews. The desk used to show only the
 * account, so "how is each strategy doing?" meant switching tabs, and the
 * strategy cards were titled "214 halal names" with no way to tell A from E.
 * Every figure here is passed through from the server's scoreboard
 * (lib/trading/sleeve.mjs strategyScore); nothing is re-derived.
 */
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : null);
const arr = (v) => (Array.isArray(v) ? v : []);
const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** "A: reference system + AI gate" → { code: "A", name: "Reference system + AI gate" }. */
export function strategyLabel(strat) {
  const s = obj(strat) || {}, p = obj(s.params) || {};
  const exp = typeof p.experiment === "string" ? p.experiment.trim() : "";
  const m = exp.match(/^([A-Z])(?:\s*·\s*([a-z]+))?\s*:\s*(.+)$/);
  if (m) {
    const name = m[3].trim();
    return { code: m[2] ? `${m[1]}·${m[2]}` : m[1], name: name.charAt(0).toUpperCase() + name.slice(1) };
  }
  const nl = String(s.nl_description || "").trim();
  const first = nl.split(/ — | - |[.:,]/)[0].trim();
  return { code: "", name: (first || s.strategy_type || "strategy").slice(0, 48) };
}

const DAY = 86400000;
/** One short status line per strategy, with a tone for colour (ok | warn | muted). */
export function strategyStatus(strat, now = new Date()) {
  const s = obj(strat) || {}, p = obj(s.params) || {}, pr = obj(s.progress) || {};
  if (s.enabled === false) return { text: "paused", tone: "muted" };
  if (p.layer === "shadow") return { text: "shadow · records only", tone: "muted" };
  if (s.strategy_type === "dca") {
    if (p.dca_waiting_for_funds) return { text: "waiting for a deposit", tone: "warn" };
    return { text: "accumulating", tone: "ok" };
  }
  if (s.strategy_type === "rank_rebalance") {
    const today = now.toISOString().slice(0, 10);
    const ls = obj(p.last_screen);
    if (ls && ls.date === today && ls.waiting) return { text: `screen pending (${arr(ls.unverified).length})`, tone: "warn" };
    const cadence = Math.max(1, Number(p.rebalance_days) || 30);
    const last = p.last_rebalance ? Date.parse(p.last_rebalance) : NaN;
    if (!Number.isFinite(last)) return { text: "rebalance due", tone: "warn" };
    const left = Math.ceil(cadence - (now.getTime() - last) / DAY);
    return left <= 0 ? { text: "rebalance due", tone: "warn" } : { text: `rebalance in ${left}d`, tone: "ok" };
  }
  if (pr.held_ticker) return { text: `holding ${pr.held_ticker}`, tone: "ok" };
  return { text: "watching for an entry", tone: "muted" };
}

const codeOrder = (c) => (c ? c : "￿");

/** Strategies → blotter rows, sorted by experiment code (unlabeled last). */
export function blotterRows(strategies, now = new Date()) {
  return arr(strategies).map((s) => {
    const st = obj(s) || {}, pr = obj(st.progress) || {}, p = obj(st.params) || {};
    const { code, name } = strategyLabel(st);
    const unpriced = arr(pr.unpriced).length > 0;
    return {
      id: String(st.id || ""), code, name,
      group: p.experiment_group ? String(p.experiment_group) : null,
      type: st.strategy_type || null,
      venue: pr.paper || p.broker === "alpaca_paper" ? "paper" : "live",
      sleeve: num(st.capital_allocated),
      equity: unpriced ? null : num(pr.equity),
      returnPct: unpriced ? null : num(pr.return_pct),
      benchPct: num(pr.bench_return_pct),
      alphaPct: unpriced ? null : num(pr.alpha_pct),
      holdings: num(pr.holdings_count) ?? (pr.held_ticker ? 1 : 0),
      traded: Number(pr.trades_executed) > 0,
      unpriced,
      status: strategyStatus(st, now),
    };
  }).sort((a, b) => codeOrder(a.code).localeCompare(codeOrder(b.code)) || a.name.localeCompare(b.name));
}

/**
 * How the pot is split: each sleeve's share of the account, then whatever is
 * unallocated. Scaled down (and the remainder omitted) if sleeves exceed the
 * account, so the bar never draws past 100%.
 */
export function allocationSegments(rows, accountEquity) {
  const total = num(accountEquity);
  if (!(total > 0)) return [];
  // `color` is passed through untouched (strategyColors.js) so the bar wears
  // each strategy's identity colour; this module stays colour-agnostic.
  const segs = arr(rows).filter((r) => num(r?.sleeve) > 0).map((r) => ({ code: r.code || r.name || "?", amount: num(r.sleeve), ...(r.color ? { color: r.color } : {}) }));
  const used = segs.reduce((t, s) => t + s.amount, 0);
  const scale = used > total ? total / used : 1;
  const out = segs.map((s) => ({ ...s, pct: Math.round((s.amount * scale / total) * 10000) / 100 }));
  if (used < total) out.push({ code: "unallocated", amount: Math.round((total - used) * 100) / 100, pct: Math.round(((total - used) / total) * 10000) / 100 });
  return out;
}

/** Recent orders across every strategy, newest first. AI reviews (shadow) are not orders. */
export function tapeRows(items, strategies, limit = 12) {
  const codeById = new Map(arr(strategies).map((s) => [String(s?.id || ""), strategyLabel(s).code || strategyLabel(s).name]));
  return arr(items)
    .filter((i) => i && i.status !== "shadow")
    // Sorted by the time the tape SHOWS (fill, else creation). Sorting by
    // creation while displaying fill time put 09:34 between two 09:33 rows.
    .sort((a, b) => String(b.executed_at || b.created_at || "").localeCompare(String(a.executed_at || a.created_at || "")))
    .slice(0, limit)
    .map((i) => ({
      id: String(i.id || ""), at: i.executed_at || i.created_at || null,
      strategyId: String(i.strategy_id || ""),
      code: codeById.get(String(i.strategy_id || "")) || "—",
      side: i.side === "sell" ? "sell" : "buy", ticker: String(i.ticker || ""),
      qty: num(i.qty), status: String(i.status || ""), error: i.error_msg || null,
    }));
}

/**
 * A multi-sleeve experiment (rows sharing `group`) as one subtotal row: sleeve
 * and equity summed, return on the summed sleeve. Equity/return are null if
 * any member's equity is unknown — a half-known total is never shown as whole.
 */
export function groupTotals(rows) {
  const by = new Map();
  for (const r of arr(rows)) if (r && r.group) by.set(r.group, [...(by.get(r.group) || []), r]);
  return [...by].filter(([, m]) => m.length > 1).map(([group, m]) => {
    const sleeve = m.reduce((t, r) => t + (num(r.sleeve) || 0), 0);
    const known = m.every((r) => num(r.equity) !== null);
    const traded = m.some((r) => r.traded);
    const equity = known ? Math.round(m.reduce((t, r) => t + num(r.equity), 0) * 100) / 100 : null;
    // Before any sleeve trades there is no return — "0.00%" would read as a result.
    return { group, members: m.length, sleeve, equity, traded, returnPct: traded && known && sleeve > 0 ? Math.round(((equity / sleeve) - 1) * 10000) / 100 : null };
  });
}
