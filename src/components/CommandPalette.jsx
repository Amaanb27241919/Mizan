import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* ─── COMMAND PALETTE ────────────────────────────────────
 * Cmd/Ctrl+K opens a centered search palette. Up/Down nav
 * (wraps), Enter executes, Esc closes. Results group by
 * `command.group`. Pure substring match — no fuzzy lib.
 * ──────────────────────────────────────────────────────── */

// Inline token subset matching MizanApp's `T`. We don't import T
// from MizanApp.jsx to avoid coupling these reusable primitives
// to the giant component tree.
const TT = {
  bg: "var(--mz-bg)",
  surface: "var(--mz-surface)",
  card: "var(--mz-card)",
  border: "var(--mz-border)",
  borderHi: "var(--mz-borderHi)",
  text: "var(--mz-text)",
  textHi: "var(--mz-textHi)",
  muted: "var(--mz-muted)",
  dim: "var(--mz-dim)",
  blue: "#1e4e8c",   // gold — primary accent
  rMd: "var(--r-md)",
  rLg: "var(--r-lg)",
  s2: "var(--s-2)",
  s3: "var(--s-3)",
  s4: "var(--s-4)",
  s5: "var(--s-5)",
};

const FP = "'IBM Plex Sans',system-ui,-apple-system,BlinkMacSystemFont,sans-serif";
const FM = "'IBM Plex Mono','JetBrains Mono','Menlo','Monaco',monospace";
const FU = FP;

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}

/**
 * Cmd+K / Ctrl+K listener. Returns an open/setOpen pair plus
 * toggle/close helpers. Ignores the shortcut while the user is
 * typing in any input/textarea/contenteditable.
 */
export function useCommandPalette() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((v) => !v), []);

  useEffect(() => {
    function onKey(e) {
      const isK = e.key === "k" || e.key === "K";
      if (!isK) return;
      if (!(e.metaKey || e.ctrlKey)) return;
      // Allow opening from input fields too — Cmd+K is intentional.
      // But when closed and the user is just typing 'k' with no
      // modifier, the early return above already handled it.
      e.preventDefault();
      setOpen((v) => !v);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return { open, setOpen, toggle, close };
}

// Group an array of commands by their `group` key, preserving
// the first-seen order so callers control grouping order.
function groupCommands(commands) {
  const groups = [];
  const seen = new Map();
  for (const cmd of commands) {
    const g = cmd.group || "";
    if (!seen.has(g)) {
      const bucket = { group: g, items: [] };
      seen.set(g, bucket);
      groups.push(bucket);
    }
    seen.get(g).items.push(cmd);
  }
  return groups;
}

// Build a flat list (skipping group headers) so arrow nav has
// a simple index to walk.
function flatten(groups) {
  const flat = [];
  for (const g of groups) {
    for (const item of g.items) flat.push(item);
  }
  return flat;
}

/**
 * @param {{
 *   open: boolean,
 *   onClose: () => void,
 *   commands?: Array<{
 *     id: string|number,
 *     label: string,
 *     group?: string,
 *     hint?: string,
 *     icon?: React.ReactNode,
 *     action?: () => void,
 *   }>,
 *   onSelect?: (command: any) => void,
 * }} props
 */
export function CommandPalette({ open, onClose, commands = [], onSelect }) {
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Reset state every time we open.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIdx(0);
      // Focus next tick so the input is mounted.
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const filtered = useMemo(() => {
    if (!query.trim()) return commands;
    const q = query.toLowerCase();
    return commands.filter((c) =>
      String(c.label || "").toLowerCase().includes(q)
    );
  }, [commands, query]);

  const groups = useMemo(() => groupCommands(filtered), [filtered]);
  const flat = useMemo(() => flatten(groups), [groups]);

  // Clamp active index when results shrink.
  useEffect(() => {
    if (activeIdx >= flat.length) setActiveIdx(0);
  }, [flat.length, activeIdx]);

  const runCommand = useCallback(
    (cmd) => {
      if (!cmd) return;
      if (typeof cmd.action === "function") {
        try {
          cmd.action();
        } catch {
          // Swallow — palette never blocks on consumer errors.
        }
      }
      if (typeof onSelect === "function") onSelect(cmd);
      onClose && onClose();
    },
    [onClose, onSelect]
  );

  function onKeyDown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose && onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (flat.length === 0) return;
      setActiveIdx((i) => (i + 1) % flat.length);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (flat.length === 0) return;
      setActiveIdx((i) => (i - 1 + flat.length) % flat.length);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      runCommand(flat[activeIdx]);
    }
  }

  // Auto-scroll the selected row into view as the user navigates.
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (!list) return;
    const row = list.querySelector(`[data-cmd-idx="${activeIdx}"]`);
    if (row && row.scrollIntoView) {
      row.scrollIntoView({ block: "nearest" });
    }
  }, [activeIdx, open]);

  if (!open) return null;

  return (
    <div
      onClick={() => onClose && onClose()}
      onKeyDown={onKeyDown}
      className="mz-palette-overlay"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(24px) saturate(160%)",
        WebkitBackdropFilter: "blur(24px) saturate(160%)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "12vh",
        zIndex: 220,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="mz-palette-card"
        style={{
          width: "100%",
          maxWidth: 600,
          background: "var(--mz-glass-strong, rgba(13,19,17,0.91))",
          backdropFilter: "blur(40px) saturate(180%)",
          WebkitBackdropFilter: "blur(40px) saturate(180%)",
          border: "1px solid var(--mz-glass-border, rgba(58,79,69,0.65))",
          borderRadius: TT.rLg,
          boxShadow: "var(--mz-glass-shadow-lg, inset 0 1px 0 rgba(255,255,255,0.07), 0 20px 60px rgba(0,0,0,0.60))",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          maxHeight: "70vh",
          animation: "glassFadeUp 0.2s cubic-bezier(.34,1.56,.64,1)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: TT.s3,
            padding: `${TT.s4} ${TT.s5}`,
            borderBottom: "1px solid var(--mz-glass-border, rgba(58,79,69,0.65))",
            background: "rgba(255,255,255,0.03)",
          }}
        >
          <span
            aria-hidden
            style={{
              fontFamily: FM,
              fontSize: 14,
              color: TT.muted,
            }}
          >
            ⌘
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIdx(0);
            }}
            placeholder="Type a command…"
            autoFocus
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              fontFamily: FU,
              fontSize: 15,
              color: TT.textHi,
            }}
          />
          <span
            style={{
              fontFamily: FM,
              fontSize: 10,
              color: TT.muted,
              letterSpacing: "0.08em",
              padding: "2px 6px",
              border: `1px solid ${TT.border}`,
              borderRadius: 4,
            }}
          >
            ESC
          </span>
        </div>
        <div
          ref={listRef}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: `${TT.s2} 0`,
            maxHeight: 400,
          }}
        >
          {flat.length === 0 ? (
            <div
              style={{
                padding: `${TT.s5} ${TT.s5}`,
                fontFamily: FU,
                fontSize: 13,
                color: TT.muted,
                textAlign: "center",
              }}
            >
              No matching commands
            </div>
          ) : (
            groups.map((g) => {
              let baseIdx = 0;
              // Find the starting flat-index for this group's first item.
              for (const gg of groups) {
                if (gg === g) break;
                baseIdx += gg.items.length;
              }
              return (
                <div key={g.group || "_"}>
                  {g.group ? (
                    <div
                      style={{
                        padding: `${TT.s3} ${TT.s5} ${TT.s2}`,
                        fontFamily: FM,
                        fontSize: 10,
                        color: TT.muted,
                        letterSpacing: "0.14em",
                        fontWeight: 700,
                        textTransform: "uppercase",
                      }}
                    >
                      {g.group}
                    </div>
                  ) : null}
                  {g.items.map((cmd, i) => {
                    const idx = baseIdx + i;
                    const active = idx === activeIdx;
                    return (
                      <div
                        key={cmd.id ?? `${g.group}-${i}`}
                        data-cmd-idx={idx}
                        onMouseEnter={() => setActiveIdx(idx)}
                        onClick={() => runCommand(cmd)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: TT.s3,
                          padding: `${TT.s3} ${TT.s5}`,
                          cursor: "pointer",
                          background: active
                            ? `${TT.blue}1F`
                            : "transparent",
                          borderLeft: `2px solid ${active ? TT.blue : "transparent"}`,
                          transition: "background 0.12s",
                        }}
                      >
                        {cmd.icon ? (
                          <span
                            aria-hidden
                            style={{
                              width: 22,
                              height: 22,
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 14,
                              color: active ? TT.textHi : TT.text,
                            }}
                          >
                            {cmd.icon}
                          </span>
                        ) : (
                          <span style={{ width: 22 }} />
                        )}
                        <span
                          style={{
                            flex: 1,
                            fontFamily: FU,
                            fontSize: 14,
                            color: active ? TT.textHi : TT.text,
                          }}
                        >
                          {cmd.label}
                        </span>
                        {cmd.hint ? (
                          <span
                            style={{
                              fontFamily: FM,
                              fontSize: 11,
                              color: TT.muted,
                              letterSpacing: "0.06em",
                              padding: "2px 6px",
                              border: `1px solid ${TT.border}`,
                              borderRadius: 4,
                              background: TT.surface,
                            }}
                          >
                            {cmd.hint}
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: `${TT.s2} ${TT.s5}`,
            borderTop: `1px solid ${TT.border}`,
            fontFamily: FM,
            fontSize: 10,
            color: TT.muted,
            letterSpacing: "0.08em",
          }}
        >
          <span>↑ ↓ navigate</span>
          <span>↵ select</span>
          <span>ESC close</span>
        </div>
      </div>
    </div>
  );
}
