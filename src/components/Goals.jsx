// Goals — savings goals tied to specific accounts or to net-worth.
// Renders per-goal cards with a progress bar and a projected completion
// date based on the last 30 days of trajectory (linear regression on
// the relevant series). Supports three track modes:
//   - account   → sum of current balance across selected accounts
//   - networth  → most recent total from netWorthHistory
//   - manual    → user-entered manual_progress column
//
// Backed by /api/goals (GET/POST/PUT/DELETE).
// Named exports: GoalsOverviewWidget (used by Overview tab)
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/apiFetch.js";
import { Icon } from "./Icon.jsx";

// Reuse the global theme tokens by reading the CSS custom properties so
// this file stays decoupled from MizanApp's `T`/`FU`/`FM` constants. The
// values resolve to the same dark/light surfaces.
const T = {
  bg: "var(--mz-bg)", card: "var(--mz-card)", surface: "var(--mz-surface)",
  border: "var(--mz-border)", borderHi: "var(--mz-borderHi)",
  text: "var(--mz-text)", textHi: "var(--mz-textHi)", muted: "var(--mz-muted)",
  blue: "#1e4e8c", gain: "#117a52", gold: "#b8842a", loss: "#b23a3d",
  s1: "var(--s-1)", s2: "var(--s-2)", s3: "var(--s-3)", s4: "var(--s-4)",
  s5: "var(--s-5)", s6: "var(--s-6)", s8: "var(--s-8)",
  rSm: "var(--r-sm)", rMd: "var(--r-md)", rLg: "var(--r-lg)",
};
const FP = "'IBM Plex Sans',system-ui,-apple-system,BlinkMacSystemFont,sans-serif";
const FM = "'IBM Plex Mono','JetBrains Mono','Menlo','Monaco',monospace";
const FU = FP;

const fmtUSD = (v) => `$${(+v || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const fmtDate = (s) => {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch { return String(s); }
};

// ── Islamic goal templates ───────────────────────────────────────────────────
// Pre-filled defaults users can choose before the blank form.
// `target: null` means "compute at render time" (Emergency Fund uses
// avgMonthlySpend × 4, falling back to 15000 when spend data isn't ready).
const TEMPLATES = [
  { id: "hajj",      icon: "kaaba",  name: "Hajj Fund",         target: 10000, note: null },
  { id: "umrah",     icon: "moon",   name: "Umrah Fund",         target: 4000,  note: null },
  { id: "home",      icon: "home",   name: "Home Down Payment",  target: 60000,
    note: "Consider a halal financing structure (Ijara/Murabaha) vs. a conventional mortgage" },
  { id: "emergency", icon: "shield", name: "Emergency Fund",     target: null,
    note: "3-6 months of expenses. Suggested target is 4× your avg monthly spend." },
  { id: "education", icon: "book",   name: "Education Fund",     target: 20000, note: null },
  { id: "custom",    icon: "pencil", name: "Custom",             target: null,  note: null },
];

function TemplatePicker({ avgMonthlySpend, onPick, onCancel }) {
  return (
    <div style={{
      background: T.card,
      border: `1px solid ${T.borderHi}`,
      borderRadius: T.rLg,
      padding: T.s5,
      display: "flex", flexDirection: "column", gap: T.s4,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontFamily: FM, fontSize: 11, color: T.muted, letterSpacing: "0.18em", fontWeight: 600 }}>
          CHOOSE A TEMPLATE
        </div>
        <button onClick={onCancel} style={ghostBtnStyle}>Cancel</button>
      </div>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
        gap: T.s3,
      }}>
        {TEMPLATES.map((tmpl) => {
          const suggestedTarget = tmpl.id === "emergency"
            ? (avgMonthlySpend > 0 ? Math.round(avgMonthlySpend * 4 / 100) * 100 : 15000)
            : tmpl.target;
          return (
            <button
              key={tmpl.id}
              onClick={() => onPick({ ...tmpl, target: suggestedTarget })}
              style={{
                display: "flex", flexDirection: "column", gap: T.s2,
                background: T.surface,
                border: `1px solid ${T.border}`,
                borderRadius: T.rMd,
                padding: T.s4,
                cursor: "pointer",
                textAlign: "left",
                transition: "border-color 0.15s, background 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = T.blue + "80";
                e.currentTarget.style.background = T.blue + "08";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = T.border;
                e.currentTarget.style.background = T.surface;
              }}
            >
              <Icon name={tmpl.icon} size={22} color={T.blue}/>
              <span style={{ fontFamily: FP, fontSize: 13, fontWeight: 600, color: T.textHi }}>
                {tmpl.name}
              </span>
              {suggestedTarget != null && (
                <span style={{ fontFamily: FM, fontSize: 11, color: T.muted }}>
                  Suggested: {fmtUSD(suggestedTarget)}
                </span>
              )}
              {tmpl.note && (
                <span style={{ fontFamily: FP, fontSize: 11, color: T.muted, lineHeight: 1.4 }}>
                  {tmpl.note}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Compute current progress for a single goal given the live account /
// net-worth context. Pure — keep it in module scope so it's trivial to
// unit-test later if we add coverage for goals.
function computeCurrent(goal, snapAccounts, plaidAccounts, netWorthHistory) {
  const mode = goal.track_mode || "account";
  if (mode === "manual") return Number(goal.manual_progress) || 0;
  if (mode === "networth") {
    const hist = [...(netWorthHistory || [])].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    const last = hist[hist.length - 1];
    return Number(last?.total) || 0;
  }
  // "account" mode — sum balances across snap + plaid by id.
  const ids = new Set((goal.account_ids || []).map(String));
  if (ids.size === 0) return 0;
  let sum = 0;
  (snapAccounts || []).forEach((a) => {
    if (ids.has(String(a.accountId))) sum += Number(a.balance) || 0;
  });
  (plaidAccounts || []).forEach((a) => {
    if (ids.has(String(a.account_id))) sum += Number(a.current_bal) || 0;
  });
  return sum;
}

// Linear regression on `points` (array of {x, y}) → returns slope and
// intercept. `x` is in days, `y` is dollars. Used both for projecting
// when the goal completes and for refusing to project when the trend
// is non-positive ("Insufficient progress").
function linearRegression(points) {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: 0 };
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of points) {
    sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y;
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return { slope: 0, intercept: sy / n };
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return { slope, intercept };
}

// Build a (x=days_ago, y=$value) series for the last 30 days from
// netWorthHistory. Returns oldest→newest so the slope reads "per day".
function buildNetWorthSeries(netWorthHistory) {
  const hist = [...(netWorthHistory || [])]
    .filter((h) => h && h.date)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (hist.length < 2) return [];
  const last = hist[hist.length - 1];
  const lastDate = new Date(last.date);
  const cutoff = new Date(lastDate); cutoff.setDate(cutoff.getDate() - 30);
  const recent = hist.filter((h) => new Date(h.date) >= cutoff);
  const t0 = new Date(recent[0].date).getTime();
  return recent.map((h) => ({
    x: (new Date(h.date).getTime() - t0) / 86_400_000,
    y: Number(h.total) || 0,
  }));
}

// Project an ETA string given current + target + slope ($/day). When
// the slope is non-positive we cannot project — display the matching
// "insufficient progress" message instead.
function projectionLabel(current, target, slope) {
  if (current >= target) return "Goal reached";
  if (!Number.isFinite(slope) || slope <= 0) return "Insufficient progress";
  const daysToGo = (target - current) / slope;
  if (!Number.isFinite(daysToGo) || daysToGo <= 0) return "Insufficient progress";
  // Cap projection at ~100 years to avoid nonsense dates from a flat trend.
  if (daysToGo > 365 * 100) return "Over a century away";
  const eta = new Date();
  eta.setDate(eta.getDate() + Math.ceil(daysToGo));
  return `Projected: ${fmtDate(eta.toISOString().slice(0, 10))}`;
}

function ProgressBar({ pct, color }) {
  const safe = Math.max(0, Math.min(100, pct));
  return (
    <div style={{
      width: "100%", height: 10, background: T.surface,
      borderRadius: 999, overflow: "hidden",
      border: `1px solid ${T.border}`,
    }}>
      <div style={{
        width: `${safe}%`, height: "100%",
        background: `linear-gradient(90deg, ${color}, ${color}aa)`,
        transition: "width 0.4s ease",
      }} />
    </div>
  );
}

function AccountPickerRow({ acct, selected, onToggle }) {
  return (
    <label style={{
      display: "flex", alignItems: "center", gap: T.s2,
      padding: `6px ${T.s2}`,
      borderRadius: T.rSm,
      cursor: "pointer",
      background: selected ? `${T.blue}18` : "transparent",
      border: `1px solid ${selected ? T.blue + "60" : T.border}`,
    }}>
      <input type="checkbox" checked={selected} onChange={onToggle} style={{ cursor: "pointer" }} />
      <span style={{ fontFamily: FP, fontSize: 12, color: T.text, flex: 1 }}>
        {acct.label}
      </span>
      <span style={{ fontFamily: FM, fontSize: 11, color: T.muted }}>
        {fmtUSD(acct.balance)}
      </span>
    </label>
  );
}

function GoalForm({ initial, accountChoices, onSave, onCancel, templateNote }) {
  const [name, setName] = useState(initial?.name || "");
  const [targetAmount, setTargetAmount] = useState(
    initial?.target_amount != null ? String(initial.target_amount) : ""
  );
  const [targetDate, setTargetDate] = useState(initial?.target_date || "");
  const [trackMode, setTrackMode] = useState(initial?.track_mode || "account");
  const [selectedIds, setSelectedIds] = useState(
    new Set((initial?.account_ids || []).map(String))
  );
  const [manualProgress, setManualProgress] = useState(
    initial?.manual_progress != null ? String(initial.manual_progress) : "0"
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const toggleId = (id) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  };

  const submit = async () => {
    setErr(null);
    const nm = name.trim();
    const amt = Number(targetAmount);
    if (!nm) { setErr("Name is required."); return; }
    if (!Number.isFinite(amt) || amt <= 0) { setErr("Target must be a positive number."); return; }
    if (trackMode === "account" && selectedIds.size === 0) {
      setErr("Pick at least one account for account-tracked goals.");
      return;
    }
    setBusy(true);
    try {
      await onSave({
        name: nm,
        target_amount: amt,
        target_date: targetDate || null,
        account_ids: Array.from(selectedIds),
        track_mode: trackMode,
        manual_progress: trackMode === "manual" ? Number(manualProgress) || 0 : 0,
      });
    } catch (e) {
      setErr(e?.message || "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{
      background: T.card,
      border: `1px solid ${T.borderHi}`,
      borderRadius: T.rLg,
      padding: T.s5,
      display: "flex", flexDirection: "column", gap: T.s4,
    }}>
      <div style={{ fontFamily: FM, fontSize: 11, color: T.muted, letterSpacing: "0.18em", fontWeight: 600 }}>
        {initial?.name && !initial?.id ? `NEW GOAL · ${initial.name.toUpperCase()}` : initial ? "EDIT GOAL" : "NEW GOAL"}
      </div>
      {templateNote && (
        <div style={{
          fontFamily: FP, fontSize: 12, color: T.gold, lineHeight: 1.5,
          padding: `${T.s2} ${T.s3}`,
          background: `${T.gold}10`, border: `1px solid ${T.gold}30`,
          borderRadius: T.rSm, display: "flex", alignItems: "flex-start", gap: 6,
        }}>
          <Icon name="info" size={13} color={T.gold} style={{ marginTop: 1 }}/>{templateNote}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: T.s3 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontFamily: FM, fontSize: 10, color: T.muted, letterSpacing: "0.1em" }}>NAME</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Emergency fund"
            style={inputStyle}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontFamily: FM, fontSize: 10, color: T.muted, letterSpacing: "0.1em" }}>TARGET ($)</span>
          <input
            value={targetAmount}
            onChange={(e) => setTargetAmount(e.target.value)}
            inputMode="decimal"
            placeholder="25000"
            style={inputStyle}
          />
        </label>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: T.s3 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontFamily: FM, fontSize: 10, color: T.muted, letterSpacing: "0.1em" }}>TARGET DATE</span>
          <input
            type="date"
            value={targetDate || ""}
            onChange={(e) => setTargetDate(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontFamily: FM, fontSize: 10, color: T.muted, letterSpacing: "0.1em" }}>TRACK MODE</span>
          <select
            value={trackMode}
            onChange={(e) => setTrackMode(e.target.value)}
            style={inputStyle}
          >
            <option value="account">Account total</option>
            <option value="networth">Net worth</option>
            <option value="manual">Manual</option>
          </select>
        </label>
      </div>

      {trackMode === "account" && (
        <div style={{ display: "flex", flexDirection: "column", gap: T.s2 }}>
          <span style={{ fontFamily: FM, fontSize: 10, color: T.muted, letterSpacing: "0.1em" }}>
            ACCOUNTS ({selectedIds.size} SELECTED)
          </span>
          <div style={{
            display: "flex", flexDirection: "column", gap: 4,
            maxHeight: 220, overflowY: "auto",
            padding: T.s2,
            background: T.surface,
            border: `1px solid ${T.border}`,
            borderRadius: T.rMd,
          }}>
            {accountChoices.length === 0 && (
              <div style={{ fontFamily: FP, fontSize: 12, color: T.muted, padding: T.s3, textAlign: "center" }}>
                No accounts connected. Switch track mode to Manual or Net worth, or connect an account first.
              </div>
            )}
            {accountChoices.map((a) => (
              <AccountPickerRow
                key={a.id}
                acct={a}
                selected={selectedIds.has(String(a.id))}
                onToggle={() => toggleId(String(a.id))}
              />
            ))}
          </div>
        </div>
      )}

      {trackMode === "manual" && (
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontFamily: FM, fontSize: 10, color: T.muted, letterSpacing: "0.1em" }}>MANUAL PROGRESS ($)</span>
          <input
            value={manualProgress}
            onChange={(e) => setManualProgress(e.target.value)}
            inputMode="decimal"
            placeholder="0"
            style={inputStyle}
          />
        </label>
      )}

      {err && (
        <div style={{
          fontFamily: FP, fontSize: 12, color: T.loss,
          padding: T.s2, background: `${T.loss}15`,
          border: `1px solid ${T.loss}40`, borderRadius: T.rSm,
        }}>{err}</div>
      )}

      <div style={{ display: "flex", gap: T.s2, justifyContent: "flex-end" }}>
        <button onClick={onCancel} disabled={busy} style={ghostBtnStyle}>Cancel</button>
        <button onClick={submit} disabled={busy} style={primaryBtnStyle}>
          {busy ? "Saving…" : (initial ? "Save" : "Create goal")}
        </button>
      </div>
    </div>
  );
}

const inputStyle = {
  fontFamily: FP, fontSize: 13, color: T.textHi,
  background: T.surface, border: `1px solid ${T.border}`,
  borderRadius: 8, padding: "8px 10px",
  outline: "none",
};
const primaryBtnStyle = {
  fontFamily: FM, fontSize: 11, fontWeight: 600, letterSpacing: "0.08em",
  color: "#fff", background: `linear-gradient(135deg, ${T.blue}, #5A3FE0)`,
  border: "none", borderRadius: 999, padding: "9px 18px",
  cursor: "pointer",
};
const ghostBtnStyle = {
  fontFamily: FM, fontSize: 11, fontWeight: 600, letterSpacing: "0.08em",
  color: T.text, background: "transparent",
  border: `1px solid ${T.border}`, borderRadius: 999, padding: "9px 18px",
  cursor: "pointer",
};
const smallBtnStyle = {
  fontFamily: FM, fontSize: 10, fontWeight: 600, letterSpacing: "0.06em",
  color: T.muted, background: "transparent",
  border: `1px solid ${T.border}`, borderRadius: T.rSm,
  padding: "4px 10px", cursor: "pointer",
};

function GoalCard({ goal, current, slope, accountLabels, onEdit, onDelete, onManualEdit }) {
  const pct = goal.target_amount > 0
    ? (current / Number(goal.target_amount)) * 100 : 0;
  const color = pct >= 90 ? T.gain : T.blue;
  const projection = projectionLabel(current, Number(goal.target_amount), slope);
  const accLabel = (goal.account_ids || [])
    .map((id) => accountLabels.get(String(id)) || `#${String(id).slice(-4)}`)
    .join(", ");
  const [manualDraft, setManualDraft] = useState(String(goal.manual_progress || 0));
  const [editingManual, setEditingManual] = useState(false);

  const saveManual = async () => {
    const n = Number(manualDraft);
    if (!Number.isFinite(n)) return;
    await onManualEdit(goal.id, n);
    setEditingManual(false);
  };

  return (
    <div className="bento-tile" style={{
      background: `linear-gradient(135deg, ${color}10, transparent 60%), ${T.card}`,
      border: `1px solid ${T.border}`,
      borderTop: `2px solid ${color}`,
      borderLeft: `1px solid ${color}30`,
      borderRadius: T.rLg,
      padding: T.s5,
      display: "flex", flexDirection: "column", gap: T.s3,
      position: "relative", overflow: "hidden",
      boxShadow: "var(--sh-md)",
      transition: "transform 0.18s cubic-bezier(.34,1.56,.64,1), box-shadow 0.2s, border-color 0.2s",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: T.s3 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
          <div style={{ fontFamily: FU, fontSize: 18, fontWeight: 600, color: T.textHi, letterSpacing: "-0.01em" }}>
            {goal.name}
          </div>
          <div style={{ fontFamily: FM, fontSize: 11, color: T.muted, letterSpacing: "0.04em" }}>
            {fmtUSD(goal.target_amount)} by {fmtDate(goal.target_date)}
            {goal.track_mode === "account" && accLabel && <> · {accLabel}</>}
            {goal.track_mode === "networth" && <> · Net worth</>}
            {goal.track_mode === "manual" && <> · Manual</>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button onClick={() => onEdit(goal)} style={smallBtnStyle}>Edit</button>
          <button onClick={() => onDelete(goal)} style={{ ...smallBtnStyle, color: T.loss, borderColor: T.loss + "40" }}>Delete</button>
        </div>
      </div>

      <ProgressBar pct={pct} color={color} />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: T.s3, flexWrap: "wrap" }}>
        <div style={{ fontFamily: FM, fontSize: 13, color: T.textHi, fontVariantNumeric: "tabular-nums" }}>
          {fmtUSD(current)} <span style={{ color: T.muted }}>/ {fmtUSD(goal.target_amount)}</span>
          <span style={{ marginLeft: 8, color: color, fontWeight: 600 }}>
            ({pct.toFixed(1)}%)
          </span>
        </div>
        <div style={{ fontFamily: FM, fontSize: 11, color: projection.startsWith("Insufficient") ? T.loss : T.muted, letterSpacing: "0.04em" }}>
          {projection}
        </div>
      </div>

      {goal.track_mode === "manual" && (
        <div style={{
          display: "flex", alignItems: "center", gap: T.s2,
          paddingTop: T.s2,
          borderTop: `1px solid ${T.border}`,
        }}>
          <span style={{ fontFamily: FM, fontSize: 10, color: T.muted, letterSpacing: "0.1em" }}>MANUAL PROGRESS</span>
          {editingManual ? (
            <>
              <input
                value={manualDraft}
                onChange={(e) => setManualDraft(e.target.value)}
                inputMode="decimal"
                style={{ ...inputStyle, fontSize: 12, padding: "4px 8px", width: 120 }}
              />
              <button onClick={saveManual} style={{ ...smallBtnStyle, color: T.gain, borderColor: T.gain + "40" }}>Save</button>
              <button onClick={() => { setEditingManual(false); setManualDraft(String(goal.manual_progress || 0)); }} style={smallBtnStyle}>Cancel</button>
            </>
          ) : (
            <button onClick={() => setEditingManual(true)} style={smallBtnStyle}>Update</button>
          )}
        </div>
      )}
    </div>
  );
}

export default function Goals({
  snapAccounts = [],
  plaidAccounts = [],
  netWorthHistory = [],
  demoMode = false,
  avgMonthlySpend = 0,
}) {
  const [goals, setGoals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  // null = idle, "picker" = template picker open, {template} = GoalForm with preset
  const [creating, setCreating] = useState(null);
  const [editingId, setEditingId] = useState(null);

  // Demo fixtures so the tab is meaningful before the user creates anything
  // when demoMode is on. Mirrors the live-state shape exactly.
  const demoGoals = useMemo(() => {
    if (!demoMode) return [];
    const accIds = snapAccounts.slice(0, 1).map((a) => a.accountId).filter(Boolean);
    return [
      {
        id: "demo-1",
        name: "Emergency Fund",
        target_amount: 25000,
        target_date: new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10),
        account_ids: accIds,
        track_mode: accIds.length ? "account" : "networth",
        manual_progress: 0,
      },
      {
        id: "demo-2",
        name: "House Down Payment",
        target_amount: 200000,
        target_date: new Date(Date.now() + 3 * 365 * 86_400_000).toISOString().slice(0, 10),
        account_ids: [],
        track_mode: "networth",
        manual_progress: 0,
      },
    ];
  }, [demoMode, snapAccounts]);

  const load = useCallback(async () => {
    if (demoMode) {
      setGoals(demoGoals);
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const r = await apiFetch("/api/goals");
      if (!r.ok) {
        if (r.status === 401) {
          setGoals([]);
          return;
        }
        // Server returns 503 + hint:"MIGRATION_PENDING" when the goals
        // table hasn't been provisioned yet. Surface a clear pending-setup
        // state instead of a scary HTTP error.
        if (r.status === 503) {
          const body = await r.json().catch(() => ({}));
          if (body?.hint === "MIGRATION_PENDING") {
            setGoals([]);
            setErr({ pending: true, migration: body.migration || "014_goals.sql" });
            return;
          }
        }
        throw new Error(`HTTP ${r.status}`);
      }
      const json = await r.json();
      setGoals(Array.isArray(json?.goals) ? json.goals : []);
    } catch (e) {
      setErr(e?.message || "Failed to load goals");
    } finally {
      setLoading(false);
    }
  }, [demoMode, demoGoals]);

  useEffect(() => { load(); }, [load]);

  // Combined account choices for the picker. Stable id so the form can
  // track selections regardless of provider.
  const accountChoices = useMemo(() => {
    const fromSnap = (snapAccounts || []).map((a) => ({
      id: String(a.accountId || ""),
      label: `${a.brokerage || "Broker"} — ${a.accountName || ""}`,
      balance: Number(a.balance) || 0,
    })).filter((a) => a.id);
    const fromPlaid = (plaidAccounts || []).map((a) => ({
      id: String(a.account_id || ""),
      label: `${a.institution_name || "Bank"} — ${a.name || a.subtype || a.type || ""}`,
      balance: Number(a.current_bal) || 0,
    })).filter((a) => a.id);
    return [...fromSnap, ...fromPlaid];
  }, [snapAccounts, plaidAccounts]);

  const accountLabels = useMemo(() => {
    const m = new Map();
    accountChoices.forEach((a) => m.set(a.id, a.label));
    return m;
  }, [accountChoices]);

  // Net-worth derived slope is the same for every networth-mode goal —
  // compute once per render.
  const networthSlope = useMemo(() => {
    const series = buildNetWorthSeries(netWorthHistory);
    return linearRegression(series).slope;
  }, [netWorthHistory]);

  // For account-mode goals we don't have a per-account daily history
  // here, so fall back to "monthly average contribution" derived from
  // the netWorthHistory slope * fraction of net worth the account
  // represents. That is a deliberate approximation — when we wire in
  // plaid_transactions running balances in a future migration we'll
  // upgrade this to a real per-account regression.
  const accountSlopeFor = useCallback((goal, current) => {
    if (current <= 0) return networthSlope;
    const hist = [...(netWorthHistory || [])].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    const last = hist[hist.length - 1];
    const nw = Number(last?.total) || 0;
    if (nw <= 0) return networthSlope;
    // Slope proportional to the goal's share of net worth.
    return networthSlope * (current / nw);
  }, [netWorthHistory, networthSlope]);

  const createGoal = async (payload) => {
    if (demoMode) {
      const id = `demo-${Date.now()}`;
      setGoals((prev) => [...prev, { id, ...payload, manual_progress: payload.manual_progress || 0 }]);
      setCreating(null);
      return;
    }
    const r = await apiFetch("/api/goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j?.error || `HTTP ${r.status}`);
    }
    const saved = await r.json();
    setGoals((prev) => [...prev, saved]);
    setCreating(null);
  };

  const updateGoal = async (id, payload) => {
    if (demoMode) {
      setGoals((prev) => prev.map((g) => g.id === id ? { ...g, ...payload } : g));
      setEditingId(null);
      return;
    }
    const r = await apiFetch(`/api/goals/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j?.error || `HTTP ${r.status}`);
    }
    const saved = await r.json();
    setGoals((prev) => prev.map((g) => g.id === id ? saved : g));
    setEditingId(null);
  };

  const deleteGoal = async (goal) => {
    if (!confirm(`Delete goal "${goal.name}"?`)) return;
    if (demoMode) {
      setGoals((prev) => prev.filter((g) => g.id !== goal.id));
      return;
    }
    const r = await apiFetch(`/api/goals/${encodeURIComponent(goal.id)}`, { method: "DELETE" });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setErr(j?.error || `HTTP ${r.status}`);
      return;
    }
    setGoals((prev) => prev.filter((g) => g.id !== goal.id));
  };

  const editManual = (id, n) => updateGoal(id, { manual_progress: n });

  // ── Render ──────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: T.s5, maxWidth: 1080, margin: "0 auto", paddingBottom: T.s8 }}>
      {/* Header tile */}
      <div className="bento-tile" style={{
        background: `radial-gradient(circle at 0% 0%, ${T.blue}18, transparent 55%), ${T.card}`,
        border: `1px solid ${T.border}`,
        borderTop: `2px solid ${T.blue}`,
        borderLeft: `1px solid ${T.blue}30`,
        borderRadius: T.rLg,
        padding: `${T.s6} ${T.s5}`,
        display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: T.s3,
        boxShadow: "var(--sh-md)",
        transition: "transform 0.18s cubic-bezier(.34,1.56,.64,1), box-shadow 0.2s, border-color 0.2s",
      }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontFamily: FM, fontSize: 11, color: T.blue, letterSpacing: "0.18em", fontWeight: 600 }}>
            GOALS · {goals.length} ACTIVE
          </span>
          <span style={{ fontFamily: FU, fontSize: 22, fontWeight: 600, color: T.textHi, letterSpacing: "-0.01em" }}>
            Save toward specific targets
          </span>
          <span style={{ fontFamily: FP, fontSize: 13, color: T.muted, letterSpacing: "-0.005em" }}>
            Track account balances, total net worth, or manual milestones. Projections use the last 30 days.
          </span>
        </div>
        <button onClick={() => { setCreating("picker"); setEditingId(null); }} style={primaryBtnStyle}>+ New goal</button>
      </div>

      {err && err.pending ? (
        <div style={{
          fontFamily: FP, fontSize: 13, color: T.gold,
          padding: T.s4, background: `${T.gold}12`,
          border: `1px solid ${T.gold}40`, borderRadius: T.rMd,
          lineHeight: 1.55,
        }}>
          <strong style={{ fontFamily: FM, fontSize: 10, letterSpacing: "0.16em", color: T.gold, display: "block", marginBottom: T.s2 }}>SETUP PENDING</strong>
          Goals are ready in code but the database table hasn't been provisioned yet on this Supabase project. The operator needs to apply migration <code style={{ fontFamily: FM, background: `${T.gold}22`, padding: "1px 6px", borderRadius: 3 }}>{err.migration}</code> (under <code style={{ fontFamily: FM, background: `${T.gold}22`, padding: "1px 6px", borderRadius: 3 }}>supabase/migrations/</code>) via the Supabase SQL editor or CLI. Goals will load automatically once the table exists.
        </div>
      ) : err && (
        <div style={{
          fontFamily: FP, fontSize: 12, color: T.loss,
          padding: T.s3, background: `${T.loss}15`,
          border: `1px solid ${T.loss}40`, borderRadius: T.rMd,
        }}>{typeof err === "string" ? err : (err.message || "Failed to load goals")}</div>
      )}

      {creating === "picker" && (
        <TemplatePicker
          avgMonthlySpend={avgMonthlySpend}
          onPick={(tmpl) => setCreating({ template: tmpl })}
          onCancel={() => setCreating(null)}
        />
      )}

      {creating && creating !== "picker" && (
        <GoalForm
          initial={creating.template ? {
            name: creating.template.name,
            target_amount: creating.template.target || "",
            track_mode: "manual",
          } : undefined}
          accountChoices={accountChoices}
          onSave={createGoal}
          onCancel={() => setCreating(null)}
          templateNote={creating.template?.note || null}
        />
      )}

      {loading && !creating && goals.length === 0 && (
        <div style={{
          fontFamily: FP, fontSize: 14, color: T.muted,
          padding: T.s6, textAlign: "center",
          border: `1px dashed ${T.border}`, borderRadius: T.rLg,
        }}>Loading goals…</div>
      )}

      {!loading && !creating && goals.length === 0 && (
        <div style={{
          fontFamily: FP, fontSize: 14, color: T.muted,
          padding: T.s8, textAlign: "center",
          border: `1px dashed ${T.border}`, borderRadius: T.rLg,
          display: "flex", flexDirection: "column", alignItems: "center", gap: T.s3,
        }}>
          <Icon name="target" size={28} color={T.muted}/>
          <span>No goals yet.</span>
          <button
            onClick={() => { setCreating("picker"); setEditingId(null); }}
            style={primaryBtnStyle}
          >
            Set your first goal →
          </button>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: T.s4 }}>
        {goals.map((g) => {
          if (editingId === g.id) {
            return (
              <GoalForm
                key={g.id}
                initial={g}
                accountChoices={accountChoices}
                onSave={(p) => updateGoal(g.id, p)}
                onCancel={() => setEditingId(null)}
              />
            );
          }
          const current = computeCurrent(g, snapAccounts, plaidAccounts, netWorthHistory);
          const slope = g.track_mode === "networth"
            ? networthSlope
            : g.track_mode === "manual"
              ? 0  // manual goals have no trajectory → "Insufficient progress" until user updates
              : accountSlopeFor(g, current);
          return (
            <GoalCard
              key={g.id}
              goal={g}
              current={current}
              slope={slope}
              accountLabels={accountLabels}
              onEdit={() => { setEditingId(g.id); setCreating(null); }}
              onDelete={deleteGoal}
              onManualEdit={editManual}
            />
          );
        })}
      </div>
    </div>
  );
}

// ── GoalsOverviewWidget ───────────────────────────────────────────────────────
// Compact widget rendered in the Overview tab. Self-fetches goals, shows up
// to 3 active goals as mini-cards with progress bars and projected completion.
// Navigates to the Goals tab via onNav("goals").
export function GoalsOverviewWidget({
  snapAccounts = [],
  plaidAccounts = [],
  netWorthHistory = [],
  demoMode = false,
  onNav,
  mask = (v) => v,
}) {
  const [goals, setGoals] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const demoPreviews = useMemo(() => [
    { id: "d1", name: "Hajj Fund",        target_amount: 10000, track_mode: "manual", manual_progress: 3200, account_ids: [] },
    { id: "d2", name: "Home Down Payment", target_amount: 60000, track_mode: "networth", manual_progress: 0, account_ids: [] },
    { id: "d3", name: "Emergency Fund",    target_amount: 15000, track_mode: "manual", manual_progress: 8700, account_ids: [] },
  ], []);

  useEffect(() => {
    if (demoMode) { setGoals(demoPreviews); setLoaded(true); return; }
    let cancelled = false;
    apiFetch("/api/goals").then(async (r) => {
      if (cancelled) return;
      if (r.ok) {
        const json = await r.json().catch(() => ({}));
        setGoals(Array.isArray(json?.goals) ? json.goals : []);
      }
      setLoaded(true);
    }).catch(() => setLoaded(true));
    return () => { cancelled = true; };
  }, [demoMode, demoPreviews]);

  const networthSlope = useMemo(
    () => linearRegression(buildNetWorthSeries(netWorthHistory)).slope,
    [netWorthHistory],
  );

  const previews = goals.slice(0, 3);

  // Map template name → icon for display
  const iconFor = (g) => { const n = TEMPLATES.find((t) => t.name === g.name)?.icon; return n || "target"; };

  if (!loaded) return null;

  return (
    <div className="bento-tile" style={{
      background: T.card,
      border: `1px solid ${T.border}`,
      borderTop: `2px solid ${T.blue}`,
      borderLeft: `1px solid ${T.blue}30`,
      borderRadius: T.rLg,
      padding: T.s5,
      display: "flex", flexDirection: "column", gap: T.s4,
      boxShadow: "var(--sh-md)",
      transition: "transform 0.18s cubic-bezier(.34,1.56,.64,1), box-shadow 0.2s, border-color 0.2s",
    }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontFamily: FM, fontSize: 10, color: T.muted, letterSpacing: "0.18em", fontWeight: 600 }}>
          SAVINGS GOALS
          {goals.length > 0 && <span style={{ marginLeft: 6 }}>· {goals.length}</span>}
        </span>
        <button
          onClick={() => onNav?.("goals")}
          style={{
            fontFamily: FM, fontSize: 10, fontWeight: 600, letterSpacing: "0.06em",
            color: T.blue, background: "transparent", border: "none", cursor: "pointer", padding: 0,
          }}
        >
          View all →
        </button>
      </div>

      {goals.length === 0 ? (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", gap: T.s2,
          padding: `${T.s4} 0`, textAlign: "center",
        }}>
          <Icon name="target" size={24} color={T.muted}/>
          <span style={{ fontFamily: FP, fontSize: 13, color: T.muted }}>No savings goals yet</span>
          <button
            onClick={() => onNav?.("goals")}
            style={{
              fontFamily: FM, fontSize: 10, fontWeight: 600, letterSpacing: "0.06em",
              color: T.blue, background: `${T.blue}18`,
              border: `1px solid ${T.blue}30`, borderRadius: 999,
              padding: "6px 14px", cursor: "pointer", marginTop: T.s1,
            }}
          >
            Set a savings goal
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: T.s3 }}>
          {previews.map((g) => {
            const current = computeCurrent(g, snapAccounts, plaidAccounts, netWorthHistory);
            const pct = Number(g.target_amount) > 0 ? (current / Number(g.target_amount)) * 100 : 0;
            const color = pct >= 90 ? T.gain : T.blue;
            const slope = g.track_mode === "networth" ? networthSlope : 0;
            const proj = projectionLabel(current, Number(g.target_amount), slope);
            return (
              <div key={g.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: T.s2 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: T.s2, minWidth: 0 }}>
                    <Icon name={iconFor(g)} size={16} color={T.blue} style={{ flexShrink: 0 }}/>
                    <span style={{
                      fontFamily: FP, fontSize: 13, fontWeight: 600, color: T.textHi,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {g.name}
                    </span>
                  </div>
                  <span style={{ fontFamily: FM, fontSize: 11, color, fontWeight: 600, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
                    {Math.min(pct, 100).toFixed(0)}%
                  </span>
                </div>
                <ProgressBar pct={pct} color={color} />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ fontFamily: FM, fontSize: 11, color: T.muted, fontVariantNumeric: "tabular-nums" }}>
                    {mask(fmtUSD(current))} <span style={{ opacity: 0.6 }}>/ {mask(fmtUSD(g.target_amount))}</span>
                  </span>
                  {slope > 0 && (
                    <span style={{ fontFamily: FM, fontSize: 10, color: T.muted }}>{proj}</span>
                  )}
                </div>
              </div>
            );
          })}
          {goals.length > 3 && (
            <div style={{ fontFamily: FM, fontSize: 10, color: T.muted, textAlign: "center" }}>
              +{goals.length - 3} more goal{goals.length - 3 !== 1 ? "s" : ""}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
