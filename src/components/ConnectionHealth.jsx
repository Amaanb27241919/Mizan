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
  rLg:     "var(--r-lg)",
  rMd:     "var(--r-md)",
  rSm:     "var(--r-sm)",
  s1:      "var(--s-1)",
  s2:      "var(--s-2)",
  s3:      "var(--s-3)",
  s4:      "var(--s-4)",
  s5:      "var(--s-5)",
  blue:    "#1e4e8c",   // gold — primary accent
  gold:    "#b8842a",   // amber — warnings
  gain:    "#117a52",   // jade — healthy
  loss:    "#b23a3d",   // rust — error
};
const FM = "'IBM Plex Mono','JetBrains Mono','Menlo','Monaco',monospace";
const FP = "'IBM Plex Sans',system-ui,-apple-system,BlinkMacSystemFont,sans-serif";
const FU = FP;

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
    ok:    { color: T.gain, label: "Healthy" },
    reauth:{ color: T.gold, label: errorCode === "DISABLED" ? "Disabled" : "Re-auth needed" },
    error: { color: T.loss, label: "Error" },
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

// Renders the Plaid /item/get diagnostic for one Item. The aim is to make
// "why is /transactions/sync empty?" answerable at a glance: did the user
// consent to transactions, did Plaid record a last_successful_update, is
// there an item-level error?
function DetailsPanel({ state }) {
  if (state.loading) {
    return (
      <div style={{
        gridColumn: "1 / -1",
        fontFamily: FM, fontSize: 11, color: T.muted,
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: T.rSm,
        padding: `${T.s2} ${T.s3}`,
        marginTop: T.s2,
      }}>Loading Plaid item status…</div>
    );
  }
  if (state.err) {
    return (
      <div style={{
        gridColumn: "1 / -1",
        fontFamily: FM, fontSize: 11, color: T.loss,
        background: `${T.loss}12`,
        border: `1px solid ${T.loss}40`,
        borderRadius: T.rSm,
        padding: `${T.s2} ${T.s3}`,
        marginTop: T.s2,
      }}>
        <div>Diagnostic failed: {state.err}</div>
        {state.debug && (
          <pre style={{
            margin: `${T.s2} 0 0 0`,
            padding: T.s2,
            background: T.surface,
            border: `1px solid ${T.border}`,
            borderRadius: T.rSm,
            color: T.text,
            fontSize: 10,
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          }}>{JSON.stringify(state.debug, null, 2)}</pre>
        )}
      </div>
    );
  }
  const d = state.data || {};
  const consented = Array.isArray(d.consented_products) ? d.consented_products : null;
  const txConsented = consented ? consented.includes("transactions") : null;
  const txStatus = d.transactions_status || {};
  const lwh = d.last_webhook || {};
  const Row = ({ label, value, accent }) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: T.s3, padding: "2px 0" }}>
      <span style={{ color: T.muted }}>{label}</span>
      <span style={{ color: accent || T.text, textAlign: "right", fontFamily: FM, fontSize: 11 }}>{value ?? "—"}</span>
    </div>
  );
  return (
    <div style={{
      gridColumn: "1 / -1",
      fontFamily: FM, fontSize: 11,
      background: T.surface,
      border: `1px solid ${T.border}`,
      borderRadius: T.rSm,
      padding: `${T.s3} ${T.s3}`,
      marginTop: T.s2,
      display: "flex", flexDirection: "column", gap: 2,
    }}>
      <Row label="Plaid error"            value={d.error?.error_code || "none"} accent={d.error ? T.loss : T.gain} />
      <Row label="Consent on transactions" value={txConsented === null ? "(not reported)" : (txConsented ? "yes" : "NO")} accent={txConsented === false ? T.loss : null} />
      <Row label="Available products"     value={(d.available_products || []).join(", ") || "—"} />
      <Row label="Billed products"        value={(d.billed_products    || []).join(", ") || "—"} />
      <Row label="Tx last successful"     value={txStatus.last_successful_update || "(never)"} accent={txStatus.last_successful_update ? T.gain : T.loss} />
      <Row label="Tx last failed"         value={txStatus.last_failed_update     || "—"} />
      <Row label="Last webhook code"      value={lwh.code_sent || "—"} />
      <Row label="Last webhook at"        value={lwh.sent_at   || "—"} />
      <Row label="Our cursor"             value={d.cursor_set ? "set" : "null"} />
      <Row label="Consent expires"        value={d.consent_expiration_time || "—"} />
    </div>
  );
}

export default function ConnectionHealth({ onNav } = {}) {
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState(null);
  // Per-item busy state for Force Re-sync. Keyed by item_id so multiple
  // Plaid connections can re-sync independently without blocking each other.
  const [resyncingId, setResyncingId] = useState(null);
  const [resyncMsg,   setResyncMsg]   = useState(null);
  // Per-item Plaid /item/get diagnostic. itemDetails[item_id] = { loading, data, err }.
  const [itemDetails, setItemDetails] = useState({});

  // Force a full re-sync for one Plaid Item: clears the stored cursor on the
  // server and re-walks /transactions/sync from scratch. Use when the user's
  // Transactions tab is empty but manual sync reports "Up to date" — the
  // cursor is stuck past data we never persisted. Idempotent: a no-op when
  // the table already matches Plaid's state. Rate-limited via plaid.sync.
  const forceResync = useCallback(async (itemId, institution) => {
    if (resyncingId) return;
    if (!window.confirm(`Force a full re-sync for ${institution}? This clears our cursor and re-pulls every transaction from Plaid.`)) return;
    setResyncingId(itemId);
    setResyncMsg(null);
    try {
      const r = await apiFetch(`/api/plaid/transactions?sync=1&reset=1&item_id=${encodeURIComponent(itemId)}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setResyncMsg({ ok: false, itemId, msg: r.status === 429 ? "Rate-limited — try again later (10/hr cap)" : (d.error || `Failed (${r.status})`) });
        return;
      }
      const { added = 0, modified = 0, removed = 0, failed = 0 } = d;
      const total = added + modified + removed;
      setResyncMsg({
        ok: failed === 0,
        itemId,
        msg: failed > 0
          ? `Re-sync hit ${failed} item error${failed === 1 ? "" : "s"}`
          : total === 0
            ? "Re-sync complete — Plaid returned no transactions (account may genuinely have none)"
            : `Re-sync complete · +${added} added, ~${modified} updated, −${removed} removed`,
      });
      // Refresh the connection health view to show the updated last-sync.
      load();
    } catch (e) {
      setResyncMsg({ ok: false, itemId, msg: e?.message || "Re-sync failed" });
    } finally {
      setResyncingId(null);
      setTimeout(() => setResyncMsg(null), 8000);
    }
  // load is defined below; safe to use because forceResync isn't called during render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resyncingId]);

  // Toggle the per-item diagnostic panel. First open fetches /item/get from
  // Plaid (via our server proxy), subsequent opens just re-show cached data.
  const toggleDetails = useCallback(async (itemId) => {
    setItemDetails(prev => {
      const cur = prev[itemId];
      if (cur && (cur.data || cur.err)) {
        // Already loaded — just toggle visibility.
        return { ...prev, [itemId]: { ...cur, hidden: !cur.hidden } };
      }
      return { ...prev, [itemId]: { loading: true } };
    });
    const cached = itemDetails[itemId];
    if (cached && (cached.data || cached.err)) return;
    try {
      const r = await apiFetch(`/api/plaid/item-status?item_id=${encodeURIComponent(itemId)}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setItemDetails(prev => ({ ...prev, [itemId]: { err: d.error || `HTTP ${r.status}`, debug: d.debug || null } }));
        return;
      }
      setItemDetails(prev => ({ ...prev, [itemId]: { data: d } }));
    } catch (e) {
      setItemDetails(prev => ({ ...prev, [itemId]: { err: e?.message || "Failed" } }));
    }
  }, [itemDetails]);

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
      <div className="bento-tile" style={{
        background: `radial-gradient(circle at 0% 0%, ${T.blue}14, transparent 55%), ${T.card}`,
        border: `1px solid ${T.border}`,
        borderTop: `2px solid ${T.blue}`,
        borderLeft: `1px solid ${T.blue}30`,
        borderRadius: T.rLg,
        padding: `${T.s5} ${T.s5}`,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        flexWrap: "wrap",
        gap: T.s3,
        boxShadow: "var(--sh-md)",
        position: "relative",
        overflow: "hidden",
        transition: "transform 0.18s cubic-bezier(.34,1.56,.64,1), box-shadow 0.2s, border-color 0.2s",
      }}>
        <div>
          <div style={{ fontFamily: FM, fontSize: 10, color: T.muted, letterSpacing: "0.16em", fontWeight: 600, marginBottom: T.s1 }}>
            CONNECTION HEALTH
          </div>
          <div style={{ fontFamily: FU, fontSize: 22, fontWeight: 600, color: T.textHi, letterSpacing: "-0.015em" }}>
            {counts.total === 0 ? "No connections yet" : `${counts.total} connection${counts.total === 1 ? "" : "s"} linked`}
          </div>
          <div style={{ fontFamily: FP, fontSize: 13, color: T.muted, marginTop: T.s1 }}>
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
          fontFamily: FP, fontSize: 12, color: T.loss,
          padding: T.s3, background: `${T.loss}15`,
          border: `1px solid ${T.loss}40`, borderRadius: T.rMd,
        }}>{err}</div>
      )}

      {/* Empty state */}
      {!loading && !err && items.length === 0 && (
        <div style={{
          fontFamily: FP, fontSize: 13, color: T.muted,
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
              <div style={{ display: "flex", gap: T.s2, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
                {it.provider === "plaid" && (
                  <button
                    onClick={() => toggleDetails(it.item_id)}
                    title="Show Plaid's view of this Item: consented products, last successful transactions update, and any item-level error."
                    style={{
                      padding: `6px ${T.s3}`,
                      background: "transparent",
                      border: `1px solid ${T.muted}55`,
                      color: T.muted,
                      fontFamily: FM, fontSize: 10, fontWeight: 600, letterSpacing: "0.06em",
                      borderRadius: T.rSm,
                      cursor: "pointer",
                    }}>{itemDetails[it.item_id]?.hidden ? "DETAILS" : (itemDetails[it.item_id]?.data || itemDetails[it.item_id]?.err) ? "HIDE" : "DETAILS"}</button>
                )}
                {it.provider === "plaid" && it.status !== "reauth" && (
                  <button
                    onClick={() => forceResync(it.item_id, it.institution || "this bank")}
                    disabled={resyncingId === it.item_id}
                    title="Clear our sync cursor and re-pull every transaction from Plaid. Use when transactions are missing but manual sync reports 'Up to date'."
                    style={{
                      padding: `6px ${T.s3}`,
                      background: "transparent",
                      border: `1px solid ${T.blue}55`,
                      color: T.blue,
                      fontFamily: FM, fontSize: 10, fontWeight: 600, letterSpacing: "0.06em",
                      borderRadius: T.rSm,
                      cursor: resyncingId === it.item_id ? "wait" : "pointer",
                      opacity: resyncingId === it.item_id ? 0.6 : 1,
                    }}>{resyncingId === it.item_id ? "RE-SYNCING…" : "↻ FORCE RESYNC"}</button>
                )}
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
              {resyncMsg && resyncMsg.itemId === it.item_id && (
                <div style={{
                  gridColumn: "1 / -1",
                  fontFamily: FM, fontSize: 11,
                  color: resyncMsg.ok ? T.gain : T.loss,
                  background: `${resyncMsg.ok ? T.gain : T.loss}12`,
                  border: `1px solid ${resyncMsg.ok ? T.gain : T.loss}40`,
                  borderRadius: T.rSm,
                  padding: `${T.s2} ${T.s3}`,
                  marginTop: T.s2,
                }}>{resyncMsg.msg}</div>
              )}
              {itemDetails[it.item_id] && !itemDetails[it.item_id].hidden && (
                <DetailsPanel state={itemDetails[it.item_id]} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
