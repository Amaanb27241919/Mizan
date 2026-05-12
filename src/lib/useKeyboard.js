import React, { useEffect, useRef } from "react";

/* ─── KEYBOARD SHORTCUTS ─────────────────────────────────
 * Two-key sequences ("g o", "g p") + single-char shortcuts
 * ("/", "r", "?"). Ignores keystrokes when the user is
 * typing in any input / textarea / contenteditable region so
 * we never hijack typing. Pairs with `<ShortcutHelp />` for
 * a quick reference modal.
 *
 * NOTE: this file is `.js` (per the agreed file layout) so we
 * use `React.createElement` rather than JSX. Functional output
 * is identical; rename to `.jsx` later if the team prefers JSX.
 * ──────────────────────────────────────────────────────── */

// Inline token subset — see Skeleton.jsx for the rationale on
// not importing T from MizanApp.jsx.
const TT = {
  bg: "var(--mz-bg)",
  card: "var(--mz-card)",
  surface: "var(--mz-surface)",
  border: "var(--mz-border)",
  borderHi: "var(--mz-borderHi)",
  text: "var(--mz-text)",
  textHi: "var(--mz-textHi)",
  muted: "var(--mz-muted)",
  blue: "#7B61FF",
  rMd: "var(--r-md)",
  rLg: "var(--r-lg)",
  s2: "var(--s-2)",
  s3: "var(--s-3)",
  s4: "var(--s-4)",
  s5: "var(--s-5)",
  s6: "var(--s-6)",
};

const FU =
  "'SF Pro Display','SF Pro Text',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
const FM = "'SF Mono',ui-monospace,'JetBrains Mono','Menlo','Monaco',monospace";

const SEQUENCE_TIMEOUT_MS = 1500;

const h = React.createElement;

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}

// Normalise a registered shortcut string ("g o", "/", "?") into
// either a single key or a two-key sequence. Single letters are
// case-insensitive; we lowercase keys when matching.
function parseShortcut(spec) {
  const parts = String(spec).trim().split(/\s+/);
  if (parts.length === 1) {
    return { kind: "single", key: parts[0] };
  }
  return {
    kind: "sequence",
    first: parts[0].toLowerCase(),
    second: parts[1].toLowerCase(),
  };
}

/**
 * React hook: register a map of shortcuts and a callback that
 * fires whenever one resolves. Sequences (two keys) get up to
 * 1500ms between presses before resetting.
 *
 * @param {{ shortcuts?: Record<string, string>, onShortcut?: (name: string) => void }} args
 */
export function useKeyboard({ shortcuts = {}, onShortcut } = {}) {
  // Refs so we don't rebind document listeners on every render.
  const shortcutsRef = useRef(shortcuts);
  const onShortcutRef = useRef(onShortcut);
  useEffect(() => {
    shortcutsRef.current = shortcuts;
  }, [shortcuts]);
  useEffect(() => {
    onShortcutRef.current = onShortcut;
  }, [onShortcut]);

  useEffect(() => {
    let pendingFirst = null;
    let pendingTimer = null;

    function clearPending() {
      pendingFirst = null;
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
      }
    }

    function fire(name) {
      const cb = onShortcutRef.current;
      if (typeof cb === "function") cb(name);
    }

    function onKeyDown(e) {
      if (isTypingTarget(document.activeElement)) return;
      // Modifiers reserved for browser/system — skip.
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const map = shortcutsRef.current || {};
      const key = e.key;
      const lowerKey = key.toLowerCase();

      // First, try single-key shortcuts that match the literal key
      // (e.g. "/", "?", "r", "R"). Case-insensitive for letters.
      for (const [spec, name] of Object.entries(map)) {
        const parsed = parseShortcut(spec);
        if (parsed.kind !== "single") continue;
        const want = parsed.key;
        if (want === key || want.toLowerCase() === lowerKey) {
          e.preventDefault();
          clearPending();
          fire(name);
          return;
        }
      }

      // Sequence matching — only single-character keys count.
      if (key.length !== 1) {
        clearPending();
        return;
      }

      if (pendingFirst) {
        const expected = pendingFirst;
        clearPending();
        for (const [spec, name] of Object.entries(map)) {
          const parsed = parseShortcut(spec);
          if (parsed.kind !== "sequence") continue;
          if (parsed.first === expected && parsed.second === lowerKey) {
            fire(name);
            return;
          }
        }
        return;
      }

      // No pending first key — check if this key starts a sequence.
      const couldStartSequence = Object.keys(map).some((spec) => {
        const parsed = parseShortcut(spec);
        return parsed.kind === "sequence" && parsed.first === lowerKey;
      });
      if (couldStartSequence) {
        pendingFirst = lowerKey;
        pendingTimer = setTimeout(clearPending, SEQUENCE_TIMEOUT_MS);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      clearPending();
    };
  }, []);
}

/* ─── SHORTCUT HELP MODAL ────────────────────────────────
 * Reference card listing every registered shortcut and the
 * action label it triggers. Close with Esc or clicking the
 * overlay. Matches MizanApp's modal aesthetic: dark blurred
 * backdrop, glass card, mono labels, SF Pro body.
 * ──────────────────────────────────────────────────────── */

function ShortcutKey({ children }) {
  return h(
    "span",
    {
      style: {
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 8px",
        background: TT.surface,
        border: `1px solid ${TT.borderHi}`,
        borderRadius: 6,
        fontFamily: FM,
        fontSize: 11,
        color: TT.textHi,
        letterSpacing: "0.04em",
        minWidth: 22,
        justifyContent: "center",
      },
    },
    children
  );
}

function renderKeys(spec) {
  const parts = String(spec).trim().split(/\s+/);
  const children = [];
  parts.forEach((p, i) => {
    children.push(h(ShortcutKey, { key: `k-${i}` }, p));
    if (i < parts.length - 1) {
      children.push(
        h(
          "span",
          {
            key: `t-${i}`,
            style: {
              fontFamily: FM,
              fontSize: 10,
              color: TT.muted,
              letterSpacing: "0.08em",
            },
          },
          "then"
        )
      );
    }
  });
  return h(
    "span",
    {
      style: { display: "inline-flex", gap: 6, alignItems: "center" },
    },
    children
  );
}

/**
 * Modal listing the available shortcuts. Pass the same map you
 * passed to `useKeyboard`; values become the action labels.
 *
 * @param {{ shortcuts?: Record<string, string>, open: boolean, onClose: () => void }} props
 */
export function ShortcutHelp({ shortcuts = {}, open, onClose }) {
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        if (onClose) onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const entries = Object.entries(shortcuts);

  const headerCellStyle = {
    textAlign: "left",
    fontFamily: FM,
    fontSize: 10,
    color: TT.muted,
    letterSpacing: "0.12em",
    fontWeight: 600,
    padding: `${TT.s2} 0`,
    borderBottom: `1px solid ${TT.border}`,
  };

  const tableBody = entries.length
    ? h(
        "table",
        {
          style: {
            width: "100%",
            borderCollapse: "collapse",
            fontFamily: FU,
          },
        },
        h(
          "thead",
          null,
          h(
            "tr",
            null,
            h("th", { style: headerCellStyle }, "SHORTCUT"),
            h("th", { style: headerCellStyle }, "ACTION")
          )
        ),
        h(
          "tbody",
          null,
          entries.map(([spec, label]) =>
            h(
              "tr",
              { key: spec },
              h(
                "td",
                {
                  style: {
                    padding: `${TT.s3} 0`,
                    borderBottom: `1px solid ${TT.border}`,
                  },
                },
                renderKeys(spec)
              ),
              h(
                "td",
                {
                  style: {
                    padding: `${TT.s3} 0`,
                    borderBottom: `1px solid ${TT.border}`,
                    fontSize: 13,
                    color: TT.text,
                  },
                },
                label
              )
            )
          )
        )
      )
    : h(
        "p",
        {
          style: {
            fontFamily: FU,
            fontSize: 14,
            color: TT.muted,
            margin: 0,
          },
        },
        "No shortcuts registered."
      );

  return h(
    "div",
    {
      onClick: () => onClose && onClose(),
      style: {
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 200,
        padding: TT.s4,
      },
    },
    h(
      "div",
      {
        onClick: (e) => e.stopPropagation(),
        style: {
          width: "100%",
          maxWidth: 480,
          background: TT.card,
          border: `1px solid ${TT.borderHi}`,
          borderRadius: TT.rLg,
          padding: `${TT.s6} ${TT.s5}`,
          boxShadow: "var(--sh-lg)",
        },
      },
      h(
        "div",
        {
          style: {
            fontFamily: FM,
            fontSize: 10,
            color: TT.muted,
            letterSpacing: "0.18em",
            fontWeight: 700,
            marginBottom: TT.s3,
          },
        },
        "KEYBOARD SHORTCUTS"
      ),
      tableBody,
      h(
        "div",
        {
          style: {
            marginTop: TT.s4,
            paddingTop: TT.s3,
            borderTop: `1px solid ${TT.border}`,
            fontFamily: FM,
            fontSize: 11,
            color: TT.muted,
            letterSpacing: "0.04em",
          },
        },
        "Press ",
        h(ShortcutKey, null, "?"),
        " to toggle this panel"
      )
    )
  );
}
