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
import { setLocalAndSync } from "../lib/userState.js";
import { normalizePlaidStreams, detectRecurringOutflows, matchDebtToStream, streamPaymentsSince } from "../lib/recurring.js";
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

      {/* Debt payoff tracker — money you owe, counting down to $0. */}
      <DebtSection plaidAccounts={plaidAccounts} demoMode={demoMode} />
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

  // Debt payoff summary — remaining owed across all tracked debts. Read from
  // localStorage (linked debts resolve their live balance from plaidAccounts).
  // Snapshot on mount; the Debts tab is the source of truth for edits.
  const debtTotals = useMemo(() => {
    const list = readDebts();
    let remaining = 0, original = 0;
    list.forEach((d) => { const s = debtState(d, plaidAccounts); remaining += s.remaining; original += s.original; });
    return { count: list.length, remaining, original, pct: original > 0 ? ((original - remaining) / original) * 100 : 0 };
  }, [plaidAccounts]);

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

      {/* Debt payoff strip — only when the user is tracking debts. */}
      {debtTotals.count > 0 && (
        <button
          onClick={() => onNav?.("goals")}
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: T.s3,
            padding: `${T.s2} ${T.s3}`, marginTop: goals.length > 0 ? T.s1 : 0,
            background: `${T.loss}0e`, border: `1px solid ${T.loss}30`, borderRadius: T.rMd,
            cursor: "pointer", textAlign: "left",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: T.s2, minWidth: 0 }}>
            <Icon name="scale" size={15} color={T.loss} style={{ flexShrink: 0 }}/>
            <span style={{ fontFamily: FM, fontSize: 10, color: T.muted, letterSpacing: "0.14em", fontWeight: 600 }}>
              DEBT · {debtTotals.count}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: T.s2, flexShrink: 0 }}>
            <span style={{ fontFamily: FM, fontSize: 12, fontWeight: 600, color: T.loss, fontVariantNumeric: "tabular-nums" }}>
              {mask(fmtUSD(debtTotals.remaining))} <span style={{ color: T.muted, fontWeight: 400 }}>left</span>
            </span>
            <span style={{ fontFamily: FM, fontSize: 10, color: T.gain, fontWeight: 600 }}>
              {Math.min(debtTotals.pct, 100).toFixed(0)}% cleared
            </span>
          </div>
        </button>
      )}
    </div>
  );
}

// ── Debt payoff tracker ───────────────────────────────────────────────────────
// "Origin-style" debt tracker for the Goals tab. A debt counts DOWN toward $0.
// Tracking is deliberately flexible — a debt can be owed to a bank OR a person,
// and paid three ways:
//   - manual    → log payments whenever (friend loan, cash, irregular amounts)
//   - balance   → reads a linked Plaid credit/loan account's live balance
//                 (overdue card, bank loan that reports to Plaid)
//   - recurring → a set amount on a cadence (e.g. $500/month) paid FROM a
//                 funding account (checking); autopay counts each scheduled
//                 period automatically, else confirm one-click each period.
// Interest-free (qard hasan) is the default — APR is optional and only meant
// for an interest-bearing balance like an overdue conventional card.
//
// Stored in localStorage (`mizan_debts`) mirrored to Supabase user_state — the
// same no-migration pattern as manual assets. Standalone payoff tracker: it
// does NOT feed net worth (a balance-linked account is already counted there
// via Plaid, and manual/recurring debts would distort the headline).
const DEBT_KEY = "mizan_debts";

const DEBT_TEMPLATES = [
  { id: "credit",   icon: "bank",   name: "Credit Card" },
  { id: "auto",     icon: "scale",  name: "Auto Financing" },
  { id: "student",  icon: "book",   name: "Student Loan" },
  { id: "home",     icon: "home",   name: "Home Financing" },
  { id: "personal", icon: "bank",   name: "Personal Loan" },
  { id: "qard",     icon: "leaf",   name: "Family / Friend (Qard Hasan)" },
  { id: "custom",   icon: "pencil", name: "Custom Debt" },
];

// Days per payment period, used to accrue recurring plans + project payoff.
const PERIOD_DAYS = { weekly: 7, biweekly: 14, monthly: 30.44 };
const CADENCE_LABEL = { weekly: "week", biweekly: "2 wks", monthly: "month" };

const isDebtAcct = (a) => a?.type === "credit" || a?.type === "loan";
const iconForDebt = (d) => DEBT_TEMPLATES.find((t) => t.name === d.name)?.icon || d.icon || "scale";
const genDebtId = () => `debt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
// Legacy debts stored mode:"linked" — treat as the renamed "balance" mode.
const debtMode = (d) => (d?.mode === "linked" ? "balance" : (d?.mode || "manual"));

function readDebts() {
  try {
    const a = JSON.parse(localStorage.getItem(DEBT_KEY) || "[]");
    return Array.isArray(a) ? a : [];
  } catch { return []; }
}

const debtPaidTotal = (d) => (d.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);

// How many full payment periods have elapsed since a recurring plan started.
function recurringElapsedPeriods(debt) {
  const startRaw = debt.start_date || debt.created_at;
  const start = startRaw ? new Date(startRaw).getTime() : Date.now();
  const days = Math.max(0, (Date.now() - start) / 86_400_000);
  const per = PERIOD_DAYS[debt.cadence] || PERIOD_DAYS.monthly;
  return Math.floor(days / per);
}

// Resolve live owed balance + amount paid for a debt.
//   balance    → reads the linked liability account's current balance
//   recurring  → accrues elapsed scheduled payments (when autopay) + any logged
//   manual     → sums logged payments against the original balance
function debtState(debt, accounts) {
  const original = Number(debt.original) || 0;
  const mode = debtMode(debt);
  if (mode === "balance" && debt.linked_account_id) {
    const acct = (accounts || []).find((a) => String(a.account_id) === String(debt.linked_account_id));
    const remaining = acct ? Math.abs(Number(acct.current_bal) || 0) : original;
    const base = Math.max(original, remaining); // original should be ≥ current owed
    return { mode, original: base, remaining, paid: Math.max(0, base - remaining), linkedMissing: !acct };
  }
  if (mode === "recurring") {
    const logged = debtPaidTotal(debt);
    const scheduled = debt.autopay ? recurringElapsedPeriods(debt) * (Number(debt.payment_amount) || 0) : 0;
    const paid = Math.min(original, Math.max(0, logged + scheduled));
    return { mode, original, remaining: Math.max(0, original - paid), paid, linkedMissing: false };
  }
  const paid = Math.min(original, debtPaidTotal(debt));
  return { mode, original, remaining: Math.max(0, original - paid), paid, linkedMissing: false };
}

// Compact payoff projection shown on each card.
function debtPayoffLabel(debt, remaining) {
  if (remaining <= 0.005) return "Paid off — alhamdulillah";
  const mode = debtMode(debt);
  if (mode === "recurring") {
    const amt = Number(debt.payment_amount) || 0;
    const apr = Number(debt.apr) || 0;
    if (amt > 0) {
      const per = PERIOD_DAYS[debt.cadence] || PERIOD_DAYS.monthly;
      if (apr > 0) {
        // Interest-aware: amortize the balance at the monthly rate using the
        // monthly-equivalent payment, so a card's payoff isn't under-counted.
        const monthlyPmt = monthlyFromCadence(amt, debt.cadence);
        const nMonths = monthsToPayoff(remaining, apr / 100 / 12, monthlyPmt);
        if (!Number.isFinite(nMonths)) return `${fmtUSD(amt)}/${CADENCE_LABEL[debt.cadence] || "month"} barely covers interest`;
        const eta = new Date(Date.now() + nMonths * 30.44 * 86_400_000);
        return `~${nMonths} mo at ${apr}% · debt-free ~${fmtDate(eta.toISOString().slice(0, 10))}`;
      }
      const periods = Math.ceil(remaining / amt);
      const eta = new Date(Date.now() + periods * per * 86_400_000);
      return `${periods} × ${fmtUSD(amt)} left · debt-free ~${fmtDate(eta.toISOString().slice(0, 10))}`;
    }
  }
  if (mode === "manual" && debt.created_at) {
    const paid = debtPaidTotal(debt);
    const days = Math.max(1, (Date.now() - new Date(debt.created_at).getTime()) / 86_400_000);
    const perDay = paid / days;
    if (perDay > 0) {
      const daysToGo = remaining / perDay;
      if (Number.isFinite(daysToGo) && daysToGo > 0 && daysToGo < 365 * 100) {
        const eta = new Date(Date.now() + daysToGo * 86_400_000);
        return `Debt-free ~${fmtDate(eta.toISOString().slice(0, 10))}`;
      }
    }
  }
  if (debt.target_date) return `Target: ${fmtDate(debt.target_date)}`;
  if (mode === "balance") return ""; // tracks live — no projection needed
  return "Log a payment to project";
}

// ── Amortization + payoff optimizer (pure) ────────────────────────────────────
// Standard amortization: months to clear `balance` at `monthlyRate` paying `pmt`
// each month. Returns Infinity when the payment can't cover the monthly interest
// (the balance would never fall). monthlyRate = APR/100/12.
function monthsToPayoff(balance, monthlyRate, pmt) {
  if (!(balance > 0)) return 0;
  if (!(pmt > 0)) return Infinity;
  if (monthlyRate <= 0) return Math.ceil(balance / pmt);
  if (pmt <= balance * monthlyRate) return Infinity; // interest ≥ payment
  const n = -Math.log(1 - (monthlyRate * balance) / pmt) / Math.log(1 + monthlyRate);
  return Math.ceil(n);
}

// Normalize a recurring plan's payment to a monthly figure.
function monthlyFromCadence(amount, cadence) {
  const per = cadence === "weekly" ? 4.333 : cadence === "biweekly" ? 2.167 : 1;
  return (Number(amount) || 0) * per;
}

// The monthly minimum we assume for a debt in the payoff plan. Priority:
//   1) recurring plan's payment (normalized to monthly)
//   2) an explicitly-set min_payment
//   3) an estimate: interest-bearing → 2% of balance (floor $25, card-style);
//      interest-free with a target date → spread evenly to the target;
//      otherwise a gentle 24-month spread.
function monthlyMinFor(debt, remaining) {
  const mode = debtMode(debt);
  if (mode === "recurring" && Number(debt.payment_amount) > 0) {
    return monthlyFromCadence(debt.payment_amount, debt.cadence);
  }
  if (Number(debt.min_payment) > 0) return Number(debt.min_payment);
  const apr = Number(debt.apr) || 0;
  if (apr > 0) return Math.max(25, remaining * 0.02);
  if (debt.target_date) {
    const months = Math.max(1, Math.round((new Date(debt.target_date).getTime() - Date.now()) / (30.44 * 86_400_000)));
    return remaining / months;
  }
  return remaining / 24;
}

// Order debts by payoff strategy. Riba-first is the Islamic default: clear
// interest-bearing (riba) debt fastest to minimize interest paid, then the
// interest-free loans. Avalanche = highest APR first (least total interest).
// Snowball = smallest balance first (fastest wins for motivation).
function sortByStrategy(items, strategy) {
  const arr = [...items];
  if (strategy === "snowball") return arr.sort((a, b) => a.balance - b.balance);
  if (strategy === "avalanche") return arr.sort((a, b) => b.apr - a.apr || a.balance - b.balance);
  // riba-first: interest-bearing group first (by APR desc), interest-free last (by balance asc)
  return arr.sort((a, b) => {
    const aRiba = a.apr > 0 ? 1 : 0, bRiba = b.apr > 0 ? 1 : 0;
    if (aRiba !== bRiba) return bRiba - aRiba;
    return aRiba ? (b.apr - a.apr) : (a.balance - b.balance);
  });
}

const PLAN_MAX_MONTHS = 1200; // 100-year guard against a never-clearing plan

// Simulate a whole-portfolio payoff: pay each debt its monthly minimum, then
// funnel `extraPerMonth` (plus any freed-up minimums from cleared debts — the
// "snowball rollover") to the highest-priority debt. Interest accrues monthly on
// interest-bearing debts. Returns the month-by-month total-balance series (for
// the burn-down chart), months-to-debt-free, total interest paid, and the order
// debts clear in. Deterministic + pure.
function computePayoffPlan(planDebts, extraPerMonth, strategy) {
  const items = planDebts
    .map((d) => ({
      id: d.id, name: d.name, icon: d.icon,
      apr: Number(d.apr) || 0,
      rate: (Number(d.apr) || 0) / 100 / 12,
      balance: d.remaining,
      min: monthlyMinFor(d, d.remaining),
      interestFree: !(Number(d.apr) > 0),
    }))
    .filter((it) => it.balance > 0.005);

  const startTotal = items.reduce((s, it) => s + it.balance, 0);
  const series = [{ month: 0, total: startTotal }];
  const order = [];
  const extra = Math.max(0, Number(extraPerMonth) || 0);
  let months = 0, totalInterest = 0;

  const active = () => items.filter((it) => it.balance > 0.005);
  while (active().length && months < PLAN_MAX_MONTHS) {
    months++;
    // 1) accrue interest
    items.forEach((it) => {
      if (it.balance > 0.005 && it.rate > 0) {
        const interest = it.balance * it.rate;
        it.balance += interest;
        totalInterest += interest;
      }
    });
    // 2) pool = every active debt's minimum + the user's extra. Freed minimums
    //    from already-cleared debts stay in the pool automatically (rollover).
    let budget = extra + active().reduce((s, it) => s + it.min, 0);
    // pay each active its minimum first (capped at its balance)
    active().forEach((it) => {
      const pay = Math.min(it.min, it.balance, budget);
      it.balance -= pay; budget -= pay;
    });
    // funnel the remainder to debts in priority order
    for (const it of sortByStrategy(active(), strategy)) {
      if (budget <= 0.005) break;
      const pay = Math.min(budget, it.balance);
      it.balance -= pay; budget -= pay;
    }
    // record any debt that cleared this month
    items.forEach((it) => {
      if (it.balance <= 0.005 && !order.some((o) => o.id === it.id)) {
        it.balance = 0;
        order.push({ id: it.id, name: it.name, icon: it.icon, month: months, interestFree: it.interestFree });
      }
    });
    series.push({ month: months, total: items.reduce((s, it) => s + it.balance, 0) });
  }

  return {
    months,
    totalInterest: Math.round(totalInterest * 100) / 100,
    series,
    order,
    feasible: months < PLAN_MAX_MONTHS,
    startTotal,
  };
}

function DEMO_DEBTS(accounts) {
  const cc = (accounts || []).find((a) => a.type === "credit");
  const checking = (accounts || []).find((a) => a.type === "depository" && a.subtype === "checking");
  const now = Date.now();
  return [
    {
      id: "demo-debt-1", name: "Auto Financing (Ijara)", creditor: "Guidance Residential", icon: "scale",
      original: 32000, apr: 0, mode: "manual",
      target_date: new Date(now + 540 * 86_400_000).toISOString().slice(0, 10),
      payments: [{ id: "dp1", amount: 17500, date: new Date(now - 120 * 86_400_000).toISOString(), note: "Payments to date" }],
      created_at: new Date(now - 400 * 86_400_000).toISOString(),
    },
    {
      id: "demo-debt-2", name: "Loan from my brother", creditor: "Yusuf (family)", icon: "leaf",
      original: 6000, apr: null, mode: "recurring",
      payment_amount: 500, cadence: "monthly", autopay: true,
      funding_account_id: checking ? checking.account_id : null,
      start_date: new Date(now - 165 * 86_400_000).toISOString(),
      payments: [], created_at: new Date(now - 165 * 86_400_000).toISOString(),
    },
    ...(cc ? [{
      id: "demo-debt-3", name: cc.name || "Credit Card", creditor: cc.institution_name || "Chase", icon: "bank",
      original: 8000, apr: 22.9, mode: "balance", linked_account_id: cc.account_id,
      payments: [], created_at: new Date(now - 200 * 86_400_000).toISOString(),
    }] : []),
  ];
}

// Demo recurring outflow streams (stands in for Plaid's /recurring in demo).
// The Guidance Residential stream matches the Auto Financing debt so the
// "detected payment → link" flow is demonstrable without a live bank.
function DEMO_DEBT_STREAMS() {
  const now = Date.now();
  const mo = (n) => new Date(now - n * 30.44 * 86_400_000).toISOString().slice(0, 10);
  return [
    {
      key: "GUIDANCE RESIDENTIAL", merchant: "Guidance Residential", typicalAmount: 1200, lastAmount: 1200,
      lastDate: mo(0), cadence: "monthly", medianGapDays: 30, count: 3, category: "LOAN_PAYMENTS", account_id: "d-chase-1",
      txns: [
        { date: mo(2), amount: 1200 }, { date: mo(1), amount: 1200 }, { date: mo(0), amount: 1200 },
      ],
    },
  ];
}

// Inline "log a payment" control (manual + recurring extra/off-schedule).
function LogPaymentRow({ label = "Log payment", defaultAmount = "", onLog, onCancel }) {
  const [amount, setAmount] = useState(defaultAmount ? String(defaultAmount) : "");
  const [note, setNote] = useState("");
  const submit = () => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return;
    onLog(n, note.trim());
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: T.s2, flexWrap: "wrap" }}>
      <input
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        inputMode="decimal"
        placeholder="Amount paid"
        autoFocus
        onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") onCancel(); }}
        style={{ ...inputStyle, fontSize: 12, padding: "5px 9px", width: 120 }}
      />
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (optional)"
        onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") onCancel(); }}
        style={{ ...inputStyle, fontSize: 12, padding: "5px 9px", flex: 1, minWidth: 120 }}
      />
      <button onClick={submit} style={{ ...smallBtnStyle, color: T.gain, borderColor: T.gain + "40" }}>{label}</button>
      <button onClick={onCancel} style={smallBtnStyle}>Cancel</button>
    </div>
  );
}

function DebtCard({ debt, accounts, labelFor, suggestion, linkedStream, onLinkStream, onUnlinkStream, onEdit, onDelete, onLogPayment, onConfirmScheduled, onMarkPaid }) {
  const { mode, original, remaining, paid, linkedMissing } = debtState(debt, accounts);
  const pct = original > 0 ? (paid / original) * 100 : 0;
  const done = remaining <= 0.005;
  const color = done ? T.gain : T.blue;
  const [logging, setLogging] = useState(false);
  const payoff = debtPayoffLabel(debt, remaining);
  const amt = Number(debt.payment_amount) || 0;
  const fundLabel = debt.funding_account_id ? labelFor(debt.funding_account_id) : "";
  const streamPaidCount = (debt.payments || []).filter((p) => p.source === "stream").length;

  // Sub-line under the name: who it's owed to + how it's tracked.
  const trackLine = mode === "balance"
    ? `Linked${labelFor(debt.linked_account_id) ? ` · ${labelFor(debt.linked_account_id)}` : ""}`
    : linkedStream
      ? "Auto-synced from bank"
      : mode === "recurring"
        ? `${fmtUSD(amt)}/${CADENCE_LABEL[debt.cadence] || "month"}${fundLabel ? ` · from ${fundLabel}` : ""}${debt.autopay ? " · auto" : ""}`
        : "Manual";

  return (
    <div className="bento-tile" style={{
      background: `linear-gradient(135deg, ${(done ? T.gain : T.loss)}0e, transparent 60%), ${T.card}`,
      border: `1px solid ${T.border}`,
      borderTop: `2px solid ${done ? T.gain : T.loss}`,
      borderLeft: `1px solid ${(done ? T.gain : T.loss)}30`,
      borderRadius: T.rLg,
      padding: T.s5,
      display: "flex", flexDirection: "column", gap: T.s3,
      position: "relative", overflow: "hidden",
      boxShadow: "var(--sh-md)",
      transition: "transform 0.18s cubic-bezier(.34,1.56,.64,1), box-shadow 0.2s, border-color 0.2s",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: T.s3 }}>
        <div style={{ display: "flex", alignItems: "center", gap: T.s3, minWidth: 0 }}>
          <Icon name={iconForDebt(debt)} size={20} color={done ? T.gain : T.loss} style={{ flexShrink: 0 }}/>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
            <div style={{ fontFamily: FU, fontSize: 17, fontWeight: 600, color: T.textHi, letterSpacing: "-0.01em" }}>
              {debt.name}
            </div>
            <div style={{ fontFamily: FM, fontSize: 11, color: T.muted, letterSpacing: "0.04em" }}>
              {debt.creditor ? <>{debt.creditor} · </> : null}{trackLine}
              {Number(debt.apr) > 0
                ? <span style={{ color: T.loss }}> · {debt.apr}% APR</span>
                : <span style={{ color: T.gain }}> · interest-free</span>}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button onClick={() => onEdit(debt)} style={smallBtnStyle}>Edit</button>
          <button onClick={() => onDelete(debt)} style={{ ...smallBtnStyle, color: T.loss, borderColor: T.loss + "40" }}>Delete</button>
        </div>
      </div>

      {/* Remaining balance — the number that counts down. */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: T.s3, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontFamily: FM, fontSize: 9, color: T.muted, letterSpacing: "0.16em", fontWeight: 600, marginBottom: 2 }}>REMAINING</div>
          <div style={{ fontFamily: FU, fontSize: 26, fontWeight: 700, color: done ? T.gain : T.loss, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
            {fmtUSD(remaining)}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontFamily: FM, fontSize: 11, color: T.gain, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
            {fmtUSD(paid)} paid
          </div>
          <div style={{ fontFamily: FM, fontSize: 11, color: color, fontWeight: 600 }}>
            {Math.min(pct, 100).toFixed(1)}% cleared
          </div>
        </div>
      </div>

      <ProgressBar pct={pct} color={color} />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: T.s3, flexWrap: "wrap" }}>
        <span style={{ fontFamily: FM, fontSize: 11, color: T.muted, fontVariantNumeric: "tabular-nums" }}>
          of {fmtUSD(original)} original
        </span>
        <span style={{ fontFamily: FM, fontSize: 11, color: done ? T.gain : T.muted, letterSpacing: "0.04em" }}>
          {payoff}
        </span>
      </div>

      {linkedMissing && (
        <div style={{
          fontFamily: FP, fontSize: 11, color: T.gold, lineHeight: 1.5,
          padding: `${T.s2} ${T.s3}`, background: `${T.gold}10`,
          border: `1px solid ${T.gold}30`, borderRadius: T.rSm,
          display: "flex", alignItems: "flex-start", gap: 6,
        }}>
          <Icon name="info" size={12} color={T.gold} style={{ marginTop: 1 }}/>
          Linked account not found — reconnect it in Finances, or edit this debt to track manually.
        </div>
      )}

      {/* Detected recurring payment → offer to link it (auto-syncs paydown). */}
      {suggestion && !linkedStream && onLinkStream && (
        <div style={{
          fontFamily: FP, fontSize: 11, color: T.gain, lineHeight: 1.5,
          padding: `${T.s2} ${T.s3}`, background: `${T.gain}10`,
          border: `1px solid ${T.gain}30`, borderRadius: T.rSm,
          display: "flex", alignItems: "center", gap: T.s2, flexWrap: "wrap",
        }}>
          <Icon name="spark" size={12} color={T.gain} style={{ flexShrink: 0 }}/>
          <span style={{ flex: 1, minWidth: 140 }}>
            Detected a recurring {fmtUSD(suggestion.stream.typicalAmount)}
            {suggestion.stream.cadence && suggestion.stream.cadence !== "unknown" ? `/${(CADENCE_LABEL[suggestion.stream.cadence] || suggestion.stream.cadence)}` : ""} payment to <strong>{suggestion.stream.merchant}</strong>.
          </span>
          <button onClick={() => onLinkStream(debt.id, suggestion.stream)} style={{ ...smallBtnStyle, color: T.gain, borderColor: T.gain + "40" }}>Link payments</button>
        </div>
      )}

      {/* Linked: paydown auto-syncs from the bank feed. */}
      {linkedStream && (
        <div style={{
          fontFamily: FP, fontSize: 11, color: T.muted, lineHeight: 1.5,
          padding: `${T.s2} ${T.s3}`, background: `${T.gain}0c`,
          border: `1px solid ${T.gain}25`, borderRadius: T.rSm,
          display: "flex", alignItems: "center", gap: T.s2, flexWrap: "wrap",
        }}>
          <Icon name="check" size={12} color={T.gain} style={{ flexShrink: 0 }}/>
          <span style={{ flex: 1, minWidth: 140, color: T.text }}>
            Auto-synced from <strong>{linkedStream.merchant}</strong> · {streamPaidCount} payment{streamPaidCount === 1 ? "" : "s"} imported
          </span>
          <button onClick={() => onUnlinkStream(debt.id)} style={smallBtnStyle}>Unlink</button>
        </div>
      )}

      {/* Actions vary by mode. */}
      <div style={{ paddingTop: T.s2, borderTop: `1px solid ${T.border}` }}>
        {done ? (
          <span style={{ fontFamily: FM, fontSize: 11, color: T.gain, fontWeight: 600 }}>✓ Fully paid off</span>
        ) : mode === "balance" ? (
          <span style={{ fontFamily: FP, fontSize: 11, color: T.muted }}>
            Tracks your linked balance automatically as payments post.
          </span>
        ) : logging ? (
          <LogPaymentRow
            label="Log payment"
            onLog={(a, note) => { onLogPayment(debt.id, a, note); setLogging(false); }}
            onCancel={() => setLogging(false)}
          />
        ) : mode === "recurring" ? (
          <div style={{ display: "flex", gap: T.s2, alignItems: "center", flexWrap: "wrap" }}>
            {debt.autopay ? (
              <span style={{ fontFamily: FP, fontSize: 11, color: T.muted }}>
                Auto-counting {fmtUSD(amt)}/{CADENCE_LABEL[debt.cadence] || "month"}{fundLabel ? ` from ${fundLabel}` : ""}.
              </span>
            ) : (
              <button onClick={() => onConfirmScheduled(debt.id)} style={{ ...smallBtnStyle, color: T.gain, borderColor: T.gain + "40" }}>
                ✓ Confirm {CADENCE_LABEL[debt.cadence] || "month"}ly payment · {fmtUSD(amt)}
              </button>
            )}
            <button onClick={() => setLogging(true)} style={smallBtnStyle}>{debt.autopay ? "+ Log extra" : "Other amount"}</button>
            <button onClick={() => onMarkPaid(debt.id)} style={smallBtnStyle}>Mark paid off</button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: T.s2, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={() => setLogging(true)} style={{ ...smallBtnStyle, color: T.gain, borderColor: T.gain + "40" }}>+ Log payment</button>
            <button onClick={() => onMarkPaid(debt.id)} style={smallBtnStyle}>Mark paid off</button>
          </div>
        )}
      </div>
    </div>
  );
}

// Compact radio list of accounts for the form (liability picker or funding picker).
function AccountRadioList({ accounts, selectedId, onPick, emptyHint }) {
  if (accounts.length === 0) {
    return (
      <div style={{ fontFamily: FP, fontSize: 12, color: T.muted, padding: T.s3, textAlign: "center", background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.rMd }}>
        {emptyHint}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 200, overflowY: "auto", padding: T.s2, background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.rMd }}>
      {accounts.map((a) => (
        <label key={a.id} style={{
          display: "flex", alignItems: "center", gap: T.s2, padding: `6px ${T.s2}`, borderRadius: T.rSm, cursor: "pointer",
          background: selectedId === a.id ? `${T.blue}18` : "transparent",
          border: `1px solid ${selectedId === a.id ? T.blue + "60" : T.border}`,
        }}>
          <input type="radio" checked={selectedId === a.id} onChange={() => onPick(a.id)} style={{ cursor: "pointer" }}/>
          <span style={{ fontFamily: FP, fontSize: 12, color: T.text, flex: 1 }}>{a.label}</span>
          <span style={{ fontFamily: FM, fontSize: 11, color: a.isDebt ? T.loss : T.muted }}>{fmtUSD(a.balance)}</span>
        </label>
      ))}
    </div>
  );
}

function DebtForm({ initial, liabilityAccounts, fundingAccounts, onSave, onCancel }) {
  const [name, setName] = useState(initial?.name || "");
  const [creditor, setCreditor] = useState(initial?.creditor || "");
  const [icon, setIcon] = useState(initial?.icon || "scale");
  const [original, setOriginal] = useState(initial?.original != null ? String(initial.original) : "");
  const [apr, setApr] = useState(initial?.apr != null ? String(initial.apr) : "");
  const [targetDate, setTargetDate] = useState(initial?.target_date || "");
  const [mode, setMode] = useState(initial ? debtMode(initial) : "manual");
  const [linkedId, setLinkedId] = useState(initial?.linked_account_id || "");
  const [paymentAmount, setPaymentAmount] = useState(initial?.payment_amount != null ? String(initial.payment_amount) : "");
  const [cadence, setCadence] = useState(initial?.cadence || "monthly");
  const [autopay, setAutopay] = useState(initial?.autopay ?? true);
  const [fundingId, setFundingId] = useState(initial?.funding_account_id || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const pickTemplate = (t) => {
    setName(t.name === "Custom Debt" ? "" : t.name);
    setIcon(t.icon);
    if (t.id === "credit") setMode("balance");
    else if (t.id === "qard" || t.id === "personal") setMode("recurring");
  };

  const pickLinked = (id) => {
    setLinkedId(id);
    if (!original) {
      const a = liabilityAccounts.find((x) => x.id === id);
      if (a) setOriginal(String(Math.round(a.balance)));
    }
  };

  const submit = async () => {
    setErr(null);
    const nm = name.trim();
    const amt = Number(original);
    if (!nm) { setErr("Give this debt a name."); return; }
    if (!Number.isFinite(amt) || amt <= 0) { setErr("Original balance must be a positive number."); return; }
    if (mode === "balance" && !linkedId) { setErr("Pick a credit/loan account to link, or choose another track mode."); return; }
    if (mode === "recurring") {
      const p = Number(paymentAmount);
      if (!Number.isFinite(p) || p <= 0) { setErr("Enter the recurring payment amount."); return; }
    }
    setBusy(true);
    try {
      await onSave({
        name: nm,
        creditor: creditor.trim() || null,
        icon,
        original: amt,
        apr: apr === "" ? null : (Number(apr) || 0),
        target_date: targetDate || null,
        mode,
        linked_account_id: mode === "balance" ? linkedId : null,
        payment_amount: mode === "recurring" ? Number(paymentAmount) || 0 : null,
        cadence: mode === "recurring" ? cadence : null,
        autopay: mode === "recurring" ? autopay : false,
        funding_account_id: mode === "recurring" ? (fundingId || null) : null,
      });
    } catch (e) {
      setErr(e?.message || "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const modeHelp = mode === "balance"
    ? "Reads the linked account's live balance — best for a card or loan that reports to Plaid."
    : mode === "recurring"
      ? "Track a set payment on a schedule (e.g. paying a friend or a card from checking). Autopay counts each scheduled payment automatically."
      : "Log each payment yourself, any amount, whenever you pay.";

  return (
    <div style={{
      background: T.card,
      border: `1px solid ${T.borderHi}`,
      borderRadius: T.rLg,
      padding: T.s5,
      display: "flex", flexDirection: "column", gap: T.s4,
    }}>
      <div style={{ fontFamily: FM, fontSize: 11, color: T.muted, letterSpacing: "0.18em", fontWeight: 600 }}>
        {initial?.id ? "EDIT DEBT" : "NEW DEBT"}
      </div>

      {!initial?.id && (
        <div style={{ display: "flex", gap: T.s2, flexWrap: "wrap" }}>
          {DEBT_TEMPLATES.map((t) => (
            <button
              key={t.id}
              onClick={() => pickTemplate(t)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                fontFamily: FM, fontSize: 11, color: icon === t.icon ? T.blue : T.text,
                background: icon === t.icon ? `${T.blue}14` : T.surface,
                border: `1px solid ${icon === t.icon ? T.blue + "60" : T.border}`,
                borderRadius: 999, padding: "6px 12px", cursor: "pointer",
              }}
            >
              <Icon name={t.icon} size={14} color={icon === t.icon ? T.blue : T.muted}/>{t.name}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: T.s3 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontFamily: FM, fontSize: 10, color: T.muted, letterSpacing: "0.1em" }}>NAME</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Auto financing" style={inputStyle}/>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontFamily: FM, fontSize: 10, color: T.muted, letterSpacing: "0.1em" }}>OWED TO · OPT</span>
          <input value={creditor} onChange={(e) => setCreditor(e.target.value)} placeholder="Bank or person" style={inputStyle}/>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontFamily: FM, fontSize: 10, color: T.muted, letterSpacing: "0.1em" }}>ORIGINAL ($)</span>
          <input value={original} onChange={(e) => setOriginal(e.target.value)} inputMode="decimal" placeholder="6000" style={inputStyle}/>
        </label>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: T.s3 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontFamily: FM, fontSize: 10, color: T.muted, letterSpacing: "0.1em" }}>APR (%) · OPT</span>
          <input value={apr} onChange={(e) => setApr(e.target.value)} inputMode="decimal" placeholder="0 (interest-free)" style={inputStyle}/>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontFamily: FM, fontSize: 10, color: T.muted, letterSpacing: "0.1em" }}>PAYOFF BY · OPT</span>
          <input type="date" value={targetDate || ""} onChange={(e) => setTargetDate(e.target.value)} style={inputStyle}/>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontFamily: FM, fontSize: 10, color: T.muted, letterSpacing: "0.1em" }}>TRACK MODE</span>
          <select value={mode} onChange={(e) => setMode(e.target.value)} style={inputStyle}>
            <option value="manual">Manual payments</option>
            <option value="recurring">Recurring plan</option>
            <option value="balance">Linked balance</option>
          </select>
        </label>
      </div>

      <div style={{ fontFamily: FP, fontSize: 11, color: T.muted, lineHeight: 1.5, marginTop: -6 }}>
        {modeHelp} Leave APR blank for interest-free loans (qard hasan); set it only for an interest-bearing balance like an overdue card.
      </div>

      {mode === "balance" && (
        <div style={{ display: "flex", flexDirection: "column", gap: T.s2 }}>
          <span style={{ fontFamily: FM, fontSize: 10, color: T.muted, letterSpacing: "0.1em" }}>CREDIT / LOAN ACCOUNT</span>
          <AccountRadioList
            accounts={liabilityAccounts}
            selectedId={linkedId}
            onPick={pickLinked}
            emptyHint="No credit or loan accounts connected. Link one in Finances, or use Manual / Recurring."
          />
        </div>
      )}

      {mode === "recurring" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: T.s3, alignItems: "end" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontFamily: FM, fontSize: 10, color: T.muted, letterSpacing: "0.1em" }}>PAYMENT ($)</span>
              <input value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} inputMode="decimal" placeholder="500" style={inputStyle}/>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontFamily: FM, fontSize: 10, color: T.muted, letterSpacing: "0.1em" }}>EVERY</span>
              <select value={cadence} onChange={(e) => setCadence(e.target.value)} style={inputStyle}>
                <option value="weekly">Week</option>
                <option value="biweekly">2 weeks</option>
                <option value="monthly">Month</option>
              </select>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, paddingBottom: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={autopay} onChange={(e) => setAutopay(e.target.checked)} style={{ cursor: "pointer" }}/>
              <span style={{ fontFamily: FP, fontSize: 12, color: T.text }}>Autopay</span>
            </label>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: T.s2 }}>
            <span style={{ fontFamily: FM, fontSize: 10, color: T.muted, letterSpacing: "0.1em" }}>FUNDING ACCOUNT · OPT (WHERE PAYMENTS COME FROM)</span>
            <AccountRadioList
              accounts={fundingAccounts}
              selectedId={fundingId}
              onPick={(id) => setFundingId(id === fundingId ? "" : id)}
              emptyHint="No accounts connected. You can still track the plan without linking a funding account."
            />
          </div>
        </>
      )}

      {err && (
        <div style={{ fontFamily: FP, fontSize: 12, color: T.loss, padding: T.s2, background: `${T.loss}15`, border: `1px solid ${T.loss}40`, borderRadius: T.rSm }}>{err}</div>
      )}

      <div style={{ display: "flex", gap: T.s2, justifyContent: "flex-end" }}>
        <button onClick={onCancel} disabled={busy} style={ghostBtnStyle}>Cancel</button>
        <button onClick={submit} disabled={busy} style={primaryBtnStyle}>{busy ? "Saving…" : (initial?.id ? "Save" : "Add debt")}</button>
      </div>
    </div>
  );
}

// Lightweight inline-SVG burn-down: total remaining balance falling to $0 over
// the projected months. No Recharts import (keeps this file's bundle lean).
function BurnDownChart({ series, months }) {
  const W = 560, H = 130, PADX = 6, PADY = 10;
  if (!series || series.length < 2) return null;
  const maxT = Math.max(...series.map((p) => p.total), 1);
  const maxM = Math.max(series[series.length - 1].month, 1);
  const x = (m) => PADX + (m / maxM) * (W - 2 * PADX);
  const y = (t) => PADY + (1 - t / maxT) * (H - 2 * PADY);
  const line = series.map((p) => `${x(p.month).toFixed(1)},${y(p.total).toFixed(1)}`).join(" ");
  const area = `${PADX},${(H - PADY).toFixed(1)} ${line} ${x(maxM).toFixed(1)},${(H - PADY).toFixed(1)}`;
  // A few year gridlines so long payoffs stay readable.
  const yearMarks = [];
  for (let m = 12; m <= maxM; m += 12) yearMarks.push(m);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img" aria-label="Projected debt burn-down">
      <defs>
        <linearGradient id="burnFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={T.loss} stopOpacity="0.28" />
          <stop offset="100%" stopColor={T.loss} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {yearMarks.map((m) => (
        <line key={m} x1={x(m)} y1={PADY} x2={x(m)} y2={H - PADY} stroke={T.border} strokeWidth="1" strokeDasharray="2 4" />
      ))}
      <polygon points={area} fill="url(#burnFill)" />
      <polyline points={line} fill="none" stroke={T.loss} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(maxM)} cy={y(0)} r="3.5" fill={T.gain} />
    </svg>
  );
}

const STRATEGIES = [
  { id: "riba", label: "Riba-first", hint: "Clear interest-bearing debt fastest — least interest paid, on-mission." },
  { id: "avalanche", label: "Avalanche", hint: "Highest APR first — mathematically least total interest." },
  { id: "snowball", label: "Snowball", hint: "Smallest balance first — quick wins for momentum." },
];

// Debt-payoff planner: pick a strategy + an optional extra monthly payment, and
// see the debt-free date, total interest, payoff order, and a burn-down chart.
// All math is the pure computePayoffPlan simulation — nothing is stored.
function PayoffPlanner({ planDebts }) {
  const [strategy, setStrategy] = useState("riba");
  const [extra, setExtra] = useState("");
  const plan = useMemo(
    () => computePayoffPlan(planDebts, extra, strategy),
    [planDebts, extra, strategy],
  );
  const idToDebt = useMemo(() => new Map(planDebts.map((d) => [d.id, d])), [planDebts]);
  if (planDebts.length === 0) return null;

  const freeDate = plan.feasible && plan.months > 0
    ? fmtDate(new Date(Date.now() + plan.months * 30.44 * 86_400_000).toISOString().slice(0, 10))
    : null;
  const yrs = Math.floor(plan.months / 12), mos = plan.months % 12;
  const durLabel = plan.months <= 0 ? "—"
    : `${yrs ? `${yrs}y ` : ""}${mos}mo`;

  return (
    <div className="bento-tile" style={{
      background: `linear-gradient(135deg, ${T.blue}0c, transparent 60%), ${T.card}`,
      border: `1px solid ${T.border}`,
      borderTop: `2px solid ${T.blue}`,
      borderLeft: `1px solid ${T.blue}30`,
      borderRadius: T.rLg,
      padding: T.s5,
      display: "flex", flexDirection: "column", gap: T.s4,
      boxShadow: "var(--sh-md)",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: T.s3 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontFamily: FM, fontSize: 11, color: T.blue, letterSpacing: "0.18em", fontWeight: 600 }}>PAYOFF PLANNER</span>
          <span style={{ fontFamily: FP, fontSize: 12, color: T.muted }}>How fast can you be debt-free? Choose an order and add anything extra.</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: T.s2 }}>
          <span style={{ fontFamily: FM, fontSize: 10, color: T.muted, letterSpacing: "0.1em" }}>EXTRA / MO</span>
          <div style={{ display: "flex", alignItems: "center", gap: 4, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, padding: "2px 8px" }}>
            <span style={{ fontFamily: FM, fontSize: 12, color: T.muted }}>$</span>
            <input
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              inputMode="decimal"
              placeholder="0"
              style={{ fontFamily: FM, fontSize: 13, color: T.textHi, background: "transparent", border: "none", outline: "none", width: 72 }}
            />
          </div>
        </div>
      </div>

      {/* Strategy toggle */}
      <div style={{ display: "flex", gap: T.s2, flexWrap: "wrap" }}>
        {STRATEGIES.map((s) => (
          <button
            key={s.id}
            onClick={() => setStrategy(s.id)}
            title={s.hint}
            style={{
              display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2,
              flex: "1 1 150px", textAlign: "left",
              fontFamily: FM, fontSize: 12, fontWeight: 600,
              color: strategy === s.id ? T.blue : T.text,
              background: strategy === s.id ? `${T.blue}12` : T.surface,
              border: `1px solid ${strategy === s.id ? T.blue + "60" : T.border}`,
              borderRadius: T.rMd, padding: `${T.s2} ${T.s3}`, cursor: "pointer",
            }}
          >
            {s.label}
            <span style={{ fontFamily: FP, fontSize: 10, fontWeight: 400, color: T.muted, lineHeight: 1.35 }}>{s.hint}</span>
          </button>
        ))}
      </div>

      {/* Headline stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: T.s3 }}>
        <div>
          <div style={{ fontFamily: FM, fontSize: 9, color: T.muted, letterSpacing: "0.16em", fontWeight: 600 }}>DEBT-FREE IN</div>
          <div style={{ fontFamily: FU, fontSize: 22, fontWeight: 700, color: T.textHi, fontVariantNumeric: "tabular-nums" }}>{plan.feasible ? durLabel : "—"}</div>
          {freeDate && <div style={{ fontFamily: FM, fontSize: 10, color: T.muted }}>~{freeDate}</div>}
        </div>
        <div>
          <div style={{ fontFamily: FM, fontSize: 9, color: T.muted, letterSpacing: "0.16em", fontWeight: 600 }}>INTEREST PAID</div>
          <div style={{ fontFamily: FU, fontSize: 22, fontWeight: 700, color: plan.totalInterest > 0 ? T.loss : T.gain, fontVariantNumeric: "tabular-nums" }}>{fmtUSD(plan.totalInterest)}</div>
          <div style={{ fontFamily: FM, fontSize: 10, color: T.muted }}>{plan.totalInterest > 0 ? "riba over the plan" : "no interest — qard hasan"}</div>
        </div>
        <div>
          <div style={{ fontFamily: FM, fontSize: 9, color: T.muted, letterSpacing: "0.16em", fontWeight: 600 }}>STARTING TOTAL</div>
          <div style={{ fontFamily: FU, fontSize: 22, fontWeight: 700, color: T.textHi, fontVariantNumeric: "tabular-nums" }}>{fmtUSD(plan.startTotal)}</div>
        </div>
      </div>

      {!plan.feasible && (
        <div style={{ fontFamily: FP, fontSize: 12, color: T.gold, padding: `${T.s2} ${T.s3}`, background: `${T.gold}10`, border: `1px solid ${T.gold}30`, borderRadius: T.rSm }}>
          At these payments the balance never clears (interest outpaces payments). Add an extra monthly amount to see a debt-free date.
        </div>
      )}

      {plan.feasible && plan.series.length > 2 && <BurnDownChart series={plan.series} months={plan.months} />}

      {/* Payoff order */}
      {plan.order.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontFamily: FM, fontSize: 10, color: T.muted, letterSpacing: "0.12em", fontWeight: 600 }}>PAYOFF ORDER</span>
          {plan.order.map((o, i) => {
            const eta = fmtDate(new Date(Date.now() + o.month * 30.44 * 86_400_000).toISOString().slice(0, 10));
            return (
              <div key={o.id} style={{ display: "flex", alignItems: "center", gap: T.s2 }}>
                <span style={{ fontFamily: FM, fontSize: 11, color: T.blue, fontWeight: 600, width: 18 }}>{i + 1}.</span>
                <Icon name={o.icon || "scale"} size={14} color={o.interestFree ? T.gain : T.loss} style={{ flexShrink: 0 }} />
                <span style={{ fontFamily: FP, fontSize: 13, color: T.textHi, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.name}</span>
                <span style={{ fontFamily: FM, fontSize: 11, color: T.muted, fontVariantNumeric: "tabular-nums" }}>~{eta}</span>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ fontFamily: FP, fontSize: 10, color: T.muted, lineHeight: 1.5 }}>
        Estimate only. Assumes each debt's minimum (its recurring amount, your set minimum, or a card-style estimate) plus your extra, with freed-up payments rolling to the next debt. Not financial advice.
      </div>
    </div>
  );
}

function DebtSection({ plaidAccounts = [], demoMode = false }) {
  const [debts, setDebts] = useState([]);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState(null);

  // Recurring outflow streams (bank/card payments), used to auto-detect and
  // link payments toward tracked debts. Demo uses a fixture; real mode reads
  // Plaid's native /recurring, falling back to detecting from transactions.
  const [streams, setStreams] = useState([]);

  useEffect(() => {
    if (demoMode) { setDebts(DEMO_DEBTS(plaidAccounts)); return; }
    setDebts(readDebts());
  }, [demoMode, plaidAccounts]);

  useEffect(() => {
    if (demoMode) { setStreams(DEMO_DEBT_STREAMS()); return; }
    let cancelled = false;
    (async () => {
      try {
        const r = await apiFetch("/api/plaid/recurring");
        if (!cancelled && r.ok) {
          const d = await r.json().catch(() => ({}));
          const s = normalizePlaidStreams(d);
          if (s.length) { setStreams(s); return; }
        }
        // Fallback: detect from raw transactions when the native stream is empty.
        const tr = await apiFetch("/api/plaid/transactions");
        if (!cancelled && tr.ok) {
          const td = await tr.json().catch(() => ({}));
          setStreams(detectRecurringOutflows(Array.isArray(td?.transactions) ? td.transactions : []));
        }
      } catch { /* no streams → detection simply doesn't surface */ }
    })();
    return () => { cancelled = true; };
  }, [demoMode]);

  const persist = useCallback((next) => {
    setDebts(next);
    if (!demoMode) setLocalAndSync(DEBT_KEY, next);
  }, [demoMode]);

  // Reconcile linked debts: pull any newly-posted payments from their linked
  // stream in as real payment entries (deduped by a stable extId), so paydown
  // stays current with the bank feed. The extId guard makes this idempotent —
  // a run that adds nothing never persists, so no render loop.
  useEffect(() => {
    if (!streams.length || !debts.length) return;
    let changed = false;
    const next = debts.map((d) => {
      if (!d.payment_stream_key) return d;
      const stream = streams.find((s) => s.key === d.payment_stream_key);
      if (!stream) return d;
      const since = d.link_since || d.start_date || d.created_at;
      const have = new Set((d.payments || []).filter((p) => p.source === "stream").map((p) => p.extId));
      const add = streamPaymentsSince(stream, since)
        .map((p) => ({ extId: `${d.payment_stream_key}|${p.date}|${p.amount}`, ...p }))
        .filter((p) => !have.has(p.extId))
        .map((p) => ({ id: genDebtId(), amount: p.amount, date: new Date(p.date).toISOString(), note: `Auto — ${stream.merchant}`, source: "stream", streamKey: d.payment_stream_key, extId: p.extId }));
      if (!add.length) return d;
      changed = true;
      return { ...d, payments: [...(d.payments || []), ...add] };
    });
    if (changed) persist(next);
  }, [streams, debts, persist]);

  // Liability accounts (credit/loan) for balance-linked mode; ALL accounts as
  // funding-source choices for recurring plans (checking is the common case).
  const liabilityAccounts = useMemo(() => (plaidAccounts || [])
    .filter(isDebtAcct)
    .map((a) => ({ id: String(a.account_id || ""), label: `${a.institution_name || "Bank"} — ${a.name || a.subtype || a.type || "Account"}`, balance: Math.abs(Number(a.current_bal) || 0), isDebt: true }))
    .filter((a) => a.id), [plaidAccounts]);

  const fundingAccounts = useMemo(() => (plaidAccounts || [])
    .map((a) => ({ id: String(a.account_id || ""), label: `${a.institution_name || "Bank"} — ${a.name || a.subtype || a.type || "Account"}`, balance: Math.abs(Number(a.current_bal) || 0), isDebt: isDebtAcct(a) }))
    .filter((a) => a.id), [plaidAccounts]);

  const labelFor = useCallback((id) =>
    fundingAccounts.find((a) => a.id === String(id))?.label || "", [fundingAccounts]);

  const addDebt = (payload) => {
    persist([...debts, { id: genDebtId(), created_at: new Date().toISOString(), start_date: new Date().toISOString(), payments: [], ...payload }]);
    setCreating(false);
  };
  const saveDebt = (id, payload) => {
    persist(debts.map((d) => d.id === id ? { ...d, ...payload } : d));
    setEditingId(null);
  };
  const deleteDebt = (debt) => {
    if (!confirm(`Delete "${debt.name}"? Its payment history will be removed.`)) return;
    persist(debts.filter((d) => d.id !== debt.id));
  };
  const logPayment = (id, amount, note) => {
    const d = debts.find((x) => x.id === id);
    if (!d) return;
    const pay = { id: genDebtId(), amount: Number(amount) || 0, date: new Date().toISOString(), note: note || "" };
    persist(debts.map((x) => x.id === id ? { ...x, payments: [...(x.payments || []), pay] } : x));
  };
  const confirmScheduled = (id) => {
    const d = debts.find((x) => x.id === id);
    if (!d) return;
    logPayment(id, Number(d.payment_amount) || 0, "Scheduled payment");
  };
  const markPaid = (id) => {
    const d = debts.find((x) => x.id === id);
    if (!d) return;
    const { remaining } = debtState(d, plaidAccounts);
    if (remaining > 0) logPayment(id, remaining, "Marked fully paid off");
  };

  // Link a detected recurring stream to a debt: import its posted payments and
  // remember the stream so the reconcile effect keeps pulling new ones. A
  // recurring debt's autopay ESTIMATE is turned off to avoid double-counting
  // (real stream payments now drive the paydown).
  const linkStream = (id, stream) => {
    persist(debts.map((d) => {
      if (d.id !== id) return d;
      const since = d.start_date || d.created_at;
      const imported = streamPaymentsSince(stream, since).map((p) => ({
        id: genDebtId(), amount: p.amount, date: new Date(p.date).toISOString(),
        note: `Auto — ${stream.merchant}`, source: "stream", streamKey: stream.key, extId: `${stream.key}|${p.date}|${p.amount}`,
      }));
      const kept = (d.payments || []).filter((p) => p.source !== "stream");
      return { ...d, payment_stream_key: stream.key, link_since: since, autopay: false, payments: [...kept, ...imported] };
    }));
  };
  const unlinkStream = (id) => {
    persist(debts.map((d) => d.id !== id ? d
      : { ...d, payment_stream_key: null, link_since: null, payments: (d.payments || []).filter((p) => p.source !== "stream") }));
  };

  // Suggested stream match per UNLINKED debt (name/amount scored). Balance-mode
  // debts track live, so they don't need payment linking.
  const suggestionFor = useCallback((debt) => {
    if (debt.payment_stream_key || debtMode(debt) === "balance") return null;
    const expected = debtMode(debt) === "recurring" ? monthlyFromCadence(debt.payment_amount, debt.cadence) : 0;
    return matchDebtToStream(debt, streams, { expectedAmount: expected });
  }, [streams]);

  const totals = useMemo(() => {
    let remaining = 0, original = 0, paid = 0;
    debts.forEach((d) => {
      const s = debtState(d, plaidAccounts);
      remaining += s.remaining; original += s.original; paid += s.paid;
    });
    return { remaining, original, paid, pct: original > 0 ? (paid / original) * 100 : 0 };
  }, [debts, plaidAccounts]);

  // Debts (with live remaining + APR) fed to the payoff planner. Only those with
  // a balance left; a debt in edit mode is excluded so the plan doesn't flicker.
  const planDebts = useMemo(() => debts
    .filter((d) => d.id !== editingId)
    .map((d) => ({ id: d.id, name: d.name, icon: iconForDebt(d), apr: Number(d.apr) || 0, remaining: debtState(d, plaidAccounts).remaining,
                   payment_amount: d.payment_amount, cadence: d.cadence, min_payment: d.min_payment, mode: d.mode, target_date: d.target_date }))
    .filter((d) => d.remaining > 0.005), [debts, plaidAccounts, editingId]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: T.s4, marginTop: T.s5 }}>
      <div className="bento-tile" style={{
        background: `radial-gradient(circle at 0% 0%, ${T.loss}14, transparent 55%), ${T.card}`,
        border: `1px solid ${T.border}`,
        borderTop: `2px solid ${T.loss}`,
        borderLeft: `1px solid ${T.loss}30`,
        borderRadius: T.rLg,
        padding: `${T.s6} ${T.s5}`,
        display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: T.s3,
        boxShadow: "var(--sh-md)",
        transition: "transform 0.18s cubic-bezier(.34,1.56,.64,1), box-shadow 0.2s, border-color 0.2s",
      }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontFamily: FM, fontSize: 11, color: T.loss, letterSpacing: "0.18em", fontWeight: 600 }}>
            DEBTS · {debts.length} TRACKED
          </span>
          <span style={{ fontFamily: FU, fontSize: 22, fontWeight: 600, color: T.textHi, letterSpacing: "-0.01em" }}>
            {debts.length > 0 ? <>{fmtUSD(totals.remaining)} left to clear</> : <>Pay off what you owe</>}
          </span>
          <span style={{ fontFamily: FP, fontSize: 13, color: T.muted, letterSpacing: "-0.005em" }}>
            {debts.length > 0
              ? <>{fmtUSD(totals.paid)} cleared · {Math.min(totals.pct, 100).toFixed(0)}% of {fmtUSD(totals.original)} original</>
              : <>Track any debt — a card, a bank loan, or money owed to a friend. Log payments, link a balance, or pay on a schedule from checking.</>}
          </span>
        </div>
        {!creating && (
          <button onClick={() => { setCreating(true); setEditingId(null); }} style={{ ...primaryBtnStyle, background: `linear-gradient(135deg, ${T.loss}, #8a2b2d)` }}>+ Add debt</button>
        )}
      </div>

      {creating && (
        <DebtForm liabilityAccounts={liabilityAccounts} fundingAccounts={fundingAccounts} onSave={addDebt} onCancel={() => setCreating(false)} />
      )}

      {/* Payoff planner — appears once there are ≥2 outstanding debts, where
          strategy/order actually changes the outcome. */}
      {planDebts.length >= 2 && <PayoffPlanner planDebts={planDebts} />}

      {!creating && debts.length === 0 && (
        <div style={{
          fontFamily: FP, fontSize: 14, color: T.muted,
          padding: T.s8, textAlign: "center",
          border: `1px dashed ${T.border}`, borderRadius: T.rLg,
          display: "flex", flexDirection: "column", alignItems: "center", gap: T.s3,
        }}>
          <Icon name="scale" size={28} color={T.muted}/>
          <span>No debts tracked. Add one to watch the balance count down as you pay it off.</span>
          <button onClick={() => setCreating(true)} style={{ ...primaryBtnStyle, background: `linear-gradient(135deg, ${T.loss}, #8a2b2d)` }}>Add your first debt →</button>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: T.s4 }}>
        {debts.map((d) => editingId === d.id ? (
          <DebtForm
            key={d.id}
            initial={d}
            liabilityAccounts={liabilityAccounts}
            fundingAccounts={fundingAccounts}
            onSave={(p) => saveDebt(d.id, p)}
            onCancel={() => setEditingId(null)}
          />
        ) : (
          <DebtCard
            key={d.id}
            debt={d}
            accounts={plaidAccounts}
            labelFor={labelFor}
            suggestion={suggestionFor(d)}
            linkedStream={d.payment_stream_key ? streams.find((s) => s.key === d.payment_stream_key) : null}
            onLinkStream={linkStream}
            onUnlinkStream={unlinkStream}
            onEdit={() => { setEditingId(d.id); setCreating(false); }}
            onDelete={deleteDebt}
            onLogPayment={logPayment}
            onConfirmScheduled={confirmScheduled}
            onMarkPaid={markPaid}
          />
        ))}
      </div>
    </div>
  );
}
