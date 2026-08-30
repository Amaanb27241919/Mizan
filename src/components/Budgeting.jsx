import { useState, useEffect, useMemo, useCallback } from "react";
import { apiFetch } from "../lib/apiFetch.js";
import { useHideValues } from "../lib/useHideValues.js";
import { persistUserState } from "../lib/userState.js";
import {
  monthKey, prevMonth, nextMonth, spentByCategory,
  ISLAMIC_CATEGORY_PRESETS, suggestBudgets, groupCategories,
} from "../lib/budgetCategories.js";
import {
  computeBudgetSeries, inheritedTotal, spendingCategories,
  categoryIcon, prettyCategory, splitOfIncome, EVERYTHING_ELSE,
} from "../lib/budgetPlan.js";

/* ─── BUDGET ─────────────────────────────────────────────
 * Top-down: ONE monthly number, with category limits inside it.
 *
 * This replaced the zero-based envelope screen on 2026-08-30, on the owner's
 * call, after "the budgeting UI doesn't make sense to me, very confusing".
 * The envelope model made "To Budget" — income minus everything assigned — the
 * biggest figure on the page, and that number only means anything once you
 * have already accepted the method. Origin, Copilot and Monarch all lead with
 * the pair people actually come to ask about: what did I plan, what have I
 * spent. The math is in src/lib/budgetPlan.js, pure and separately tested.
 *
 * Two rules this file is built to keep:
 *   1. A ROW IS A STATUS LINE, NOT A FORM. The previous version put ROLL /
 *      EDIT on every row and three labelled inputs behind EDIT, so the default
 *      state of the screen was data entry. Everything editable now lives
 *      behind the row's own disclosure.
 *   2. COLOUR STAYS SEMANTIC. Green/red/amber mean under/over/off-pace, as
 *      they do everywhere else in Mizan. Category identity is carried by a
 *      glyph, never by a decorative colour that would argue with the bar.
 *
 * Tokens are an inline subset of MizanApp's `T`, kept local to avoid a
 * circular import with the 13k-line monolith (same pattern as CommandPalette).
 * ──────────────────────────────────────────────────────── */

const TT = {
  border: "var(--mz-border)", surface: "var(--mz-surface)",
  text: "var(--mz-text)", textHi: "var(--mz-textHi)",
  muted: "var(--mz-muted)", dim: "var(--mz-dim)",
  gain: "#117a52", gold: "#b8842a", loss: "#b23a3d", blue: "#1e4e8c",
  rSm: "var(--r-sm)", rMd: "var(--r-md)", rLg: "var(--r-lg)",
  s1: "var(--s-1)", s2: "var(--s-2)", s3: "var(--s-3)",
  s4: "var(--s-4)", s5: "var(--s-5)", s6: "var(--s-6)",
};
const FP = "'IBM Plex Sans',system-ui,-apple-system,BlinkMacSystemFont,sans-serif";
const FM = "'IBM Plex Mono','JetBrains Mono','Menlo','Monaco',monospace";
const FU = "'Fraunces',Georgia,serif";

const fmtUSD = v =>
  `${v < 0 ? "−" : ""}$${Math.abs(+v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtUSD0 = v =>
  `${v < 0 ? "−" : ""}$${Math.round(Math.abs(+v || 0)).toLocaleString("en-US")}`;
const monthLabel = m => {
  const d = new Date(`${m}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? m
    : d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
};

const PACE_COLOR = { over: TT.loss, "over-pace": TT.gold, under: TT.gain, unset: TT.dim };
const paceColor = p => (p?.state === "unset" ? TT.dim : PACE_COLOR[p?.state] || TT.dim);

function Tile({ children, accent, style }) {
  return (
    <div style={{
      position: "relative", background: "var(--mz-tile-fill, var(--mz-card))",
      border: `1px solid ${TT.border}`, borderRadius: TT.rLg,
      padding: TT.s5, overflow: "hidden", ...style,
    }}>
      {accent && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: accent }} />}
      {children}
    </div>
  );
}

/** A budget bar. The overspill is a hatched segment so "over" reads as a shape
 *  and not only as red, which a colour-blind reader cannot use. */
function Bar({ pct, color, over, height = 6 }) {
  return (
    <div role="presentation" style={{
      position: "relative", width: "100%", height, borderRadius: 999,
      background: "var(--mz-dim, rgba(0,0,0,0.08))", overflow: "hidden",
    }}>
      <div style={{
        width: `${Math.round(Math.max(0, Math.min(1, pct)) * 100)}%`, height: "100%",
        borderRadius: 999, background: color,
        transition: "width 220ms cubic-bezier(0.16,1,0.3,1)",
      }} />
      {over && (
        <div style={{
          position: "absolute", top: 0, right: 0, height: "100%", width: 6,
          background: `repeating-linear-gradient(45deg, ${TT.loss}, ${TT.loss} 2px, transparent 2px, transparent 4px)`,
        }} />
      )}
    </div>
  );
}

/**
 * The headline: a half-circle arc showing how much of the month's budget is
 * gone. Inline SVG — a gauge is one path and one dash offset, which is not
 * worth a charting dependency (CLAUDE.md §8).
 */
function Gauge({ pct, color, label, amount, sub, mask }) {
  const LEN = Math.PI * 90;                              // arc length, r=90
  const filled = Math.max(0, Math.min(1, pct)) * LEN;
  return (
    <div style={{ position: "relative", width: "100%", maxWidth: 260, margin: "0 auto" }}>
      <svg viewBox="0 0 200 118" style={{ width: "100%", display: "block" }} aria-hidden="true">
        <path d="M 10 100 A 90 90 0 0 1 190 100" fill="none" stroke="var(--mz-dim, rgba(0,0,0,0.08))"
          strokeWidth="12" strokeLinecap="round" />
        <path d="M 10 100 A 90 90 0 0 1 190 100" fill="none" stroke={color}
          strokeWidth="12" strokeLinecap="round"
          strokeDasharray={`${filled} ${LEN}`}
          style={{ transition: "stroke-dasharray 320ms cubic-bezier(0.16,1,0.3,1)" }} />
      </svg>
      <div style={{
        position: "absolute", inset: 0, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", paddingTop: 16, textAlign: "center",
      }}>
        <div style={{ fontFamily: FM, fontSize: "var(--fs-2xs)", letterSpacing: "0.16em", fontWeight: 600, color: TT.muted }}>
          {label}
        </div>
        <div style={{
          fontFamily: FU, fontSize: "var(--fs-4xl)", fontWeight: 700, color,
          letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", lineHeight: 1.05,
        }}>
          {mask(amount)}
        </div>
        <div style={{ fontFamily: FM, fontSize: "var(--fs-2xs)", color: TT.muted, marginTop: 2 }}>
          {sub}
        </div>
      </div>
    </div>
  );
}

/** A read-only figure in the summary rail. */
function RailRow({ label, pct, value, tone }) {
  return (
    <div style={{
      display: "flex", alignItems: "baseline", justifyContent: "space-between",
      gap: TT.s2, padding: `${TT.s2} 0`, borderTop: `1px solid ${TT.border}`,
    }}>
      <span style={{ fontFamily: FP, fontSize: "var(--fs-sm)", color: TT.text }}>{label}</span>
      <span style={{ display: "flex", alignItems: "baseline", gap: TT.s2, whiteSpace: "nowrap" }}>
        {pct !== null && pct !== undefined && (
          <span style={{ fontFamily: FM, fontSize: "var(--fs-2xs)", color: TT.muted }}>{pct}%</span>
        )}
        <span style={{
          fontFamily: FM, fontSize: "var(--fs-sm)", fontWeight: 600,
          color: tone || TT.textHi, fontVariantNumeric: "tabular-nums",
        }}>{value}</span>
      </span>
    </div>
  );
}

export default function Budgeting({ txns = [], demoMode = false, bankLinked = false }) {
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const [entries, setEntries] = useState([]);      // [{month, category, budgeted}]
  const [months, setMonths] = useState([]);        // [{month, manual_income}]
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState("");
  const [open, setOpen] = useState("");            // category whose detail is open
  const [editingPlan, setEditingPlan] = useState(false);
  const [addingLimit, setAddingLimit] = useState(false);
  const [newCat, setNewCat] = useState("");
  const [sort, setSort] = useState("spent");       // spent | name | group

  const { mask } = useHideValues();

  /* The monthly budget total + the rollover switch. These live in user_state
   * rather than in budget_months, which has only `manual_income` — adding a
   * column is a schema migration and those need an explicit ask (CLAUDE.md §8).
   * The key is TRACKED, so the plan follows the user across devices exactly
   * like the category limits do. */
  const [plan, setPlan] = useState(() => {
    try {
      const p = JSON.parse(localStorage.getItem("mizan_budget_plan") || "{}") || {};
      return { rollover: !!p.rollover, months: p.months && typeof p.months === "object" ? p.months : {} };
    } catch { return { rollover: false, months: {} }; }
  });
  const writePlan = useCallback((next) => {
    setPlan(next);
    try { localStorage.setItem("mizan_budget_plan", JSON.stringify(next)); } catch { /* quota */ }
    persistUserState("mizan_budget_plan", next);
  }, []);
  const setTotal = useCallback((value) => {
    const v = value === "" || value === null ? null : Number(value);
    writePlan({
      ...plan,
      months: { ...plan.months, [month]: { ...(plan.months[month] || {}), total: Number.isFinite(v) ? v : null } },
    });
  }, [plan, month, writePlan]);

  // Category rules ("show as") and groups. Both store the RULE, not the result,
  // so a re-sync can never undo a decision. Edited inside a row's detail.
  const [rules, setRules] = useState(() => {
    try { return JSON.parse(localStorage.getItem("mizan_category_rules") || "{}") || {}; } catch { return {}; }
  });
  const [groups, setGroups] = useState(() => {
    try { return JSON.parse(localStorage.getItem("mizan_category_groups") || "{}") || {}; } catch { return {}; }
  });
  const saveMap = useCallback((key, setter, from, to) => {
    const k = String(from || "").trim();
    const val = String(to || "").trim();
    if (!k) return;
    setter(prev => {
      const next = { ...prev };
      if (!val || val === k) delete next[k]; else next[k] = val;
      try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* quota */ }
      persistUserState(key, next);
      return next;
    });
  }, []);
  const saveRule  = useCallback((f, t) => saveMap("mizan_category_rules",  setRules,  f, t), [saveMap]);
  const saveGroup = useCallback((f, t) => saveMap("mizan_category_groups", setGroups, f, t), [saveMap]);

  // ── Load the WHOLE history, not just the visible month ───
  // Rollover is path-dependent: this month's headroom depends on last month's
  // result. Fetching one month would compute a plausible WRONG balance.
  useEffect(() => {
    if (demoMode) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true); setErr("");
      try {
        const r = await apiFetch("/api/budget");
        const d = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok) { setErr(d?.error || "Couldn't load your budget."); return; }
        setEntries(Array.isArray(d.entries) ? d.entries : []);
        setMonths(Array.isArray(d.months) ? d.months : []);
      } catch {
        if (!cancelled) setErr("Couldn't reach the server. Your budget is safe — try again.");
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [demoMode]);

  // ── Derive ───────────────────────────────────────────────
  const allMonths = useMemo(() => {
    const set = new Set([...entries.map(e => e.month), ...months.map(m => m.month), ...Object.keys(plan.months), month]);
    return [...set].filter(Boolean).sort();
  }, [entries, months, plan.months, month]);

  const limitsByMonth = useMemo(() => {
    const out = {};
    for (const m of allMonths) {
      out[m] = Object.fromEntries(
        entries.filter(e => e.month === m && Number(e.budgeted) > 0).map(e => [e.category, Number(e.budgeted)]),
      );
    }
    return out;
  }, [allMonths, entries]);

  const spentByMonth = useMemo(() => {
    const out = {};
    for (const m of allMonths) out[m] = spentByCategory(txns, m, { rules });
    return out;
  }, [allMonths, txns, rules]);

  const incomeByMonth = useMemo(() => {
    const manual = Object.fromEntries(months.filter(m => m.manual_income !== null).map(m => [m.month, m.manual_income]));
    const out = {};
    for (const m of allMonths) {
      if (manual[m] !== undefined) { out[m] = manual[m]; continue; }
      const next = nextMonth(m);
      out[m] = txns.reduce((s, t) => {
        const d = String(t?.date || "").slice(0, 10);
        if (!d || d < m || d >= next) return s;
        const amt = Number(t.amount) || 0;
        return amt < 0 ? s + Math.abs(amt) : s;   // Plaid: a credit is negative
      }, 0);
    }
    return out;
  }, [months, allMonths, txns]);

  // A budget set in August is still the plan in September until it is changed.
  // Without this, every new month opens empty and the same number gets retyped
  // twelve times a year.
  const inherited = useMemo(() => inheritedTotal(plan.months, month), [plan.months, month]);
  const effectivePlans = useMemo(() => {
    const out = { ...plan.months };
    for (const m of allMonths) {
      if (!Number.isFinite(+out[m]?.total)) {
        const inh = inheritedTotal(plan.months, m);
        if (inh.total !== null) out[m] = { ...(out[m] || {}), total: inh.total };
      }
    }
    return out;
  }, [plan.months, allMonths]);

  const series = useMemo(() => computeBudgetSeries(allMonths, {
    plans: effectivePlans, limitsByMonth, spentByMonth, incomeByMonth, rollover: plan.rollover,
  }), [allMonths, effectivePlans, limitsByMonth, spentByMonth, incomeByMonth, plan.rollover]);

  const cur = series[month] || { isSet: false, rows: [], spent: 0, left: 0, split: splitOfIncome(0, 0) };
  const manualForMonth = months.find(m => m.month === month)?.manual_income ?? null;
  const suggestion = useMemo(() => suggestBudgets(txns, { asOf: new Date() }), [txns]);

  // Rows: named limits first, then Everything else pinned last. Sorting by
  // spend puts the decisions at the top; editing happens inside a row's own
  // disclosure, so the list never reorders under a finger mid-edit.
  const rows = useMemo(() => {
    const list = [...(cur.rows || [])];
    if (sort === "name") list.sort((a, b) => a.category.localeCompare(b.category));
    else list.sort((a, b) => b.spent - a.spent || a.category.localeCompare(b.category));
    return list;
  }, [cur.rows, sort]);

  // groupCategories is shared with the old envelope shape, which named these
  // fields budgeted/spent/leftover and expected spend NEGATIVE.
  const grouped = useMemo(() => (
    sort === "group"
      ? groupCategories(rows.map(r => ({ ...r, budgeted: r.limit, spent: -r.spent, leftover: r.left })), groups)
      : null
  ), [rows, groups, sort]);

  const uncapped = useMemo(() => {
    const has = new Set(rows.map(r => r.category.toLowerCase()));
    const fromSpend = spendingCategories(txns, month, { rules })
      .filter(r => !has.has(r.category.toLowerCase())).slice(0, 8);
    const presets = ISLAMIC_CATEGORY_PRESETS
      .filter(p => !has.has(p.category.toLowerCase()) && !fromSpend.some(f => f.category.toLowerCase() === p.category.toLowerCase()));
    return { fromSpend, presets };
  }, [rows, txns, month, rules]);

  // ── Writes ───────────────────────────────────────────────
  const saveLimit = useCallback(async (category, budgeted) => {
    const body = { month, category, budgeted: Number(budgeted) || 0, carryover: false };
    const snapshot = entries;
    setEntries(prev => [...prev.filter(e => !(e.month === month && e.category === category)), { ...body }]);
    setSaving(category);
    try {
      const r = await apiFetch("/api/budget/entry", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setEntries(snapshot); setErr(d?.error || "That change didn't save.");
      } else setErr("");
    } catch { setEntries(snapshot); setErr("That change didn't save — you're offline."); }
    finally { setSaving(""); }
  }, [entries, month]);

  const saveIncome = useCallback(async (value) => {
    const manual_income = value === "" ? null : Number(value);
    const snapshot = months;
    setMonths(prev => [...prev.filter(m => m.month !== month), { month, manual_income }]);
    try {
      const r = await apiFetch("/api/budget/month", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, manual_income }),
      });
      if (!r.ok) { setMonths(snapshot); setErr("Income didn't save."); }
    } catch { setMonths(snapshot); setErr("Income didn't save — you're offline."); }
  }, [months, month]);

  // ── Render ───────────────────────────────────────────────
  if (loading) {
    return <Tile><div style={{ fontFamily: FM, fontSize: "var(--fs-sm)", color: TT.muted }}>Loading your budget…</div></Tile>;
  }
  if (demoMode) {
    return (
      <Tile accent={TT.gold}>
        <div style={{ fontFamily: FM, fontSize: "var(--fs-2xs)", color: TT.gold, letterSpacing: "0.16em", fontWeight: 600, marginBottom: TT.s2 }}>BUDGET</div>
        <div style={{ fontFamily: FP, fontSize: "var(--fs-md)", color: TT.muted, lineHeight: 1.55 }}>
          Budgets are tied to your own accounts, so they're hidden in demo mode. Turn demo off to set one up.
        </div>
      </Tile>
    );
  }

  const gaugeColor = cur.over ? TT.loss : paceColor(cur.pace);
  const monthNav = (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: TT.s2, marginBottom: TT.s4 }}>
      <button className="mz-tap" onClick={() => setMonth(prevMonth(month))} aria-label="Previous month"
        style={{ background: "transparent", border: `1px solid ${TT.border}`, borderRadius: TT.rSm, color: TT.text, cursor: "pointer", padding: `4px ${TT.s3}`, fontFamily: FM }}>‹</button>
      <span style={{ fontFamily: FM, fontSize: "var(--fs-xs)", color: TT.textHi, letterSpacing: "0.08em", minWidth: 130, textAlign: "center" }}>
        {monthLabel(month)}
      </span>
      <button className="mz-tap" onClick={() => setMonth(nextMonth(month))} aria-label="Next month"
        style={{ background: "transparent", border: `1px solid ${TT.border}`, borderRadius: TT.rSm, color: TT.text, cursor: "pointer", padding: `4px ${TT.s3}`, fontFamily: FM }}>›</button>
    </div>
  );

  /* The setup state. A budget nobody has set is not a $0 budget, and showing a
     gauge pinned at zero would report a plan the user never made. */
  const setupCard = (
    <Tile accent={TT.blue}>
      {monthNav}
      <div style={{ fontFamily: FM, fontSize: "var(--fs-2xs)", color: TT.blue, letterSpacing: "0.14em", fontWeight: 600, marginBottom: TT.s2 }}>
        SET YOUR MONTHLY BUDGET
      </div>
      <p style={{ fontFamily: FP, fontSize: "var(--fs-md)", color: TT.text, lineHeight: 1.6, margin: `0 0 ${TT.s4} 0` }}>
        One number: what you plan to spend this month, across everything. You can
        cap individual categories afterwards — anything you don't cap sits in
        <strong> Everything else</strong>, so the total always adds up.
      </p>
      <div className="mz-ctrl-row" style={{ display: "flex", gap: TT.s2, alignItems: "center", flexWrap: "wrap" }}>
        <input type="number" inputMode="decimal" min="0" step="0.01" className="field"
          style={{ width: 160 }} placeholder="e.g. 2750" autoFocus
          onKeyDown={e => { if (e.key === "Enter") setTotal(e.currentTarget.value); }}
          onBlur={e => e.target.value && setTotal(e.target.value)}
          aria-label="Monthly budget" />
        {suggestion.income > 0 && (
          <button className="mz-tap" onMouseDown={e => e.preventDefault()}
            onClick={() => setTotal(Math.round(suggestion.income * 0.8))}
            style={{
              fontFamily: FM, fontSize: "var(--fs-2xs)", color: TT.blue, background: "transparent",
              border: `1px solid ${TT.blue}44`, borderRadius: 999, padding: `4px ${TT.s3}`, cursor: "pointer",
            }}>
            use 80% of your ~{fmtUSD0(suggestion.income)} income
          </button>
        )}
      </div>
    </Tile>
  );

  const rail = (
    <Tile accent={gaugeColor} style={{ alignSelf: "start" }}>
      {monthNav}
      <Gauge
        pct={cur.pace?.pct ?? 0} color={gaugeColor} mask={mask}
        label={cur.over ? "OVERSPENT" : "LEFT TO SPEND"}
        amount={fmtUSD0(Math.abs(cur.left))}
        sub={`of ${mask(fmtUSD0(cur.available))} budget`}
      />

      {cur.carriedIn !== 0 && (
        <div style={{
          fontFamily: FM, fontSize: "var(--fs-2xs)", textAlign: "center", marginTop: TT.s2,
          color: cur.carriedIn < 0 ? TT.loss : TT.gain,
        }}>
          {cur.carriedIn < 0 ? "−" : "+"}{mask(fmtUSD0(Math.abs(cur.carriedIn)))} rolled over from {monthLabel(prevMonth(month)).split(" ")[0]}
        </div>
      )}

      <div style={{ marginTop: TT.s5 }}>
        <RailRow label="Spent so far" value={mask(fmtUSD0(cur.spent))} tone={cur.over ? TT.loss : TT.textHi} />
        <RailRow label="Monthly income" value={mask(fmtUSD0(cur.split.income)) || "—"} />
        <RailRow label="Left to save" pct={cur.split.savePct} value={mask(fmtUSD0(cur.split.save))} tone={TT.gain} />
        <RailRow label="Monthly budget" pct={cur.split.budgetPct} value={mask(fmtUSD0(cur.total))} />
      </div>

      <button className="mz-tap btn-ghost" onClick={() => setEditingPlan(v => !v)}
        style={{ width: "100%", marginTop: TT.s3 }}>
        {editingPlan ? "Done" : "Edit budget"}
      </button>

      {editingPlan && (
        <div style={{ marginTop: TT.s3, padding: TT.s3, background: TT.surface, border: `1px solid ${TT.border}`, borderRadius: TT.rMd, display: "flex", flexDirection: "column", gap: TT.s3 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontFamily: FM, fontSize: "var(--fs-2xs)", color: TT.muted, letterSpacing: "0.1em" }}>MONTHLY BUDGET</span>
            <input type="number" inputMode="decimal" min="0" step="0.01" className="field"
              defaultValue={inherited.total ?? ""} placeholder="e.g. 2750"
              onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
              onBlur={e => setTotal(e.target.value)} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontFamily: FM, fontSize: "var(--fs-2xs)", color: TT.muted, letterSpacing: "0.1em" }}>MONTHLY INCOME</span>
            <input type="number" inputMode="decimal" min="0" step="0.01" className="field"
              defaultValue={manualForMonth ?? ""}
              placeholder={bankLinked ? "auto from your accounts" : "e.g. 4500"}
              onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
              onBlur={e => saveIncome(e.target.value)} />
            {!bankLinked && manualForMonth === null && (
              <span style={{ fontFamily: FM, fontSize: "var(--fs-2xs)", color: TT.gold }}>
                No bank linked — enter what you earn to see your savings rate
              </span>
            )}
          </label>
          <button className="mz-tap" role="switch" aria-checked={plan.rollover}
            onClick={() => writePlan({ ...plan, rollover: !plan.rollover })}
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: TT.s3,
              background: "transparent", border: `1px solid ${plan.rollover ? TT.blue : TT.border}`,
              borderRadius: TT.rMd, padding: `${TT.s2} ${TT.s3}`, cursor: "pointer", textAlign: "left",
            }}>
            <span style={{ fontFamily: FP, fontSize: "var(--fs-sm)", color: TT.text }}>
              Roll unspent money over
              <span style={{ display: "block", fontFamily: FM, fontSize: "var(--fs-2xs)", color: TT.muted, marginTop: 2 }}>
                Leftovers add to next month — and overspend subtracts from it
              </span>
            </span>
            <span style={{
              fontFamily: FM, fontSize: "var(--fs-2xs)", fontWeight: 600, letterSpacing: "0.08em",
              color: plan.rollover ? TT.blue : TT.muted, whiteSpace: "nowrap",
            }}>{plan.rollover ? "ON" : "OFF"}</span>
          </button>
        </div>
      )}
    </Tile>
  );

  const renderRow = (r) => {
    const isOpen = open === r.category;
    const over = r.left < 0;
    const color = over ? TT.loss : paceColor(r.pace);
    const name = prettyCategory(r.category);
    return (
      <div key={r.category} style={{
        background: TT.surface, border: `1px solid ${over ? `${TT.loss}40` : TT.border}`,
        borderRadius: TT.rMd, padding: TT.s3,
        opacity: saving === r.category ? 0.6 : 1, transition: "opacity 150ms",
      }}>
        <button
          onClick={() => setOpen(isOpen ? "" : r.category)}
          aria-expanded={isOpen}
          disabled={r.isRemainder}
          className="mz-tap mz-brow"
          style={{
            width: "100%", background: "transparent", border: "none", padding: 0,
            textAlign: "left", cursor: r.isRemainder ? "default" : "pointer", color: "inherit",
          }}>
          <span className="mz-brow-top">
            <span aria-hidden="true" style={{
              flexShrink: 0, width: 30, height: 30, borderRadius: 999,
              display: "grid", placeItems: "center", background: `${TT.blue}12`,
              border: `1px solid ${TT.blue}22`, color: TT.blue,
              fontFamily: FM, fontSize: "var(--fs-sm)",
            }}>{categoryIcon(r.category)}</span>
            <span style={{
              flex: 1, minWidth: 0, fontFamily: FP, fontSize: "var(--fs-md)", fontWeight: 500,
              color: TT.textHi, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{name}</span>
          </span>
          {!r.isRemainder && (
            <span aria-hidden="true" className="mz-brow-chev"
              style={{ fontFamily: FM, fontSize: "var(--fs-xs)", color: TT.muted }}>
              {isOpen ? "⌄" : "›"}
            </span>
          )}
          <span className="mz-brow-amt" style={{ fontFamily: FM, fontSize: "var(--fs-xs)", fontVariantNumeric: "tabular-nums", color: TT.muted }}>
            <span style={{ color: over ? TT.loss : TT.textHi, fontWeight: 600 }}>{mask(fmtUSD0(r.spent))}</span> of {mask(fmtUSD0(r.limit))}
          </span>
        </button>

        <div style={{ marginTop: TT.s2 }}>
          <Bar pct={r.pace?.pct ?? 0} color={color} over={over} />
        </div>

        {r.pace?.state === "over-pace" && (
          <div style={{ fontFamily: FM, fontSize: "var(--fs-2xs)", color: TT.gold, marginTop: TT.s1 }}>
            on pace for {mask(fmtUSD0(r.pace.projected))}
          </div>
        )}
        {r.isRemainder && (
          <div style={{ fontFamily: FM, fontSize: "var(--fs-2xs)", color: TT.muted, marginTop: TT.s1 }}>
            everything without its own limit
          </div>
        )}

        {isOpen && (
          <div style={{ marginTop: TT.s3, paddingTop: TT.s3, borderTop: `1px solid ${TT.border}`, display: "flex", flexDirection: "column", gap: TT.s3 }}>
            <div className="mz-ctrl-row" style={{ display: "flex", gap: TT.s2, alignItems: "center", flexWrap: "wrap" }}>
              <label htmlFor={`mz-limit-${r.category}`} style={{ fontFamily: FM, fontSize: "var(--fs-2xs)", color: TT.muted, letterSpacing: "0.1em" }}>LIMIT</label>
              <input id={`mz-limit-${r.category}`} type="number" inputMode="decimal" min="0" step="0.01"
                className="field" style={{ width: 120, textAlign: "right" }} defaultValue={r.limit || ""}
                onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setOpen(""); }}
                onBlur={e => { const v = e.target.value === "" ? 0 : Number(e.target.value); if (v !== r.limit) saveLimit(r.category, v); }} />
              {suggestion.categories[r.category] > 0 && (
                <button type="button" onMouseDown={e => e.preventDefault()}
                  onClick={() => saveLimit(r.category, suggestion.categories[r.category])}
                  title={`Your ${suggestion.monthsUsed}-month average`}
                  style={{ fontFamily: FM, fontSize: "var(--fs-2xs)", color: TT.blue, background: "transparent", border: `1px solid ${TT.blue}44`, borderRadius: 999, padding: `3px ${TT.s2}`, cursor: "pointer", whiteSpace: "nowrap" }}>
                  typically {mask(fmtUSD0(suggestion.categories[r.category]))}
                </button>
              )}
              <button type="button" onMouseDown={e => e.preventDefault()}
                onClick={() => { saveLimit(r.category, 0); setOpen(""); }}
                style={{ fontFamily: FM, fontSize: "var(--fs-2xs)", color: TT.muted, background: "transparent", border: `1px solid ${TT.border}`, borderRadius: 999, padding: `3px ${TT.s2}`, cursor: "pointer", marginLeft: "auto" }}>
                Remove limit
              </button>
            </div>
            <div className="mz-ctrl-row" style={{ display: "flex", gap: TT.s2, alignItems: "center", flexWrap: "wrap" }}>
              <label htmlFor={`mz-rule-${r.category}`} style={{ fontFamily: FM, fontSize: "var(--fs-2xs)", color: TT.muted, letterSpacing: "0.1em" }}>SHOW AS</label>
              <input id={`mz-rule-${r.category}`} type="text" className="field" style={{ width: 160 }}
                placeholder={name} defaultValue={rules[r.category] || ""} list="mz-existing-categories"
                onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
                onBlur={e => saveRule(r.category, e.target.value)} />
              <label htmlFor={`mz-group-${r.category}`} style={{ fontFamily: FM, fontSize: "var(--fs-2xs)", color: TT.muted, letterSpacing: "0.1em" }}>GROUP</label>
              <input id={`mz-group-${r.category}`} type="text" className="field" style={{ width: 140 }}
                placeholder="none" defaultValue={groups[r.category] || ""} list="mz-existing-groups"
                onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
                onBlur={e => saveGroup(r.category, e.target.value)} />
            </div>
          </div>
        )}
      </div>
    );
  };

  const list = (
    <Tile>
      <datalist id="mz-existing-groups">
        {[...new Set(Object.values(groups).filter(Boolean))].map(g => <option key={g} value={g} />)}
      </datalist>
      <datalist id="mz-existing-categories">
        {rows.map(r => <option key={r.category} value={r.category} />)}
        {ISLAMIC_CATEGORY_PRESETS.map(p => <option key={p.category} value={p.category} />)}
      </datalist>

      <div className="mz-ctrl-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: TT.s2, marginBottom: TT.s3, flexWrap: "wrap" }}>
        <div style={{ fontFamily: FM, fontSize: "var(--fs-2xs)", color: TT.muted, letterSpacing: "0.16em", fontWeight: 600 }}>
          CATEGORY LIMITS · {rows.length}
        </div>
        <div className="mz-chip-row" style={{ display: "flex", gap: TT.s2, alignItems: "center", flexWrap: "wrap" }}>
          <label htmlFor="mz-budget-sort" style={{ fontFamily: FM, fontSize: "var(--fs-2xs)", color: TT.muted, letterSpacing: "0.1em" }}>SORT</label>
          <select id="mz-budget-sort" className="field" style={{ width: "auto" }} value={sort} onChange={e => setSort(e.target.value)}>
            <option value="spent">Most spent</option>
            <option value="name">A–Z</option>
            <option value="group">By group</option>
          </select>
          <button className="mz-tap btn-ghost" onClick={() => setAddingLimit(v => !v)}>
            {addingLimit ? "Cancel" : "+ Add limit"}
          </button>
        </div>
      </div>

      {cur.overAllocated && (
        <div role="alert" style={{
          fontFamily: FM, fontSize: "var(--fs-2xs)", color: TT.loss, background: `${TT.loss}12`,
          border: `1px solid ${TT.loss}40`, borderRadius: TT.rMd, padding: `${TT.s2} ${TT.s3}`, marginBottom: TT.s3, lineHeight: 1.5,
        }}>
          Your limits add up to {mask(fmtUSD0(cur.allocated))}, which is more than your {mask(fmtUSD0(cur.total))} budget.
          Raise the budget or lower a limit.
        </div>
      )}

      {addingLimit && (
        <div style={{ marginBottom: TT.s4, padding: TT.s3, background: TT.surface, border: `1px solid ${TT.border}`, borderRadius: TT.rMd }}>
          {uncapped.fromSpend.length > 0 && (
            <>
              <div style={{ fontFamily: FM, fontSize: "var(--fs-2xs)", color: TT.muted, letterSpacing: "0.1em", marginBottom: TT.s2 }}>
                WHERE YOUR MONEY WENT THIS MONTH
              </div>
              <div className="mz-chip-row" style={{ display: "flex", gap: TT.s2, flexWrap: "wrap", marginBottom: TT.s3 }}>
                {uncapped.fromSpend.map(c => (
                  <button key={c.category}
                    onClick={() => { setAddingLimit(false); saveLimit(c.category, Math.max(5, Math.round(c.spent / 5) * 5)); setOpen(c.category); }}
                    style={{ fontFamily: FM, fontSize: "var(--fs-xs)", padding: `5px ${TT.s3}`, borderRadius: 999, background: "transparent", border: `1px solid ${TT.border}`, color: TT.text, cursor: "pointer" }}>
                    {categoryIcon(c.category)} {prettyCategory(c.category)} · {mask(fmtUSD0(c.spent))}
                  </button>
                ))}
              </div>
            </>
          )}
          {uncapped.presets.length > 0 && (
            <>
              <div style={{ fontFamily: FM, fontSize: "var(--fs-2xs)", color: TT.muted, letterSpacing: "0.1em", marginBottom: TT.s2 }}>SUGGESTED</div>
              <div className="mz-chip-row" style={{ display: "flex", gap: TT.s2, flexWrap: "wrap", marginBottom: TT.s3 }}>
                {uncapped.presets.map(p => (
                  <button key={p.category} title={p.hint}
                    onClick={() => { setAddingLimit(false); saveLimit(p.category, suggestion.categories[p.category] || 50); setOpen(p.category); }}
                    style={{ fontFamily: FM, fontSize: "var(--fs-xs)", padding: `5px ${TT.s3}`, borderRadius: 999, background: "transparent", border: `1px solid ${TT.border}`, color: TT.text, cursor: "pointer" }}>
                    + {p.category}
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="mz-ctrl-row" style={{ display: "flex", gap: TT.s2, flexWrap: "wrap" }}>
            <input className="field" style={{ flex: 1, minWidth: 0 }} value={newCat}
              onChange={e => setNewCat(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && newCat.trim()) { saveLimit(newCat.trim(), 50); setNewCat(""); setAddingLimit(false); } }}
              placeholder="Or name your own" aria-label="New category name" />
            <button className="mz-tap btn-primary"
              onClick={() => { if (newCat.trim()) { saveLimit(newCat.trim(), 50); setNewCat(""); setAddingLimit(false); } }}>Add</button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: TT.s2 }}>
        {rows.length === 0 && (
          <div style={{ fontFamily: FP, fontSize: "var(--fs-md)", color: TT.muted, lineHeight: 1.55, padding: `${TT.s3} 0` }}>
            No category limits yet — your whole budget sits in <strong>Everything else</strong> below.
            Cap a category when you want to watch it specifically.
          </div>
        )}

        {grouped
          ? grouped.map(g => (
              <div key={g.name || "__ungrouped"} style={{ display: "flex", flexDirection: "column", gap: TT.s2 }}>
                {g.name && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: TT.s3, marginTop: TT.s2 }}>
                    <span style={{ fontFamily: FM, fontSize: "var(--fs-2xs)", color: TT.muted, letterSpacing: "0.14em", fontWeight: 600 }}>
                      {g.name.toUpperCase()}
                    </span>
                    <span style={{ fontFamily: FM, fontSize: "var(--fs-2xs)", color: TT.muted, fontVariantNumeric: "tabular-nums" }}>
                      {mask(fmtUSD0(Math.abs(g.spent)))} of {mask(fmtUSD0(g.budgeted))}
                    </span>
                  </div>
                )}
                {g.rows.map(renderRow)}
              </div>
            ))
          : rows.map(renderRow)}

        {cur.everythingElse && renderRow(cur.everythingElse)}
      </div>
    </Tile>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: TT.s4 }}>
      {err && (
        <div role="alert" style={{
          fontFamily: FM, fontSize: "var(--fs-xs)", color: TT.loss, background: `${TT.loss}12`,
          border: `1px solid ${TT.loss}40`, borderRadius: TT.rMd, padding: `${TT.s2} ${TT.s3}`,
        }}>{err}</div>
      )}
      {!cur.isSet ? setupCard : (
        /* Rail beside the list on a desktop, stacked on a phone. The columns
           live in THEME_CSS (.mz-budget-grid) — setting them inline here
           outranked the media query and pinned desktop to one column. */
        <div className="mz-budget-grid">
          {rail}
          {list}
        </div>
      )}
    </div>
  );
}
