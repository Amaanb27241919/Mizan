import { useState, useEffect, useMemo, useCallback } from "react";
import { apiFetch } from "../lib/apiFetch.js";
import {
  monthKey, prevMonth, nextMonth, spentByCategory, computeSeries,
  ISLAMIC_CATEGORY_PRESETS,
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
        spent: spentByCategory(txns, m),
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
    return [...cats].sort().map(c => ({
      category: c,
      budgeted: byMonth[month]?.entries?.[c]?.budgeted ?? 0,
      carryover: !!byMonth[month]?.entries?.[c]?.carryover,
      spent: byMonth[month]?.spent?.[c] ?? 0,     // negative
      leftover: current.leftover?.[c] ?? 0,
    }));
  }, [byMonth, month, current]);

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
          {fmtUSD(toBudget)}
        </div>
        <div style={{ fontFamily: FM, fontSize:"var(--fs-xs)", color: TT.muted, marginTop: TT.s1, lineHeight: 1.5 }}>
          {current.overAssigned
            ? "You've assigned more than you have. Take it back from a category."
            : current.isBalanced
              ? "Every dollar has a job."
              : "Still to assign — give it a job."}
          {current.overspent < 0 && (
            <> <span style={{ color: TT.loss }}>· {fmtUSD(current.overspent)} covering last month's overspend</span></>
          )}
        </div>

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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: TT.s3, marginBottom: TT.s3, flexWrap: "wrap" }}>
          <div style={{ fontFamily: FM, fontSize:"var(--fs-2xs)", color: TT.muted, letterSpacing: "0.16em", fontWeight: 600 }}>
            CATEGORIES · {rows.length}
          </div>
          <button className="mz-tap btn-ghost" onClick={() => setAdding(a => !a)}>
            {adding ? "Cancel" : "+ Add category"}
          </button>
        </div>

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
          <div style={{ display: "flex", flexDirection: "column", gap: TT.s2 }}>
            {rows.map(r => {
              const over = r.leftover < 0;
              return (
                <div key={r.category} style={{
                  display: "grid", gridTemplateColumns: "1fr auto auto", gap: TT.s3, alignItems: "center",
                  padding: `${TT.s2} ${TT.s3}`, background: TT.surface,
                  border: `1px solid ${over ? `${TT.loss}40` : TT.border}`, borderRadius: TT.rMd,
                }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: FP, fontSize:"var(--fs-md)", color: TT.textHi, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.category}
                    </div>
                    <div style={{ fontFamily: FM, fontSize:"var(--fs-2xs)", color: TT.muted, marginTop: 2 }}>
                      spent {fmtUSD(Math.abs(r.spent))} ·{" "}
                      <span style={{ color: over ? TT.loss : TT.gain }}>
                        {over ? "over by " : "left "}{fmtUSD(Math.abs(r.leftover))}
                      </span>
                    </div>
                  </div>
                  <input type="number" inputMode="decimal" min="0" step="0.01" className="field"
                    style={{ width: 104, textAlign: "right" }}
                    defaultValue={r.budgeted || ""}
                    onBlur={e => {
                      const v = e.target.value === "" ? 0 : Number(e.target.value);
                      if (v !== r.budgeted) saveEntry(r.category, { budgeted: v });
                    }}
                    aria-label={`Budget for ${r.category}`} />
                  <button className="mz-tap"
                    onClick={() => saveEntry(r.category, { carryover: !r.carryover })}
                    title={r.carryover
                      ? "Overspending stays with this category next month"
                      : "Overspending is taken from next month's To Budget"}
                    aria-pressed={r.carryover}
                    style={{
                      fontFamily: FM, fontSize:"var(--fs-2xs)", letterSpacing: "0.06em", padding: `4px ${TT.s2}`,
                      borderRadius: 999, cursor: "pointer", whiteSpace: "nowrap",
                      background: r.carryover ? `${TT.blue}18` : "transparent",
                      border: `1px solid ${r.carryover ? TT.blue : TT.border}`,
                      color: r.carryover ? TT.blue : TT.muted,
                      opacity: saving === r.category ? 0.5 : 1,
                    }}>ROLL {r.carryover ? "ON" : "OFF"}</button>
                </div>
              );
            })}
          </div>
        )}
      </Tile>
    </div>
  );
}
