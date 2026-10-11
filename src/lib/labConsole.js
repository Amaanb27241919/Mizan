/**
 * Pure (no React, no I/O): what the Trade Lab console derives from data the
 * desk already holds — the alert feed, the order queue, and the stage chart.
 *
 * The console is drawn after a monitoring screen (owner, 2026-10-11): one big
 * view of every strategy against SPUS, an inspector for the selected one, a
 * queue, and an alert feed. Nothing here fetches or estimates; an unknown is
 * left unknown (null), never shown as zero.
 */
const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : null);
const finite = (v) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));
const when = (it) => Date.parse(it?.executed_at || it?.created_at || "");

/** The order's day in New York, where the market keeps its calendar. */
const NY_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
export const nyDay = (ms) => (Number.isFinite(ms) ? NY_DAY.format(new Date(ms)) : null);

const LEVEL_RANK = { crit: 0, warn: 1, info: 2 };

/**
 * The alert feed. Inputs are what the desk already read:
 *   items     /api/bot/activity rows (orders; shadow rows are AI reviews, not orders)
 *   pending   signals awaiting approval (a number, or null when unknown)
 *   pipeline  deskPipeline() output — a blocked stage is critical, a warning one is a warning
 *   compliance { failing } — held names failing AAOIFI
 *   codes     Map strategyId → code, for naming the strategy
 * Critical first, then newest first. A rejected LIVE order is critical; a
 * rejected paper order is a warning (nothing real was lost).
 */
export function consoleAlerts(input, opts) {
  const i = obj(input) || {};
  const o = obj(opts) || {};
  const now = finite(o.now) ? Number(o.now) : Date.now();
  const horizon = now - (finite(o.hours) ? Number(o.hours) : 48) * 3600000;
  const codes = i.codes instanceof Map ? i.codes : new Map();
  const out = [];
  for (const it of arr(i.items)) {
    if (!obj(it) || it.status === "shadow") continue;
    const at = when(it);
    if (!Number.isFinite(at) || at < horizon) continue;
    const who = codes.get(String(it.strategy_id || "")) || (it.strategy_id ? "strategy" : "by hand");
    const what = `${it.side === "sell" ? "SELL" : "BUY"} ${String(it.ticker || "").toUpperCase()}`.trim();
    if (it.status === "rejected") {
      out.push({ id: `o:${it.id}`, at, level: it.paper === false ? "crit" : "warn", title: `Rejected · ${what}`, who, detail: String(it.error_msg || "").slice(0, 140) || null });
    } else if (it.status === "executed") {
      out.push({ id: `o:${it.id}`, at, level: "info", title: `Filled · ${what}`, who, detail: null });
    }
  }
  if (finite(i.pending) && Number(i.pending) > 0) {
    const n = Number(i.pending);
    out.push({ id: "pending", at: now, level: "warn", title: `${n} awaiting your approval`, who: "Orders", detail: null });
  }
  const failing = finite(i.compliance?.failing) ? Number(i.compliance.failing) : 0;
  if (failing > 0) {
    out.push({ id: "aaoifi", at: now, level: "crit", title: `${failing} holding${failing === 1 ? "" : "s"} fail AAOIFI`, who: "Compliance", detail: "sold at the next rebalance" });
  }
  for (const s of arr(i.pipeline?.stages)) {
    if (!obj(s) || (s.mark !== "block" && s.mark !== "warn")) continue;
    out.push({ id: `p:${s.key}`, at: now, level: s.mark === "block" ? "crit" : "warn", title: String(s.label || s.key), who: "System", detail: s.detail ? String(s.detail) : null });
  }
  return out.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || b.at - a.at);
}

/** "3 active · 1 crit" — the feed's header. Info lines are a log, not alerts. */
export function alertCounts(alerts) {
  const list = arr(alerts);
  return { active: list.filter((a) => a?.level !== "info").length, crit: list.filter((a) => a?.level === "crit").length };
}

/**
 * The order queue. Today = New York's trading day.
 *   waiting   awaiting approval (status pending)
 *   working   accepted by the broker, fill not yet confirmed (submitted)
 *   filled    filled today
 *   refused   rejected or expired today
 *   tape      today's orders oldest → newest, one glyph each
 *   days      orders per day over the last `span` days that had any, oldest first
 */
export function orderQueue(items, opts) {
  const o = obj(opts) || {};
  const now = finite(o.now) ? Number(o.now) : Date.now();
  const today = nyDay(now);
  const span = finite(o.span) ? Number(o.span) : 10;
  const orders = arr(items).filter((it) => obj(it) && it.status !== "shadow" && Number.isFinite(when(it)));
  const isToday = (it) => nyDay(when(it)) === today;
  const tape = orders.filter(isToday).sort((a, b) => when(a) - when(b))
    .map((it) => ({ id: String(it.id || ""), status: String(it.status || ""), ticker: String(it.ticker || "").toUpperCase(), side: it.side === "sell" ? "sell" : "buy" }));
  const perDay = new Map();
  for (const it of orders) { const d = nyDay(when(it)); perDay.set(d, (perDay.get(d) || 0) + 1); }
  const days = [...perDay].sort(([a], [b]) => a.localeCompare(b)).slice(-span).map(([day, n]) => ({ day, n }));
  return {
    waiting: orders.filter((it) => it.status === "pending").length,
    working: orders.filter((it) => it.status === "submitted").length,
    filled: tape.filter((t) => t.status === "executed").length,
    refused: tape.filter((t) => t.status === "rejected" || t.status === "expired").length,
    tape,
    days,
  };
}

/**
 * The stage: every visible strategy's daily return on ONE shared y-scale
 * (never two axes) with SPUS, on a shared calendar so a strategy that started
 * later starts further right instead of being stretched across the box.
 *   curves   { [id]: { points:[{day, returnPct, benchPct}] } }
 *   rows     blotterRows (id, code, color, traded…)
 *   visible  Set of ids to draw
 * Returns null when nothing has two points to draw.
 */
export function stageGeometry(curves, rows, visible, opts) {
  const o = obj(opts) || {};
  const w = finite(o.w) && Number(o.w) > 0 ? Number(o.w) : 1000;
  const h = finite(o.h) && Number(o.h) > 0 ? Number(o.h) : 360;
  const pad = finite(o.pad) ? Number(o.pad) : 24;
  // Room on the right for the newest point's crosshair and label.
  const padR = finite(o.padRight) ? Number(o.padRight) : pad;
  const c = obj(curves) || {};
  const show = visible instanceof Set ? visible : new Set();
  const series = arr(rows).filter((r) => obj(r) && show.has(String(r.id)))
    .map((r) => ({ row: r, pts: arr(obj(c[r.id])?.points).filter((p) => obj(p) && typeof p.day === "string") }))
    .filter((s) => s.pts.length >= 2);
  if (!series.length) return null;
  const days = [...new Set(series.flatMap((s) => s.pts.map((p) => p.day)))].sort();
  if (days.length < 2) return null;
  const vals = series.flatMap((s) => s.pts.flatMap((p) => [p.returnPct, p.benchPct])).filter(finite).map(Number);
  let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  if (hi - lo < 1) { const mid = (hi + lo) / 2; lo = mid - 0.5; hi = mid + 0.5; }
  const span = hi - lo; lo -= span * 0.08; hi += span * 0.08;
  const xi = new Map(days.map((d, i) => [d, i]));
  const x = (d) => pad + (xi.get(d) * (w - pad - padR)) / (days.length - 1);
  const y = (v) => pad + ((hi - Number(v)) * (h - pad * 2)) / (hi - lo);
  const line = (pts, key) => pts.filter((p) => finite(p[key])).map((p) => [Number(x(p.day).toFixed(1)), Number(y(p[key]).toFixed(1))]);
  const lines = series.map(({ row, pts }) => {
    const xy = line(pts, "returnPct");
    const last = pts.filter((p) => finite(p.returnPct)).at(-1);
    return { id: String(row.id), code: row.code || row.name || "", color: row.color || null, xy, last: xy.at(-1) || null, lastPct: last ? Number(last.returnPct) : null };
  }).filter((l) => l.xy.length >= 2);
  // SPUS from the strategy that has been measured longest: every curve's bench
  // is SPUS over THAT strategy's window, so the longest one covers the most days.
  const longest = [...series].sort((a, b) => b.pts.length - a.pts.length)[0];
  const bench = line(longest.pts, "benchPct");
  return { w, h, pad, days, lo, hi, zeroY: Number(y(0).toFixed(1)), lines, bench: bench.length >= 2 ? bench : null, ticks: yTicks(lo, hi).map((v) => ({ v, y: Number(y(v).toFixed(1)) })) };
}

/** Round-number ticks for a percent axis, 3–6 of them, always including 0 when in range. */
export function yTicks(lo, hi) {
  if (!finite(lo) || !finite(hi) || !(Number(hi) > Number(lo))) return [];
  const span = Number(hi) - Number(lo);
  const step = [0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50].find((s) => span / s <= 6) || 100;
  const out = [];
  for (let v = Math.ceil(Number(lo) / step) * step; v <= Number(hi) + 1e-9; v += step) out.push(Number(v.toFixed(2)) || 0);
  return out;
}

/** The newest moment anything was recorded — the top bar's "last activity". */
export function lastActivity(items, reviews) {
  const t = [...arr(items).map(when), ...arr(reviews).map((r) => Date.parse(r?.created_at || ""))].filter(Number.isFinite);
  return t.length ? Math.max(...t) : null;
}
