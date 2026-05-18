// Reusable "Coming Soon" / empty-state tile.
//
// Two modes:
//   <ComingSoon title="Order Ticket" />
//     → gold "COMING SOON" pill, neutral copy
//
//   <ComingSoon title="Recent Transactions" pending
//               action={{ label: "↻ Sync now", onClick: doSync, busy: syncing }}
//               hint="No transactions on file yet. Run a sync to populate." />
//     → blue "AWAITING DATA" pill, optional CTA button
//
// All visuals match the rest of the app's bento tile aesthetic via CSS vars
// (no hardcoded colors) so light/dark themes both look intentional.

import React from "react";

const tokens = {
  bg:       "var(--mz-card)",
  border:   "var(--mz-border)",
  surface:  "var(--mz-surface)",
  textHi:   "var(--mz-textHi)",
  text:     "var(--mz-text)",
  muted:    "var(--mz-muted)",
  blue:     "#5B8DEF",
  gold:     "#D4AF37",
  rMd:      "var(--r-md)",
  rSm:      "var(--r-sm)",
  s2:       "var(--s-2)",
  s3:       "var(--s-3)",
  s4:       "var(--s-4)",
  s5:       "var(--s-5)",
  s6:       "var(--s-6)",
};
const FM = "var(--font-mono, ui-monospace, Menlo, monospace)";
const FU = "var(--font-ui, system-ui, sans-serif)";

export default function ComingSoon({
  title,
  description,
  hint,
  pending = false,         // true = "awaiting data" (blue); false = "coming soon" (gold)
  action,                  // optional { label, onClick, busy }
  icon = pending ? "◐" : "✦",
}) {
  const accent = pending ? tokens.blue : tokens.gold;
  const pillLabel = pending ? "AWAITING DATA" : "COMING SOON";

  return (
    <div style={{
      background: `radial-gradient(circle at 0% 0%, ${accent}10, transparent 55%), ${tokens.bg}`,
      border: `1px solid ${tokens.border}`,
      borderRadius: tokens.rMd,
      padding: `${tokens.s6} ${tokens.s5}`,
      display: "flex",
      flexDirection: "column",
      alignItems: "flex-start",
      gap: tokens.s3,
    }}>
      <div style={{
        display: "inline-flex",
        alignItems: "center",
        gap: tokens.s2,
        padding: `2px ${tokens.s2}`,
        background: `${accent}14`,
        border: `1px solid ${accent}40`,
        borderRadius: 999,
        fontFamily: FM,
        fontSize: 9,
        color: accent,
        letterSpacing: "0.16em",
        fontWeight: 700,
      }}>
        <span aria-hidden="true">{icon}</span>
        {pillLabel}
      </div>

      <div style={{
        fontFamily: FU,
        fontSize: 18,
        fontWeight: 600,
        color: tokens.textHi,
        letterSpacing: "-0.015em",
      }}>{title}</div>

      {description && (
        <div style={{
          fontFamily: FU,
          fontSize: 13,
          color: tokens.muted,
          lineHeight: 1.55,
          letterSpacing: "-0.005em",
          maxWidth: 560,
        }}>{description}</div>
      )}

      {hint && (
        <div style={{
          fontFamily: FM,
          fontSize: 11,
          color: tokens.muted,
          marginTop: 2,
          letterSpacing: "0.02em",
        }}>{hint}</div>
      )}

      {action && action.label && (
        <button
          onClick={action.busy ? undefined : action.onClick}
          disabled={!!action.busy}
          style={{
            marginTop: tokens.s2,
            padding: `10px ${tokens.s4}`,
            background: `${accent}14`,
            border: `1px solid ${accent}55`,
            color: accent,
            fontFamily: FM,
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: "0.04em",
            borderRadius: tokens.rMd,
            cursor: action.busy ? "wait" : "pointer",
            transition: "background 0.15s, border-color 0.15s",
          }}
        >{action.busy ? "Working…" : action.label}</button>
      )}
    </div>
  );
}
