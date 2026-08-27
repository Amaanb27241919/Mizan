import { useState, useEffect, useMemo, useCallback } from "react";
import { apiFetch } from "../lib/apiFetch.js";
import { useHideValues } from "../lib/useHideValues.js";
import { persistUserState } from "../lib/userState.js";
import {
  monthKey, prevMonth, nextMonth, spentByCategory, computeSeries,
  ISLAMIC_CATEGORY_PRESETS, paceStatus, suggestBudgets, groupCategories,
} from "../lib/envelope.js";

/* ─── ENVELOPE BUDGET ────────────────────────────────────
 * Zero-based budgeting: you can only assign money you actually have, and
 * every dollar gets a job. Ported from actualbudget/actual's model — see
 * src/lib/envelope.js for the math, which is pure and separately tested.
 *
 * This component is deliberately thin: it fetches, renders, and writes single
 * fields. Every number on screen is DERIVED by envelope.js from (budgeted,
 * carryover, transactions) — nothing computed here, nothing stored twice.
 *
 * HISTORY: the previous version of this file was a flat per-category cap with
 * no month dimension, and it was never mounted anywhere — 429 lines of dead
 * code that made CLAUDE.md's "Budget tab" claim false. It is replaced, not
 * extended, because rollover cannot be bolted onto a schema with no months.
 *
 * Tokens are an inline subset of MizanApp's `T`, kept local to avoid a
 * circular import with the 13k-line monolith (same pattern as CommandPalette).
 * ──────────────────────────────────────────────────────── */

const TT = {
  card:     "var(--mz-card)",
  border:   "var(--mz-border)",
  borderHi: "var(--mz-borderHi)",
  surface:  "var(--mz-surface)",
  text:     "var(--mz-text)",
  textHi:   "var(--mz-textHi)",
  muted:    "var(--mz-muted)",
  dim:      "var(--mz-dim)",
  gain:     "#117a52",  // jade — funded / under budget
  gold:     "#b8842a",  // amber — approaching the cap
  loss:     "#b23a3d",  // rust — overspent
  blue:     "#1e4e8c",  // navy — primary accent
  rSm: "var(--r-sm)", rMd: "var(--r-md)", rLg: "var(--r-lg)",
  s1: "var(--s-1)", s2: "var(--s-2)", s3: "var(--s-3)",
  s4: "var(--s-4)", s5: "var(--s-5)", s6: "var(--s-6)",
};
const FP = "'IBM Plex Sans',system-ui,-apple-system,BlinkMacSystemFont,sans-serif";
const FM = "'IBM Plex Mono','JetBrains Mono','Menlo','Monaco',monospace";
const FU = "'Fraunces',Georgia,serif";

const fmtUSD = v =>
  `${v < 0 ? "−" : ""}$${Math.abs(+v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthLabel = m => {
  const d = new Date(`${m}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? m
    : d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
};

/**
 * Where an envelope stands, as a bar the reader can scan without doing sums.
 *
 * Colour reflects PACE, not raw usage. 80% of a grocery budget spent on the 3rd
 * is an emergency and the same 80% on the 28th is fine; a plain spent/budgeted
 * ratio paints both amber and so states something the data does not support.
 * The projection lives in envelope.js (paceStatus) where it is tested; this
 * only maps a state to a token.
 *
 *   over       red     — already past the budget. A fact, not a forecast.
 *   over-pace  amber   — inside the budget, but this rate lands over by month end.
 *   under      green   — on track.
 *   unset      dim     — nothing budgeted, so there is nothing to miss.
 */
const PACE_COLOR = { over: TT.loss, "over-pace": TT.gold, under: TT.gain, unset: TT.dim };

function usage(spentAbs, budgeted, month, now) {
  const p = paceStatus({ spent: spentAbs, budgeted, month, now });
  return {
    pct: p.pct,
    color: PACE_COLOR[p.state] || TT.dim,
    over: p.state === "over",
    state: p.state,
    projected: p.projected,
  };
}

/**
 * A budget bar. Deliberately not a generic progress component — it renders the
 * OVERSPILL as a distinct segment past the track so "over by $40" is visible as
 * a shape, not only as red text you have to read.
 */
function Bar({ pct, color, over, height = 6 }) {
  return (
    <div
      role="presentation"
      style={{
        position: "relative", width: "100%", height, borderRadius: 999,
        background: "var(--mz-dim, rgba(0,0,0,0.08))", overflow: "hidden",
      }}
    >
      <div style={{
        width: `${Math.round(pct * 100)}%`, height: "100%", borderRadius: 999,
        background: color, transition: "width 220ms cubic-bezier(0.16,1,0.3,1)",
      }} />
      {/* A hatch on the last sliver when over, so overspend reads at a glance
          even for a reader who cannot distinguish the red from the green. */}
      {over && (
        <div style={{
          position: "absolute", top: 0, right: 0, height: "100%", width: 6,
          background: `repeating-linear-gradient(45deg, ${TT.loss}, ${TT.loss} 2px, transparent 2px, transparent 4px)`,
        }} />
      )}
    </div>
  );
}

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

export default function Budgeting({ txns = [], demoMode = false, bankLinked = false }) {
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const [entries, setEntries] = useState([]);      // [{month, category, budgeted, carryover}]
  const [months, setMonths] = useState([]);        // [{month, manual_income}]
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState("");        // category currently being written
  const [adding, setAdding] = useState(false);
  const [newCat, setNewCat] = useState("");
  const [editing, setEditing] = useState("");      // category whose amount is open for editing
  const [applying, setApplying] = useState(false); // seeding the budget from history

  // Category rules: { [merchantKeyOrProviderCategory]: "Your Category" }.
  // Plaid's taxonomy is not the user's, and until now its word was final — a
  // grocery run filed FOOD_AND_DRINK and a "Halal Food" envelope were two rows
  // that could never be merged. Synced (TRACKED_KEY) so a rule set on a laptop
  // holds on a phone.
  const [rules, setRules] = useState(() => {
    try { return JSON.parse(localStorage.getItem("mizan_category_rules") || "{}") || {}; }
    catch { return {}; }
  });
  // Category groups: { [category]: "Group name" }. Presentation only — see
  // groupCategories() in envelope.js for why the math stays per-category.
  const [groups, setGroups] = useState(() => {
    try { return JSON.parse(localStorage.getItem("mizan_category_groups") || "{}") || {}; }
    catch { return {}; }
  });
  const saveGroup = useCallback((category, group) => {
    const key = String(category || "").trim();
    const val = String(group || "").trim();
    if (!key) return;
    setGroups(prev => {
      const next = { ...prev };
      if (!val) delete next[key]; else next[key] = val;
      try { localStorage.setItem("mizan_category_groups", JSON.stringify(next)); } catch { /* quota */ }
      persistUserState("mizan_category_groups", next);
      return next;
    });
  }, []);

  const saveRule = useCallback((from, to) => {
    const key = String(from || "").trim();
    const val = String(to || "").trim();
    if (!key) return;
    setRules(prev => {
      const next = { ...prev };
      // Mapping a category to itself (or clearing it) removes the rule rather
      // than storing a no-op that later reads as an intentional choice.
      if (!val || val === key) delete next[key]; else next[key] = val;
      try { localStorage.setItem("mizan_category_rules", JSON.stringify(next)); } catch { /* quota */ }
      persistUserState("mizan_category_rules", next);
      return next;
    });
  }, []);

  // Budget figures are financial values and were the one surface that ignored
  // privacy mode — net worth and holdings masked, every envelope left on
  // screen. See CLAUDE.md §6: mask() belongs on every number a user can see.
  const { mask } = useHideValues();

  // ── Load the WHOLE history, not just this month ──────────
  // Envelope balances are path-dependent: each month's leftover feeds the next.
  // Fetching only the visible month would compute a plausible WRONG balance.
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
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [demoMode]);

  // ── Derive everything ────────────────────────────────────
  const allMonths = useMemo(() => {
    const set = new Set([...entries.map(e => e.month), ...months.map(m => m.month), month]);
    return [...set].filter(Boolean).sort();
  }, [entries, months, month]);

  const byMonth = useMemo(() => {
    const out = {};
    for (const m of allMonths) {
      out[m] = {
        entries: Object.fromEntries(
          entries.filter(e => e.month === m).map(e => [e.category, { budgeted: e.budgeted, carryover: e.carryover }]),
        ),
        spent: spentByCategory(txns, m, { rules }),
      };
    }
    return out;
  }, [allMonths, entries, txns]);

  // Income per month. Manual entry wins when present — it is the fallback for
  // the majority of users who have no bank linked. Otherwise derive from
  // inflow transactions (negative outflow convention means inflow is < 0 in
  // Plaid terms, so we sum the raw positive credits).
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
        return amt < 0 ? s + Math.abs(amt) : s;   // Plaid: credit is negative
      }, 0);
    }
    return out;
  }, [months, allMonths, txns]);

  const series = useMemo(
    () => computeSeries(allMonths, byMonth, incomeByMonth),
    [allMonths, byMonth, incomeByMonth],
  );
  const current = series[month] || { leftover: {}, toBudget: 0, income: 0, totalBudgeted: 0, overspent: 0 };
  const manualForMonth = months.find(m => m.month === month)?.manual_income ?? null;

  const rows = useMemo(() => {
    const cats = new Set([
      ...Object.keys(byMonth[month]?.entries || {}),
      ...Object.keys(byMonth[month]?.spent || {}),
    ]);
    const mapped = [...cats].sort().map(c => ({
      category: c,
      budgeted: byMonth[month]?.entries?.[c]?.budgeted ?? 0,
      carryover: !!byMonth[month]?.entries?.[c]?.carryover,
      spent: byMonth[month]?.spent?.[c] ?? 0,     // negative
      leftover: current.leftover?.[c] ?? 0,
    }));
    // Overspent categories float to the top — they are the only rows that need
    // a decision. Everything else stays ALPHABETICAL rather than sorted by
    // percentage used: a list that reorders while you are editing it is worse
    // than one you have to scan, and "over or not" flips rarely enough that the
    // top group is stable in practice.
    return mapped.sort((a, b) => (a.leftover < 0 ? 0 : 1) - (b.leftover < 0 ? 0 : 1)
      || a.category.localeCompare(b.category));
  }, [byMonth, month, current]);

  // A starting budget derived from what was actually spent. Deciding the
  // number is the hardest step and Mizan was asking users to invent every one
  // from nothing, which is why a blank budget stays blank. Copilot, Origin and
  // Monarch all seed from history; this is that, computed client-side from the
  // transactions the tab already has.
  const grouped = useMemo(() => groupCategories(rows, groups), [rows, groups]);
  const suggestion = useMemo(() => suggestBudgets(txns, { asOf: new Date() }), [txns]);
  const suggestedCount = Object.keys(suggestion.categories).length;

  // ── Writes ───────────────────────────────────────────────
  const saveEntry = useCallback(async (category, patch) => {
    const existing = entries.find(e => e.month === month && e.category === category);
    const body = {
      month, category,
      budgeted: patch.budgeted ?? existing?.budgeted ?? 0,
      carryover: patch.carryover ?? existing?.carryover ?? false,
    };
    // Optimistic: the user is typing, and a round-trip per keystroke would feel
    // broken. Rolled back below if the write fails.
    const snapshot = entries;
    setEntries(prev => {
      const rest = prev.filter(e => !(e.month === month && e.category === category));
      return [...rest, { ...body }];
    });
    setSaving(category);
    try {
      const r = await apiFetch("/api/budget/entry", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setEntries(snapshot);
        setErr(d?.error || "That change didn't save.");
      } else { setErr(""); }
    } catch {
      setEntries(snapshot);
      setErr("That change didn't save — you're offline.");
    } finally { setSaving(""); }
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

  /**
   * Write the suggested budget in one go.
   *
   * Sequential, not Promise.all: /api/budget/entry is a single-row PUT and a
   * dozen parallel writes against one user's rows is a burst the server has no
   * reason to absorb. This runs once, at setup, so the extra second is free.
   *
   * Deliberately does NOT overwrite a category the user has already budgeted —
   * seeding is a starting point, never a correction of a decision they made.
   */
  const applySuggestion = useCallback(async () => {
    setApplying(true); setErr("");
    try {
      const existing = new Set(
        entries.filter(e => e.month === month && Number(e.budgeted) > 0).map(e => e.category),
      );
      for (const [category, budgeted] of Object.entries(suggestion.categories)) {
        if (existing.has(category)) continue;
        const preset = ISLAMIC_CATEGORY_PRESETS.find(p => p.category.toLowerCase() === category.toLowerCase());
        await saveEntry(category, { budgeted, carryover: !!preset?.carryover });
      }
      // Only fill income if the user has not set one — same rule.
      if (manualForMonth === null && suggestion.income > 0 && !bankLinked) {
        await saveIncome(String(suggestion.income));
      }
    } finally {
      setApplying(false);
    }
  }, [entries, month, suggestion, saveEntry, saveIncome, manualForMonth, bankLinked]);

  const addCategory = useCallback(async (category, carryover = false) => {
    const name = (category || "").trim();
    if (!name) return;
    setAdding(false); setNewCat("");
    await saveEntry(name, { budgeted: 0, carryover });
  }, [saveEntry]);

  // ── Render ───────────────────────────────────────────────
  if (loading) {
    return <Tile><div style={{ fontFamily: FM, fontSize:"var(--fs-sm)", color: TT.muted }}>Loading your budget…</div></Tile>;
  }

  if (demoMode) {
    return (
      <Tile accent={TT.gold}>
        <div style={{ fontFamily: FM, fontSize:"var(--fs-2xs)", color: TT.gold, letterSpacing: "0.16em", fontWeight: 600, marginBottom: TT.s2 }}>BUDGET</div>
        <div style={{ fontFamily: FP, fontSize:"var(--fs-md)", color: TT.muted, lineHeight: 1.55 }}>
          Budgets are tied to your own accounts, so they're hidden in demo mode. Turn demo off to set one up.
        </div>
      </Tile>
    );
  }

  const toBudget = current.toBudget;
  const toBudgetColor = current.overAssigned ? TT.loss : current.isBalanced ? TT.gain : TT.blue;
  // Month-level usage: how much of what you ASSIGNED you have actually spent.
  // totalSpent is negative (outflow) — envelope.js's sign convention.
  const monthSpent = Math.abs(current.totalSpent || 0);
  const monthUse = usage(monthSpent, current.totalBudgeted || 0, month);
  const presetsToOffer = ISLAMIC_CATEGORY_PRESETS.filter(
    p => !rows.some(r => r.category.toLowerCase() === p.category.toLowerCase()),
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: TT.s4 }}>
      {err && (
        <div role="alert" style={{
          fontFamily: FM, fontSize:"var(--fs-xs)", color: TT.loss, background: `${TT.loss}12`,
          border: `1px solid ${TT.loss}40`, borderRadius: TT.rMd, padding: `${TT.s2} ${TT.s3}`,
        }}>{err}</div>
      )}

      {/* ── To Budget: the whole point of zero-based ── */}
      <Tile accent={toBudgetColor}>
        <div className="mz-ctrl-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: TT.s3, flexWrap: "wrap", marginBottom: TT.s3 }}>
          <div style={{ display: "flex", alignItems: "center", gap: TT.s2 }}>
            <button className="mz-tap" onClick={() => setMonth(prevMonth(month))} aria-label="Previous month"
              style={{ background: "transparent", border: `1px solid ${TT.border}`, borderRadius: TT.rSm, color: TT.text, cursor: "pointer", padding: `4px ${TT.s3}`, fontFamily: FM }}>‹</button>
            <span style={{ fontFamily: FM, fontSize:"var(--fs-xs)", color: TT.textHi, letterSpacing: "0.08em", minWidth: 120, textAlign: "center" }}>
              {monthLabel(month)}
            </span>
            <button className="mz-tap" onClick={() => setMonth(nextMonth(month))} aria-label="Next month"
              style={{ background: "transparent", border: `1px solid ${TT.border}`, borderRadius: TT.rSm, color: TT.text, cursor: "pointer", padding: `4px ${TT.s3}`, fontFamily: FM }}>›</button>
          </div>
          <div style={{ fontFamily: FM, fontSize:"var(--fs-2xs)", color: TT.muted, letterSpacing: "0.16em", fontWeight: 600 }}>TO BUDGET</div>
        </div>

        <div style={{ fontFamily: FU, fontSize:"var(--fs-5xl)", fontWeight: 700, color: toBudgetColor, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums" }}>
          {mask(fmtUSD(toBudget))}
        </div>
        <div style={{ fontFamily: FM, fontSize:"var(--fs-xs)", color: TT.muted, marginTop: TT.s1, lineHeight: 1.5 }}>
          {current.overAssigned
            ? "You've assigned more than you have. Take it back from a category."
            : current.isBalanced
              ? "Every dollar has a job."
              : "Still to assign — give it a job."}
          {current.overspent < 0 && (
            <> <span style={{ color: TT.loss }}>· {mask(fmtUSD(current.overspent))} covering last month's overspend</span></>
          )}
        </div>

        {/* Month at a glance. "To Budget" answers a planning question; this
            answers the one people actually open a budget app to ask — how much
            of the plan is left. Hidden until something is assigned, so a fresh
            month shows an empty state rather than a 0-of-0 bar. */}
        {current.totalBudgeted > 0 && (
          <div style={{ marginTop: TT.s4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: TT.s3, marginBottom: TT.s2 }}>
              <span style={{ fontFamily: FM, fontSize:"var(--fs-2xs)", color: TT.muted, letterSpacing: "0.12em", fontWeight: 600 }}>
                SPENT THIS MONTH
              </span>
              <span style={{ fontFamily: FM, fontSize:"var(--fs-xs)", color: TT.text, fontVariantNumeric: "tabular-nums" }}>
                {mask(fmtUSD(monthSpent))} <span style={{ color: TT.muted }}>of {mask(fmtUSD(current.totalBudgeted))}</span>
              </span>
            </div>
            <Bar pct={monthUse.pct} color={monthUse.color} over={monthUse.over} height={8} />
          </div>
        )}

        {/* Manual income — the path for users with no linked bank. */}
        <div style={{ marginTop: TT.s4, display: "flex", alignItems: "center", gap: TT.s2, flexWrap: "wrap" }}>
          <label htmlFor="mz-manual-income" style={{ fontFamily: FM, fontSize:"var(--fs-2xs)", color: TT.muted, letterSpacing: "0.1em" }}>
            INCOME THIS MONTH
          </label>
          <input id="mz-manual-income" type="number" inputMode="decimal" min="0" step="0.01"
            className="field" style={{ width: 140 }}
            placeholder={bankLinked ? "auto from bank" : "e.g. 4500"}
            defaultValue={manualForMonth ?? ""}
            onBlur={e => saveIncome(e.target.value)}
            aria-label="Income this month" />
          {manualForMonth === null && bankLinked && (
            <span style={{ fontFamily: FM, fontSize:"var(--fs-2xs)", color: TT.muted }}>
              using {fmtUSD(current.income)} from your linked accounts
            </span>
          )}
          {!bankLinked && manualForMonth === null && (
            <span style={{ fontFamily: FM, fontSize:"var(--fs-2xs)", color: TT.gold }}>
              No bank linked — enter what you earned to start budgeting
            </span>
          )}
        </div>
      </Tile>

      {/* ── Categories ── */}
      <Tile>
        {/* Offers existing names when merging, so "Halal Food" and "halal food"
            do not become two envelopes through a typo. */}
        {/* Existing group names, so grouping does not fragment on a typo. */}
        <datalist id="mz-existing-groups">
          {[...new Set(Object.values(groups).filter(Boolean))].map(g => <option key={g} value={g} />)}
        </datalist>
        <datalist id="mz-existing-categories">
          {rows.map(r => <option key={r.category} value={r.category} />)}
          {ISLAMIC_CATEGORY_PRESETS.map(p => <option key={p.category} value={p.category} />)}
        </datalist>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: TT.s3, marginBottom: TT.s3, flexWrap: "wrap" }}>
          <div style={{ fontFamily: FM, fontSize:"var(--fs-2xs)", color: TT.muted, letterSpacing: "0.16em", fontWeight: 600 }}>
            CATEGORIES · {rows.length}
          </div>
          <button className="mz-tap btn-ghost" onClick={() => setAdding(a => !a)}>
            {adding ? "Cancel" : "+ Add category"}
          </button>
        </div>

        {/* Seed from history. Shown only while nothing is assigned this month —
            once the user has made decisions, offering to fill the budget for
            them is noise at best and a threat to their work at worst.
            applySuggestion skips any category they have already set. */}
        {suggestedCount > 0 && current.totalBudgeted === 0 && (
          <div style={{
            marginBottom: TT.s4, padding: TT.s4, borderRadius: TT.rMd,
            background: `${TT.blue}0D`, border: `1px solid ${TT.blue}33`,
          }}>
            <div style={{ fontFamily: FM, fontSize:"var(--fs-2xs)", color: TT.blue, letterSpacing: "0.14em", fontWeight: 600, marginBottom: TT.s2 }}>
              START FROM YOUR SPENDING
            </div>
            <p style={{ fontFamily: FP, fontSize:"var(--fs-sm)", color: TT.text, lineHeight: 1.6, margin: `0 0 ${TT.s3} 0` }}>
              Deciding the numbers is the hard part. Based on the last{" "}
              {suggestion.monthsUsed === 1 ? "month" : `${suggestion.monthsUsed} months`} of your
              transactions, Mizan can set {suggestedCount} categor{suggestedCount === 1 ? "y" : "ies"} to
              what you typically spend. Adjust anything afterwards — these are a starting point, not a verdict.
            </p>
            <button className="mz-tap btn-primary" onClick={applySuggestion} disabled={applying}
              style={{ fontFamily: FM, fontSize:"var(--fs-xs)", fontWeight: 600, letterSpacing: "0.04em" }}>
              {applying ? "Setting up…" : "Use my averages"}
            </button>
          </div>
        )}

        {adding && (
          <div style={{ marginBottom: TT.s4, padding: TT.s3, background: TT.surface, border: `1px solid ${TT.border}`, borderRadius: TT.rMd }}>
            <div className="mz-ctrl-row" style={{ display: "flex", gap: TT.s2, flexWrap: "wrap", marginBottom: presetsToOffer.length ? TT.s3 : 0 }}>
              <input className="field" style={{ flex: 1, minWidth: 0 }} value={newCat}
                onChange={e => setNewCat(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") addCategory(newCat); }}
                placeholder="Category name" aria-label="New category name" />
              <button className="mz-tap btn-primary" onClick={() => addCategory(newCat)}>Add</button>
            </div>
            {presetsToOffer.length > 0 && (
              <>
                <div style={{ fontFamily: FM, fontSize:"var(--fs-2xs)", color: TT.muted, letterSpacing: "0.1em", marginBottom: TT.s2 }}>
                  SUGGESTED
                </div>
                <div className="mz-chip-row" style={{ display: "flex", gap: TT.s2, flexWrap: "wrap" }}>
                  {presetsToOffer.map(p => (
                    <button key={p.category} title={p.hint} onClick={() => addCategory(p.category, p.carryover)}
                      style={{
                        fontFamily: FM, fontSize:"var(--fs-xs)", padding: `5px ${TT.s3}`, borderRadius: 999,
                        background: "transparent", border: `1px solid ${TT.border}`, color: TT.text, cursor: "pointer",
                      }}>+ {p.category}</button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {rows.length === 0 ? (
          <div style={{ fontFamily: FP, fontSize:"var(--fs-md)", color: TT.muted, lineHeight: 1.55, padding: `${TT.s4} 0` }}>
            No categories yet. Add one above — or start with Sadaqah, Zakat and Halal Food.
          </div>
        ) : (
          /* Each envelope reads as a bar first and numbers second. The old
             layout put a permanent number input on every row, which made the
             screen a data-entry form: to see where you stood you had to read
             two figures per category and do the subtraction yourself. Editing
             is now behind a tap, so the default state is a status view. */
          <div style={{ display: "flex", flexDirection: "column", gap: TT.s4 }}>
            {grouped.map(g => (
            <div key={g.name || "__ungrouped"} style={{ display: "flex", flexDirection: "column", gap: TT.s2 }}>
            {/* Group header. Presentation only — the subtotal is always the sum
                of the rows beneath it, so it can never disagree with them. */}
            {g.name && (() => {
              const gSpent = Math.abs(g.spent);
              const gu = usage(gSpent, g.budgeted, month);
              return (
                <div style={{ marginTop: TT.s2 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: TT.s3, marginBottom: TT.s1 }}>
                    <span style={{ fontFamily: FM, fontSize:"var(--fs-2xs)", color: TT.muted, letterSpacing: "0.14em", fontWeight: 600 }}>
                      {g.name.toUpperCase()}
                    </span>
                    <span style={{ fontFamily: FM, fontSize:"var(--fs-2xs)", color: TT.muted, fontVariantNumeric: "tabular-nums" }}>
                      {mask(fmtUSD(gSpent))} of {mask(fmtUSD(g.budgeted))}
                    </span>
                  </div>
                  <Bar pct={gu.pct} color={gu.color} over={gu.over} height={4} />
                </div>
              );
            })()}
            {g.rows.map(r => {
              const spentAbs = Math.abs(r.spent);
              const u = usage(spentAbs, r.budgeted, month);
              const over = r.leftover < 0;
              const isEditing = editing === r.category;
              return (
                <div key={r.category} style={{
                  padding: `${TT.s3} ${TT.s3}`, background: TT.surface,
                  border: `1px solid ${over ? `${TT.loss}40` : TT.border}`, borderRadius: TT.rMd,
                  opacity: saving === r.category ? 0.6 : 1, transition: "opacity 150ms",
                }}>
                  {/* Row 1 — name, and the number that matters: what is left. */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: TT.s3, marginBottom: TT.s2 }}>
                    <span style={{ fontFamily: FP, fontSize:"var(--fs-md)", color: TT.textHi, fontWeight: 500, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.category}
                    </span>
                    <span style={{ fontFamily: FM, fontSize:"var(--fs-sm)", fontWeight: 600, color: over ? TT.loss : TT.textHi, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                      {mask(fmtUSD(Math.abs(r.leftover)))}
                      <span style={{ fontSize:"var(--fs-2xs)", fontWeight: 500, color: TT.muted, marginLeft: 4 }}>
                        {over ? "over" : "left"}
                      </span>
                    </span>
                  </div>

                  <Bar pct={u.pct} color={u.color} over={u.over} />

                  {/* Row 3 — the supporting arithmetic, deliberately quiet. */}
                  <div className="mz-ctrl-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: TT.s2, marginTop: TT.s2, flexWrap: "wrap" }}>
                    <span style={{ fontFamily: FM, fontSize:"var(--fs-2xs)", color: TT.muted, fontVariantNumeric: "tabular-nums" }}>
                      {mask(fmtUSD(spentAbs))} of {mask(fmtUSD(r.budgeted))}
                      {/* An amber bar that will not say why is just an alarm.
                          State the run-rate that produced it so the reader can
                          disagree with the projection rather than only obey it. */}
                      {u.state === "over-pace" && (
                        <span style={{ color: TT.gold }}> · on pace for {mask(fmtUSD(u.projected))}</span>
                      )}
                    </span>
                    <span style={{ display: "flex", gap: TT.s2, alignItems: "center" }}>
                      <button className="mz-tap"
                        onClick={() => saveEntry(r.category, { carryover: !r.carryover })}
                        title={r.carryover
                          ? "Overspending stays with this category next month"
                          : "Overspending is taken from next month's To Budget"}
                        aria-pressed={r.carryover}
                        style={{
                          fontFamily: FM, fontSize:"var(--fs-2xs)", letterSpacing: "0.06em", padding: `3px ${TT.s2}`,
                          borderRadius: 999, cursor: "pointer", whiteSpace: "nowrap",
                          background: r.carryover ? `${TT.blue}18` : "transparent",
                          border: `1px solid ${r.carryover ? TT.blue : TT.border}`,
                          color: r.carryover ? TT.blue : TT.muted,
                        }}>ROLL {r.carryover ? "ON" : "OFF"}</button>
                      {!isEditing && (
                        <button className="mz-tap" onClick={() => setEditing(r.category)}
                          aria-label={`Edit budget for ${r.category}`}
                          style={{
                            fontFamily: FM, fontSize:"var(--fs-2xs)", letterSpacing: "0.06em", padding: `3px ${TT.s2}`,
                            borderRadius: 999, cursor: "pointer", background: "transparent",
                            border: `1px solid ${TT.border}`, color: TT.muted, whiteSpace: "nowrap",
                          }}>EDIT</button>
                      )}
                    </span>
                  </div>

                  {isEditing && (
                    <div className="mz-ctrl-row" style={{ display: "flex", gap: TT.s2, alignItems: "center", marginTop: TT.s3, flexWrap: "wrap" }}>
                      <label htmlFor={`mz-budget-${r.category}`} style={{ fontFamily: FM, fontSize:"var(--fs-2xs)", color: TT.muted, letterSpacing: "0.1em" }}>
                        BUDGETED
                      </label>
                      <input id={`mz-budget-${r.category}`} type="number" inputMode="decimal" min="0" step="0.01"
                        className="field" style={{ width: 120, textAlign: "right" }}
                        defaultValue={r.budgeted || ""} autoFocus
                        onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setEditing(""); }}
                        onBlur={e => {
                          const v = e.target.value === "" ? 0 : Number(e.target.value);
                          if (v !== r.budgeted) saveEntry(r.category, { budgeted: v });
                          setEditing("");
                        }}
                        aria-label={`Budget for ${r.category}`} />
                      {/* Origin surfaces the historical average while you set a
                          target, which is the difference between choosing a
                          number and guessing one. Only shown when there is real
                          history behind it. */}
                      {suggestion.categories[r.category] > 0 && (
                        <button type="button"
                          onMouseDown={e => e.preventDefault()}   /* keep focus so onBlur still commits */
                          onClick={() => { saveEntry(r.category, { budgeted: suggestion.categories[r.category] }); setEditing(""); }}
                          title={`Set to your ${suggestion.monthsUsed}-month average`}
                          style={{
                            fontFamily: FM, fontSize:"var(--fs-2xs)", color: TT.blue, background: "transparent",
                            border: `1px solid ${TT.blue}44`, borderRadius: 999, padding: `3px ${TT.s2}`,
                            cursor: "pointer", whiteSpace: "nowrap",
                          }}>
                          typically {mask(fmtUSD(suggestion.categories[r.category]))}
                        </button>
                      )}
                    </div>
                  )}

                  {/* Recategorise. Plaid's taxonomy is not the user's: a grocery
                      run filed FOOD_AND_DRINK and a "Halal Food" envelope were
                      two rows that could never be merged, which is the gap you
                      feel daily against Copilot and Origin. Typing a name here
                      remaps EVERY transaction the provider files under this
                      category, past and future — the rule is stored, not the
                      result, so re-syncing cannot undo it. */}
                  {isEditing && (
                    <div className="mz-ctrl-row" style={{ display: "flex", gap: TT.s2, alignItems: "center", marginTop: TT.s2, flexWrap: "wrap" }}>
                      <label htmlFor={`mz-rule-${r.category}`} style={{ fontFamily: FM, fontSize:"var(--fs-2xs)", color: TT.muted, letterSpacing: "0.1em" }}>
                        SHOW AS
                      </label>
                      <input id={`mz-rule-${r.category}`} type="text" className="field"
                        style={{ width: 180 }} placeholder={r.category}
                        defaultValue={rules[r.category] || ""}
                        list="mz-existing-categories"
                        onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setEditing(""); }}
                        onBlur={e => saveRule(r.category, e.target.value)}
                        aria-label={`Show ${r.category} as a different category`} />
                      <span style={{ fontFamily: FM, fontSize:"var(--fs-2xs)", color: TT.muted }}>
                        {rules[r.category] ? "every transaction here is remapped" : "merge into another category"}
                      </span>
                    </div>
                  )}

                  {/* Grouping. Past about eight envelopes a flat list stops
                      being scannable, which is why every mainstream app groups.
                      Presentation only — the subtotal is the sum of its rows,
                      so a group can never disagree with its children. */}
                  {isEditing && (
                    <div className="mz-ctrl-row" style={{ display: "flex", gap: TT.s2, alignItems: "center", marginTop: TT.s2, flexWrap: "wrap" }}>
                      <label htmlFor={`mz-group-${r.category}`} style={{ fontFamily: FM, fontSize:"var(--fs-2xs)", color: TT.muted, letterSpacing: "0.1em" }}>
                        GROUP
                      </label>
                      <input id={`mz-group-${r.category}`} type="text" className="field"
                        style={{ width: 180 }} placeholder="none"
                        defaultValue={groups[r.category] || ""}
                        list="mz-existing-groups"
                        onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setEditing(""); }}
                        onBlur={e => saveGroup(r.category, e.target.value)}
                        aria-label={`Group for ${r.category}`} />
                      <span style={{ fontFamily: FM, fontSize:"var(--fs-2xs)", color: TT.muted }}>
                        e.g. Food, Giving, Home
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
            </div>
            ))}
          </div>
        )}
      </Tile>
    </div>
  );
}
