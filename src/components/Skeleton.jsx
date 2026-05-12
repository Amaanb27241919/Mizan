import React, { useEffect } from "react";

/* ─── SKELETON LOADERS ───────────────────────────────────
 * Theme-agnostic shimmer placeholders. Uses semi-transparent
 * overlays so the same gradient reads well on MizanApp's dark
 * navy bg AND its light surface. Tokens below are an inline
 * subset of MizanApp's `T` — we copy a handful of values to
 * avoid coupling this file to MizanApp.jsx (and the circular
 * import risk that comes with it). When MizanApp exports T,
 * swap to the import.
 * ──────────────────────────────────────────────────────── */

// Inline subset of MizanApp's design tokens. Keep minimal.
const TT = {
  card: "var(--mz-card)",
  border: "var(--mz-border)",
  rMd: "var(--r-md)",
  rLg: "var(--r-lg)",
  s3: "var(--s-3)",
  s4: "var(--s-4)",
};

const SHIMMER_KEYFRAMES = `
@keyframes mizanShimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
.mz-skeleton {
  background: linear-gradient(
    90deg,
    rgba(255,255,255,0.04) 25%,
    rgba(255,255,255,0.10) 50%,
    rgba(255,255,255,0.04) 75%
  );
  background-size: 200% 100%;
  animation: mizanShimmer 1.4s linear infinite;
}
`;

// Module-level flag so we inject keyframes once per app lifetime.
let stylesInjected = false;
function injectShimmerStyles() {
  if (stylesInjected) return;
  if (typeof document === "undefined") return;
  const style = document.createElement("style");
  style.setAttribute("data-mizan-skeleton", "true");
  style.textContent = SHIMMER_KEYFRAMES;
  document.head.appendChild(style);
  stylesInjected = true;
}

function useShimmerStyles() {
  useEffect(() => {
    injectShimmerStyles();
  }, []);
}

/**
 * Single shimmer bar.
 *
 * @param {{ w?: string|number, h?: string|number, radius?: string|number, style?: React.CSSProperties }} props
 */
export function Skeleton({ w = "100%", h = 16, radius = 4, style }) {
  useShimmerStyles();
  return (
    <div
      className="mz-skeleton"
      style={{
        width: typeof w === "number" ? `${w}px` : w,
        height: typeof h === "number" ? `${h}px` : h,
        borderRadius: typeof radius === "number" ? `${radius}px` : radius,
        display: "block",
        ...style,
      }}
    />
  );
}

/**
 * Card-shaped wrapper holding a single shimmer bar. Matches the
 * border + radius + padding of MizanApp's BentoTile so it slots
 * into the same layout without jarring transitions.
 *
 * @param {{ h?: number, style?: React.CSSProperties }} props
 */
export function SkeletonCard({ h = 80, style }) {
  useShimmerStyles();
  return (
    <div
      style={{
        background: TT.card,
        border: `1px solid ${TT.border}`,
        borderRadius: TT.rLg,
        padding: `${TT.s4} ${TT.s4}`,
        ...style,
      }}
    >
      <Skeleton w="100%" h={h} radius={6} />
    </div>
  );
}

/**
 * Table skeleton: one shimmer "header" row + N body rows, each
 * with `cols` shimmer cells. Lightweight CSS grid keeps cells
 * aligned without forcing layout calc on every frame.
 *
 * @param {{ rows?: number, cols?: number, style?: React.CSSProperties }} props
 */
export function SkeletonTable({ rows = 5, cols = 7, style }) {
  useShimmerStyles();
  const colCount = Math.max(1, cols | 0);
  const rowCount = Math.max(0, rows | 0);
  const gridTemplate = `repeat(${colCount}, minmax(0, 1fr))`;
  const cell = (key, h) => (
    <Skeleton key={key} w="100%" h={h} radius={4} />
  );
  return (
    <div
      style={{
        background: TT.card,
        border: `1px solid ${TT.border}`,
        borderRadius: TT.rLg,
        padding: TT.s4,
        ...style,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: gridTemplate,
          gap: TT.s3,
          paddingBottom: TT.s3,
          borderBottom: `1px solid ${TT.border}`,
          marginBottom: TT.s3,
        }}
      >
        {Array.from({ length: colCount }).map((_, c) => cell(`h-${c}`, 12))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: TT.s3 }}>
        {Array.from({ length: rowCount }).map((_, r) => (
          <div
            key={`r-${r}`}
            style={{
              display: "grid",
              gridTemplateColumns: gridTemplate,
              gap: TT.s3,
            }}
          >
            {Array.from({ length: colCount }).map((_, c) =>
              cell(`r-${r}-${c}`, 14)
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
