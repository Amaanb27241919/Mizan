// BugReportButton — always-reachable "Report an issue" affordance.
//
// Floating circular button bottom-right (above the nav dock); click to
// open a small modal with a description textarea + severity selector.
// Submission posts to /api/bug-report which emails OWNER_EMAIL via Resend.
//
// External callers can open the modal by dispatching a custom event:
//   window.dispatchEvent(new Event("mizan:open-bug-report"))
// Used by the About page's "Found a bug?" link.

import React, { useEffect, useState, useCallback } from "react";
import { apiFetch } from "../lib/apiFetch";

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
  blue:    "#c9a24b",   // gold — primary accent
  gold:    "#cf9e54",   // amber
  gain:    "#6fae8e",   // jade
  loss:    "#c46a52",   // rust
};
const FM = "'IBM Plex Mono','JetBrains Mono','Menlo','Monaco',monospace";
const FP = "'IBM Plex Sans',system-ui,-apple-system,BlinkMacSystemFont,sans-serif";
const FU = FP;

function buildContext() {
  let nav = ""; let theme = "";
  try { nav   = localStorage.getItem("mizan_nav")        || ""; } catch {}
  try { theme = localStorage.getItem("mizan_theme_mode") || ""; } catch {}
  return {
    url:        typeof window !== "undefined" ? `${window.location.pathname}${window.location.search}` : "",
    user_agent: typeof navigator !== "undefined" ? navigator.userAgent : "",
    viewport:   typeof window !== "undefined" ? `${window.innerWidth}x${window.innerHeight}` : "",
    app_version: (import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA || "dev").toString().slice(0, 12),
    nav,
    theme,
  };
}

export default function BugReportButton() {
  const [open, setOpen]               = useState(false);
  const [description, setDescription] = useState("");
  const [severity, setSeverity]       = useState("medium");
  const [busy, setBusy]               = useState(false);
  const [status, setStatus]           = useState(null); // { ok, msg }

  // Listen for external open requests (e.g. About → "Found a bug?" link).
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("mizan:open-bug-report", onOpen);
    return () => window.removeEventListener("mizan:open-bug-report", onOpen);
  }, []);

  // Esc to dismiss + lock body scroll while modal is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    // Reset only on close so a 429 retry keeps the user's draft.
    setTimeout(() => {
      if (status?.ok) {
        setDescription("");
        setSeverity("medium");
      }
      setStatus(null);
    }, 250);
  }, [status]);

  const submit = useCallback(async () => {
    if (busy) return;
    const text = description.trim();
    if (text.length < 10) {
      setStatus({ ok: false, msg: "Please describe the issue (10+ characters)." });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const r = await apiFetch("/api/bug-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: text, severity, context: buildContext() }),
      });
      const body = await r.json().catch(() => ({}));
      if (r.status === 401) {
        setStatus({ ok: false, msg: "Sign in to submit feedback." });
      } else if (r.status === 429) {
        setStatus({ ok: false, msg: "You've hit the feedback rate limit (10/hr). Try again later." });
      } else if (!r.ok) {
        setStatus({ ok: false, msg: body.error || `Submit failed (${r.status})` });
      } else {
        setStatus({ ok: true, msg: "Thanks — we got it." });
        // Auto-close on success after a beat.
        setTimeout(() => { setOpen(false); setStatus(null); setDescription(""); setSeverity("medium"); }, 1800);
      }
    } catch (e) {
      setStatus({ ok: false, msg: e?.message || "Submit failed" });
    } finally {
      setBusy(false);
    }
  }, [busy, description, severity]);

  return (
    <>
      {/* Floating trigger — bottom-right, above the nav dock */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Report an issue"
        aria-label="Report an issue"
        style={{
          position: "fixed",
          bottom: 90,   // clear the dock (which sits ~T.s5 from the bottom)
          right: 18,
          width: 38,
          height: 38,
          borderRadius: "50%",
          background: T.card,
          border: `1px solid ${T.border}`,
          color: T.muted,
          fontFamily: FM,
          fontSize: 15,
          fontWeight: 600,
          lineHeight: 1,
          cursor: "pointer",
          boxShadow: "var(--sh-md)",
          zIndex: 80,
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "color 0.15s, border-color 0.15s",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = T.text; e.currentTarget.style.borderColor = T.blue; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = T.muted; e.currentTarget.style.borderColor = T.border; }}
      >?</button>

      {/* Modal */}
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={close}
          style={{
            position: "fixed", inset: 0,
            background: "rgba(2,4,12,0.55)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            zIndex: 200,
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: T.s4,
          }}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 480,
              background: T.card,
              border: `1px solid ${T.border}`,
              borderRadius: T.rMd,
              padding: `${T.s5} ${T.s5}`,
              boxShadow: "var(--sh-lg)",
              display: "flex",
              flexDirection: "column",
              gap: T.s3,
            }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: T.s3 }}>
              <div>
                <div style={{ fontFamily: FM, fontSize: 10, color: T.blue, letterSpacing: "0.16em", fontWeight: 700, marginBottom: T.s1 }}>
                  REPORT AN ISSUE
                </div>
                <div style={{ fontFamily: FU, fontSize: 18, fontWeight: 600, color: T.textHi, letterSpacing: "-0.01em" }}>
                  Tell us what went wrong
                </div>
              </div>
              <button onClick={close} aria-label="Close"
                style={{
                  background: "transparent", border: "none", color: T.muted,
                  fontFamily: FM, fontSize: 18, cursor: "pointer", padding: 4, lineHeight: 1,
                }}>×</button>
            </div>

            <div style={{ fontFamily: FU, fontSize: 12, color: T.muted, lineHeight: 1.5 }}>
              This goes to the operator inbox. We see the page you're on and what
              you describe — never your balances, transactions, or passwords.
            </div>

            <div>
              <div style={{ fontFamily: FM, fontSize: 9, color: T.muted, letterSpacing: "0.14em", fontWeight: 600, marginBottom: T.s1 }}>
                SEVERITY
              </div>
              <div style={{ display: "flex", gap: T.s1, flexWrap: "wrap" }}>
                {[
                  ["low",    "Quick feedback"],
                  ["medium", "Something looks off"],
                  ["high",   "Broken — blocked me"],
                ].map(([v, label]) => (
                  <button key={v} onClick={() => setSeverity(v)}
                    style={{
                      flex: "1 1 130px",
                      padding: `8px ${T.s2}`,
                      background: severity === v ? `${T.blue}22` : T.surface,
                      border: `1px solid ${severity === v ? T.blue + "55" : T.border}`,
                      color: severity === v ? T.textHi : T.muted,
                      fontFamily: FM, fontSize: 11, fontWeight: 600, letterSpacing: "0.04em",
                      borderRadius: T.rSm,
                      cursor: "pointer",
                    }}>{label}</button>
                ))}
              </div>
            </div>

            <div>
              <div style={{ fontFamily: FM, fontSize: 9, color: T.muted, letterSpacing: "0.14em", fontWeight: 600, marginBottom: T.s1 }}>
                WHAT WENT WRONG?
              </div>
              <textarea
                autoFocus
                value={description}
                onChange={(e) => setDescription(e.target.value.slice(0, 2000))}
                placeholder="e.g. After I connected my Chase account, the Net Worth tile froze on $0…"
                rows={5}
                style={{
                  width: "100%",
                  background: T.surface,
                  border: `1px solid ${T.border}`,
                  borderRadius: T.rMd,
                  padding: `${T.s3} ${T.s3}`,
                  color: T.textHi,
                  fontFamily: FU, fontSize: 13, lineHeight: 1.5,
                  outline: "none",
                  resize: "vertical",
                  boxSizing: "border-box",
                }}/>
              <div style={{ display: "flex", justifyContent: "space-between", fontFamily: FM, fontSize: 10, color: T.muted, marginTop: T.s1 }}>
                <span>{description.length}/2000</span>
                <span>Press Esc to cancel</span>
              </div>
            </div>

            {status && (
              <div style={{
                fontFamily: FM, fontSize: 12,
                padding: `${T.s2} ${T.s3}`,
                borderRadius: T.rMd,
                background: status.ok ? `${T.gain}14` : `${T.loss}14`,
                border:     `1px solid ${(status.ok ? T.gain : T.loss)}40`,
                color:      status.ok ? T.gain : T.loss,
              }}>{status.ok ? "✓ " : "✗ "}{status.msg}</div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: T.s2, marginTop: T.s1 }}>
              <button onClick={close}
                style={{
                  padding: `8px ${T.s4}`,
                  background: "transparent",
                  border: `1px solid ${T.border}`,
                  color: T.muted,
                  fontFamily: FM, fontSize: 12, fontWeight: 600, letterSpacing: "0.04em",
                  borderRadius: T.rMd,
                  cursor: "pointer",
                }}>Cancel</button>
              <button onClick={submit} disabled={busy || description.trim().length < 10}
                style={{
                  padding: `8px ${T.s4}`,
                  background: `linear-gradient(135deg, ${T.blue}, ${T.blue}DD)`,
                  border: "none",
                  color: "#fff",
                  fontFamily: FM, fontSize: 12, fontWeight: 700, letterSpacing: "0.04em",
                  borderRadius: T.rMd,
                  cursor: (busy || description.trim().length < 10) ? "not-allowed" : "pointer",
                  opacity: (busy || description.trim().length < 10) ? 0.5 : 1,
                  boxShadow: `0 4px 14px ${T.blue}55`,
                }}>{busy ? "Sending…" : "Send"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
