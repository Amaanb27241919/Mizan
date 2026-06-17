import React, { useState, useEffect, useMemo, useCallback } from "react";
import { apiFetch } from "../lib/apiFetch.js";

/* ─── BUDGETING ──────────────────────────────────────────
 * Per-category monthly spending caps with actual-vs-budget
 * progress bars. Mirrors the visual language of MizanApp's
 * "SPENDING BY CATEGORY" tile but adds editable limits and
 * percentage tracking.
 *
 * Tokens are an inline subset of MizanApp's `T` and font
 * stacks — kept here to avoid coupling this file to
 * MizanApp.jsx and the circular-import risk that comes with
 * importing from a 6000-line module. (Same pattern Skeleton.jsx
 * uses.) When MizanApp eventually exports T/FM/FU, swap to the
 * import.
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
  gain:     "#6fae8e",  // jade — under budget, healthy
  gold:     "#cf9e54",  // amber — approaching cap
  loss:     "#c46a52",  // rust — over cap
  blue:     "#c9a24b",  // gold — primary accent
  rSm:      "var(--r-sm)",
  rMd:      "var(--r-md)",
  rLg:      "var(--r-lg)",
  s1:       "var(--s-1)",
  s2:       "var(--s-2)",
  s3:       "var(--s-3)",
  s4:       "var(--s-4)",
  s5:       "var(--s-5)",
  s6:       "var(--s-6)",
  shadow:   "var(--mz-shadow)",
};
const FP = "'IBM Plex Sans',system-ui,-apple-system,BlinkMacSystemFont,sans-serif";
const FM = "'IBM Plex Mono','JetBrains Mono','Menlo','Monaco',monospace";
const FU = FP;

const fmtUSD = v => `$${(+v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Pick the progress-bar color based on actual / limit ratio. Mirrors
// the three semantic tokens already used elsewhere in MizanApp.
function progressColor(pct) {
  if (pct > 100) return TT.loss;
  if (pct >= 80) return TT.gold;
  return TT.gain;
}

// Inline BentoTile clone — same shape as MizanApp's, kept local to
// avoid the circular import. If MizanApp exports BentoTile later,
// swap to the import.
function Tile({ children, accent, style }) {
  return (
    <div
      className="bento-tile"
      style={{
        background: TT.card,
        border: `1px solid ${TT.border}`,
        borderTop: accent ? `2px solid ${accent}` : `1px solid ${TT.border}`,
        borderLeft: accent ? `1px solid ${accent}30` : `1px solid ${TT.border}`,
        borderRadius: TT.rLg,
        padding: `${TT.s5} ${TT.s5}`,
        boxShadow: "var(--sh-md)",
        position: "relative",
        overflow: "hidden",
        transition: "transform 0.18s cubic-bezier(.34,1.56,.64,1), box-shadow 0.2s, border-color 0.2s",
        ...(style || {}),
      }}
    >
      {children}
    </div>
  );
}

export default function Budgeting({ txns = [], demoMode = false }) {
  const [budgets, setBudgets] = useState([]);   // [{category, monthly_limit, currency}]
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [adding, setAdding] = useState(false);
  const [newCat, setNewCat] = useState("");
  const [newLimit, setNewLimit] = useState("");

  // ── Load budgets on mount ────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // In demo mode we don't hit the API — start with a small
      // suggested fixture so the UI still has something to render.
      if (demoMode) {
        setBudgets([
          { category: "FOOD_AND_DRINK",  monthly_limit: 400, currency: "USD" },
          { category: "TRANSPORTATION",  monthly_limit: 200, currency: "USD" },
          { category: "ENTERTAINMENT",   monthly_limit: 150, currency: "USD" },
        ]);
        setLoading(false);
        return;
      }
      try {
        // apiFetch returns a Response; parse JSON explicitly. Earlier draft
        // treated `r` as already-parsed and silently set an empty list.
        const r = await apiFetch("/api/budgets");
        if (cancelled) return;
        if (!r.ok) {
          // 503 + hint:"MIGRATION_PENDING" → table not provisioned yet.
          if (r.status === 503) {
            const body = await r.json().catch(() => ({}));
            if (body?.hint === "MIGRATION_PENDING") {
              setErr({ pending: true, migration: body.migration || "013_budgets.sql" });
              setBudgets([]);
              return;
            }
          }
          if (r.status === 401) { setBudgets([]); return; }
          throw new Error(`HTTP ${r.status}`);
        }
        const json = await r.json();
        const list = Array.isArray(json?.budgets) ? json.budgets : [];
        setBudgets(list.map(b => ({
          category:      b.category,
          monthly_limit: Number(b.monthly_limit) || 0,
          currency:      b.currency || "USD",
        })));
      } catch (e) {
        if (!cancelled) setErr(e?.message || "Failed to load budgets");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [demoMode]);

  // ── Spent-this-month per category ────────────────────
  // Sum outflows (amount > 0) whose date is in the current calendar
  // month AND whose Plaid personal_finance_category.primary matches.
  const spentByCat = useMemo(() => {
    const firstOfMonth = new Date();
    firstOfMonth.setDate(1);
    firstOfMonth.setHours(0, 0, 0, 0);
    const monthStart = firstOfMonth.toISOString().slice(0, 10);
    const out = {};
    for (const t of (txns || [])) {
      if (!t || typeof t.amount !== "number" || t.amount <= 0) continue;
      if (!t.date || t.date < monthStart) continue;
      const cat = t.personal_finance_category?.primary;
      if (!cat) continue;
      out[cat] = (out[cat] || 0) + t.amount;
    }
    return out;
  }, [txns]);

  // ── Categories the user could add a cap to (present this month
  //    in txns but not yet budgeted). Sorted by spend desc so the
  //    biggest line items surface first. ─────────────────────────
  const addableCats = useMemo(() => {
    const budgeted = new Set(budgets.map(b => b.category));
    return Object.entries(spentByCat)
      .filter(([cat]) => !budgeted.has(cat))
      .sort((a, b) => b[1] - a[1])
      .map(([cat]) => cat);
  }, [spentByCat, budgets]);

  // ── Totals for the top tile ──────────────────────────
  const totals = useMemo(() => {
    let spent = 0;
    let budgeted = 0;
    for (const b of budgets) {
      spent += spentByCat[b.category] || 0;
      budgeted += b.monthly_limit;
    }
    return { spent, budgeted, count: budgets.length };
  }, [budgets, spentByCat]);

  // ── Persist a single budget. limit <= 0 / null deletes the row.
  const saveBudget = useCallback(async (category, limit) => {
    const numeric = limit === "" || limit === null || limit === undefined ? null : Number(limit);
    const isDelete = !Number.isFinite(numeric) || numeric <= 0;

    // Optimistic local update first.
    setBudgets(prev => {
      if (isDelete) return prev.filter(b => b.category !== category);
      const existing = prev.find(b => b.category === category);
      if (existing) {
        return prev.map(b => b.category === category ? { ...b, monthly_limit: numeric } : b);
      }
      return [...prev, { category, monthly_limit: numeric, currency: "USD" }];
    });

    if (demoMode) return;
    try {
      await apiFetch("/api/budgets", {
        method: "PUT",
        body: JSON.stringify({ category, monthly_limit: isDelete ? null : numeric }),
        headers: { "Content-Type": "application/json" },
      });
    } catch (e) {
      setErr(e?.message || "Failed to save budget");
    }
  }, [demoMode]);

  // ── Add-category flow ────────────────────────────────
  const submitAdd = useCallback(async () => {
    const cat = newCat.trim();
    const lim = Number(newLimit);
    if (!cat || !Number.isFinite(lim) || lim <= 0) return;
    await saveBudget(cat, lim);
    setNewCat("");
    setNewLimit("");
    setAdding(false);
  }, [newCat, newLimit, saveBudget]);

  // ── Render ───────────────────────────────────────────
  if (loading) {
    return (
      <Tile>
        <div style={{ fontFamily: FM, fontSize: 10, color: TT.muted, letterSpacing: "0.16em", fontWeight: 600 }}>
          BUDGETS · LOADING…
        </div>
      </Tile>
    );
  }

  const sortedBudgets = [...budgets].sort((a, b) => a.category.localeCompare(b.category));

  return (
    <Tile>
      {/* Header tile */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: TT.s4, flexWrap: "wrap", gap: TT.s2 }}>
        <span style={{ fontFamily: FM, fontSize: 10, color: TT.muted, letterSpacing: "0.16em", fontWeight: 600 }}>
          BUDGETS · {totals.count} {totals.count === 1 ? "category" : "categories"} · {fmtUSD(totals.spent)} spent / {fmtUSD(totals.budgeted)} budgeted this month
        </span>
        {!adding && addableCats.length > 0 && (
          <button
            type="button"
            onClick={() => { setAdding(true); setNewCat(addableCats[0] || ""); setNewLimit(""); }}
            style={{
              fontFamily: FM, fontSize: 11, color: TT.textHi, letterSpacing: "0.06em",
              padding: `${TT.s2} ${TT.s3}`, borderRadius: TT.rSm,
              background: "transparent", border: `1px solid ${TT.borderHi}`,
              cursor: "pointer", fontWeight: 600,
            }}
          >
            + Add category
          </button>
        )}
      </div>

      {err && err.pending ? (
        <div style={{
          fontFamily: FU, fontSize: 12, color: TT.gold,
          padding: TT.s3, marginBottom: TT.s3,
          background: `${TT.gold}12`, border: `1px solid ${TT.gold}40`, borderRadius: TT.rMd,
          lineHeight: 1.5,
        }}>
          <strong style={{ fontFamily: FM, fontSize: 10, letterSpacing: "0.16em", color: TT.gold, display: "block", marginBottom: TT.s1 }}>SETUP PENDING</strong>
          Budgets table not provisioned yet. Apply <code style={{ fontFamily: FM, background: `${TT.gold}22`, padding: "1px 6px", borderRadius: 3 }}>{err.migration}</code> in the Supabase SQL editor and refresh.
        </div>
      ) : err && (
        <div style={{ fontFamily: FM, fontSize: 11, color: TT.loss, marginBottom: TT.s3 }}>
          {typeof err === "string" ? err : (err.message || "Failed to load budgets")}
        </div>
      )}

      {/* Inline picker for adding a new budget */}
      {adding && (
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 120px auto auto", gap: TT.s2,
          alignItems: "center", marginBottom: TT.s4,
          padding: TT.s3, borderRadius: TT.rMd, background: TT.surface, border: `1px solid ${TT.border}`,
        }}>
          <select
            value={newCat}
            onChange={e => setNewCat(e.target.value)}
            style={{
              fontFamily: FU, fontSize: 13, color: TT.text,
              padding: `${TT.s2} ${TT.s3}`, borderRadius: TT.rSm,
              background: TT.card, border: `1px solid ${TT.border}`,
            }}
          >
            {addableCats.length === 0 && <option value="">No categories available</option>}
            {addableCats.map(c => (
              <option key={c} value={c}>{c.replace(/_/g, " ")}</option>
            ))}
          </select>
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="Monthly cap"
            value={newLimit}
            onChange={e => setNewLimit(e.target.value)}
            style={{
              fontFamily: FM, fontSize: 13, color: TT.text,
              padding: `${TT.s2} ${TT.s3}`, borderRadius: TT.rSm,
              background: TT.card, border: `1px solid ${TT.border}`,
              fontVariantNumeric: "tabular-nums",
            }}
          />
          <button
            type="button"
            onClick={submitAdd}
            disabled={!newCat || !Number.isFinite(Number(newLimit)) || Number(newLimit) <= 0}
            style={{
              fontFamily: FM, fontSize: 11, color: "#FFFFFF", letterSpacing: "0.06em",
              padding: `${TT.s2} ${TT.s4}`, borderRadius: TT.rSm,
              background: TT.blue, border: `1px solid ${TT.blue}`,
              cursor: "pointer", fontWeight: 600,
              opacity: (!newCat || !Number.isFinite(Number(newLimit)) || Number(newLimit) <= 0) ? 0.5 : 1,
            }}
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => { setAdding(false); setNewCat(""); setNewLimit(""); }}
            style={{
              fontFamily: FM, fontSize: 11, color: TT.muted, letterSpacing: "0.06em",
              padding: `${TT.s2} ${TT.s3}`, borderRadius: TT.rSm,
              background: "transparent", border: `1px solid ${TT.border}`,
              cursor: "pointer", fontWeight: 600,
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Per-category rows */}
      {sortedBudgets.length === 0 && !adding && (
        <div style={{ fontFamily: FM, fontSize: 12, color: TT.muted, padding: `${TT.s4} 0` }}>
          No budgets yet.{addableCats.length > 0 ? " Click + Add category to set your first cap." : ""}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: TT.s3 }}>
        {sortedBudgets.map(b => {
          const spent = spentByCat[b.category] || 0;
          const limit = b.monthly_limit;
          const pct = limit > 0 ? (spent / limit) * 100 : 0;
          const barPct = Math.min(pct, 100);
          const color = progressColor(pct);

          return (
            <div key={b.category} style={{
              display: "grid",
              gridTemplateColumns: "minmax(140px, 180px) 1fr 180px 100px 32px",
              gap: TT.s3,
              alignItems: "center",
            }}>
              <span style={{ fontFamily: FU, fontSize: 13, color: TT.text, letterSpacing: "-0.005em" }}>
                {b.category.replace(/_/g, " ")}
              </span>

              <div style={{ height: 8, background: TT.dim, borderRadius: 2, overflow: "hidden" }}>
                <div style={{
                  height: "100%",
                  width: `${barPct}%`,
                  background: color,
                  borderRadius: 2,
                  transition: "width 0.24s ease-out, background 0.24s",
                }} />
              </div>

              <span style={{
                fontFamily: FM, fontSize: 12, color: TT.textHi, fontWeight: 500,
                fontVariantNumeric: "tabular-nums", textAlign: "right",
              }}>
                {fmtUSD(spent)}
                <span style={{ color: TT.muted, fontWeight: 400 }}> / </span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={limit}
                  aria-label={`${b.category.replace(/_/g, " ")} monthly limit`}
                  onBlur={e => {
                    const v = e.target.value;
                    const n = Number(v);
                    if (v === "" || !Number.isFinite(n) || n <= 0) {
                      saveBudget(b.category, null);
                    } else if (n !== limit) {
                      saveBudget(b.category, n);
                    }
                  }}
                  onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
                  style={{
                    width: 80,
                    fontFamily: FM, fontSize: 12, color: TT.textHi, fontWeight: 500,
                    padding: `${TT.s1} ${TT.s2}`, borderRadius: TT.rSm,
                    background: TT.surface, border: `1px solid ${TT.border}`,
                    fontVariantNumeric: "tabular-nums",
                    textAlign: "right",
                  }}
                />
              </span>

              <span style={{
                fontFamily: FU, fontSize: 13, fontWeight: 600,
                color, fontVariantNumeric: "tabular-nums", textAlign: "right",
              }}>
                {pct.toFixed(0)}%
              </span>

              <button
                type="button"
                onClick={() => saveBudget(b.category, null)}
                title="Remove this budget"
                aria-label={`Remove ${b.category.replace(/_/g, " ")} budget`}
                style={{
                  fontFamily: FM, fontSize: 14, color: TT.muted,
                  background: "transparent", border: "none", cursor: "pointer",
                  lineHeight: 1, padding: 0,
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </Tile>
  );
}
