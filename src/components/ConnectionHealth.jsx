// ConnectionHealth — triage view for every SnapTrade + Plaid item the
// user has linked. Used as a Settings sub-tab so the operator and the
// user can both see at a glance which connections are healthy vs need
// re-auth, and when each last synced.
//
// Data comes from GET /api/connections/health which merges:
//   · Plaid:     plaid_tokens rows + most-recent webhook code + most-recent
//                 plaid_transactions.updated_at for "last sync"
//   · SnapTrade: GET /authorizations + `disabled` field
//
// No new schema. No new state. One read on mount.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/apiFetch";

// Local visual tokens mirroring the rest of the app — using CSS vars so
// light + dark themes both work without us reaching into MizanApp.
const T = {
  card:    "var(--mz-card)",
  surface: "var(--mz-surface)",
  border:  "var(--mz-border)",
  textHi:  "var(--mz-textHi)",
  text:    "var(--mz-text)",
  muted:   "var(--mz-muted)",
  rMd:     "var(--r-md)",
  rSm:     "var(--r-sm)",
  s1:      "var(--s-1)",
  s2:      "var(--s-2)",
  s3:      "var(--s-3)",
  s4:      "var(--s-4)",
  s5:      "var(--s-5)",
  blue:    "#5B8DEF",
  gold:    "#D4AF37",
  gain:    "#0FB07A",
  loss:    "#FF6B6B",
};
const FM = "var(--font-mono, ui-monospace, Menlo, monospace)";
const FU = "var(--font-ui, system-ui, sans-serif)";

function relativeTime(iso) {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "never";
  const s = Math.floor(ms / 1000);
  if (s < 60)   return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)   return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48)   return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30)   return `${d}d ago`;
  const mo = Math.floor(d / 30);
  return `${mo}mo ago`;
}

function StatusPill({ status, errorCode }) {
  const map = {
    ok:    { color: T.gain, label: "✓ Healthy" },
    reauth:{ color: T.gold, label: errorCode === "DISABLED" ? "⚠ Disabled" : "⚠ Re-auth needed" },
    error: { color: T.loss, label: "✗ Error" },
  };
  const hit = map[status] || map.error;
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      padding: `2px ${T.s2}`,
      background: `${hit.color}14`,
      border: `1px solid ${hit.color}40`,
      borderRadius: 999,
      fontFamily: FM,
      fontSize: 10,
      fontWeight: 600,
      letterSpacing: "0.08em",
      color: hit.color,
    }}>{hit.label}</span>
  );
}

function ProviderBadge({ provider }) {
  const isPlaid = provider === "plaid";
  const color = isPlaid ? T.gold : T.blue;
  return (
    <span style={{
      fontFamily: FM,
      fontSize: 8,
      fontWeight: 700,
      letterSpacing: "0.16em",
      color,
      padding: `1px ${T.s1}`,
      border: `1px solid ${color}40`,
      borderRadius: T.rSm,
    }}>{isPlaid ? "PLAID" : "SNAPTRADE"}</span>
  );
}

export default function ConnectionHealth({ onNav } = {}) {
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await apiFetch("/api/connections/health");
      if (!r.ok) {
        if (r.status === 401) { setItems([]); return; }
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${r.status}`);
      }
      const json = await r.json();
      setItems(Array.isArray(json?.items) ? json.items : []);
    } catch (e) {
      setErr(e?.message || "Failed to load connection health");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => ({
    total:  items.length,
    ok:     items.filter(i => i.status === "ok").length,
    reauth: items.filter(i => i.status === "reauth").length,
    error:  items.filter(i => i.status === "error").length,
  }), [items]);

  // Sort: reauth first (action-required), then by last_sync_at desc (most
  // recently active first), then by institution.
  const sorted = useMemo(() => {
    const order = { reauth: 0, error: 1, ok: 2 };
    return [...items].sort((a, b) => {
      const so = (order[a.status] ?? 9) - (order[b.status] ?? 9);
      if (so !== 0) return so;
      const at = a.last_sync_at ? Date.parse(a.last_sync_at) : 0;
      const bt = b.last_sync_at ? Date.parse(b.last_sync_at) : 0;
      if (bt !== at) return bt - at;
      return (a.institution || "").localeCompare(b.institution || "");
    });
  }, [items]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: T.s4 }}>
      {/* Header tile */}
      <div style={{
        background: `radial-gradient(circle at 0% 0%, ${T.blue}14, transparent 55%), ${T.card}`,
        border: `1px solid ${T.border}`,
        borderRadius: T.rMd,
        padding: `${T.s5} ${T.s5}`,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        flexWrap: "wrap",
        gap: T.s3,
      }}>
        <div>
          <div style={{ fontFamily: FM, fontSize: 10, color: T.muted, letterSpacing: "0.16em", fontWeight: 600, marginBottom: T.s1 }}>
            CONNECTION HEALTH
          </div>
          <div style={{ fontFamily: FU, fontSize: 22, fontWeight: 600, color: T.textHi, letterSpacing: "-0.015em" }}>
            {counts.total === 0 ? "No connections yet" : `${counts.total} connection${counts.total === 1 ? "" : "s"} linked`}
          </div>
          <div style={{ fontFamily: FU, fontSize: 13, color: T.muted, marginTop: T.s1 }}>
            {counts.ok} healthy · {counts.reauth} need attention{counts.error > 0 ? ` · ${counts.error} error` : ""}
          </div>
        </div>
        <button onClick={load} disabled={loading}
          style={{
            padding: `8px ${T.s4}`,
            background: `${T.blue}14`,
            border: `1px solid ${T.blue}40`,
            color: T.blue,
            fontFamily: FM, fontSize: 11, fontWeight: 600, letterSpacing: "0.06em",
            borderRadius: T.rMd,
            cursor: loading ? "wait" : "pointer",
          }}>{loading ? "Refreshing…" : "↻ Refresh"}</button>
      </div>

      {err && (
        <div style={{
          fontFamily: FU, fontSize: 12, color: T.loss,
          padding: T.s3, background: `${T.loss}15`,
          border: `1px solid ${T.loss}40`, borderRadius: T.rMd,
        }}>{err}</div>
      )}

      {/* Empty state */}
      {!loading && !err && items.length === 0 && (
        <div style={{
          fontFamily: FU, fontSize: 13, color: T.muted,
          padding: `${T.s5} ${T.s4}`,
          textAlign: "center",
          background: T.card,
          border: `1px dashed ${T.border}`,
          borderRadius: T.rMd,
          lineHeight: 1.6,
        }}>
          You haven't linked any brokerage or bank accounts yet. Use the<br/>
          <strong style={{ color: T.text }}>Connect Accounts</strong> tab above to add your first one.
        </div>
      )}

      {/* Items */}
      {sorted.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: T.s2 }}>
          {sorted.map((it) => (
            <div key={`${it.provider}-${it.item_id}`} style={{
              background: T.card,
              border: `1px solid ${T.border}`,
              borderLeft: `3px solid ${it.status === "ok" ? T.gain : it.status === "reauth" ? T.gold : T.loss}`,
              borderRadius: T.rMd,
              padding: `${T.s3} ${T.s4}`,
              display: "grid",
              gridTemplateColumns: "minmax(0,1fr) auto",
              gap: T.s3,
              alignItems: "center",
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: T.s2, marginBottom: T.s1, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: FU, fontSize: 15, fontWeight: 600, color: T.textHi, letterSpacing: "-0.005em" }}>{it.institution}</span>
                  <ProviderBadge provider={it.provider} />
                  <StatusPill status={it.status} errorCode={it.error_code} />
                </div>
                <div style={{ fontFamily: FM, fontSize: 11, color: T.muted, display: "flex", flexWrap: "wrap", gap: T.s3 }}>
                  <span title={it.last_sync_at || ""}>Last sync: <strong style={{ color: it.last_sync_at ? T.text : T.loss }}>{relativeTime(it.last_sync_at)}</strong></span>
                  {it.error_code && it.error_code !== "DISABLED" && (
                    <span>Code: <code style={{ background: `${T.gold}1A`, padding: "1px 5px", borderRadius: 3, color: T.gold }}>{it.error_code}</code></span>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", gap: T.s2, flexShrink: 0 }}>
                {it.provider === "plaid" && onNav && (
                  <button onClick={() => onNav("finances")} style={{
                    padding: `6px ${T.s3}`,
                    background: it.status === "reauth" ? `${T.gold}14` : "transparent",
                    border: `1px solid ${it.status === "reauth" ? T.gold : T.border}40`,
                    color: it.status === "reauth" ? T.gold : T.muted,
                    fontFamily: FM, fontSize: 10, fontWeight: 600, letterSpacing: "0.06em",
                    borderRadius: T.rSm,
                    cursor: "pointer",
                  }}>{it.status === "reauth" ? "RE-AUTHORIZE" : "MANAGE"}</button>
                )}
                {it.provider === "snaptrade" && onNav && (
                  <button onClick={() => onNav("portfolio")} style={{
                    padding: `6px ${T.s3}`,
                    background: "transparent",
                    border: `1px solid ${T.border}`,
                    color: T.muted,
                    fontFamily: FM, fontSize: 10, fontWeight: 600, letterSpacing: "0.06em",
                    borderRadius: T.rSm,
                    cursor: "pointer",
                  }}>VIEW</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
