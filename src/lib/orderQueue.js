/**
 * Pure (no React, no I/O): the Orders section's rows — signals waiting for a
 * decision, the order history, and the ticket's Sharia line. Status words are
 * written for a person ("waiting for you", "at the broker"), each with the
 * desk's status mark (deskPipeline.js): ok ● · warn ◐ · block ■ · off ○.
 */
import { strategyLabel } from "./deskBlotter.js";
import { statusForStandard } from "./shariaVerdict.js";

const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : null);
const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** "in 42 min" · "in 1 h 5 min" · "expired" · null when unknown. */
export function expiresIn(expiresAt, now = Date.now()) {
  const t = Date.parse(expiresAt);
  if (!Number.isFinite(t)) return null;
  const mins = Math.round((t - now) / 60000);
  if (mins <= 0) return "expired";
  if (mins < 60) return `in ${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return `in ${h} h${m ? ` ${m} min` : ""}`;
}

function who(strategies, id) {
  const s = arr(strategies).find((x) => obj(x) && String(x.id) === String(id));
  if (!s) return { code: "", name: "hand order" };
  const l = strategyLabel(s);
  return { code: l.code, name: l.name, strategy: s };
}

/** Signals still waiting for a human, newest first. */
export function pendingRows(signals, strategies, now = Date.now()) {
  return arr(signals).filter((s) => obj(s) && s.status === "pending")
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
    .map((s) => {
      const w = who(strategies, s.strategy_id);
      const exp = expiresIn(s.expires_at, now);
      return {
        id: String(s.id || ""), strategyId: String(s.strategy_id || ""), code: w.code, name: w.name,
        side: s.side === "sell" ? "sell" : "buy", qty: num(s.qty), ticker: String(s.ticker || "").toUpperCase(),
        price: num(s.suggested_price) > 0 ? num(s.suggested_price) : null,
        expires: exp, expired: exp === "expired", paper: s.paper === true,
      };
    });
}

const STATUS = {
  executed: { mark: "ok", label: "Filled" },
  submitted: { mark: "warn", label: "At the broker" },
  approved: { mark: "warn", label: "Sending" },
  pending: { mark: "warn", label: "Waiting for you" },
  rejected: { mark: "off", label: "Rejected" },
  expired: { mark: "off", label: "Expired" },
};

/** Order history. AI reviews (status "shadow") are research, not orders — they live in Research. */
export function historyRows(activity, strategies, limit = 50) {
  return arr(activity).filter((a) => obj(a) && a.status !== "shadow")
    .sort((a, b) => String(b.executed_at || b.created_at || "").localeCompare(String(a.executed_at || a.created_at || "")))
    .slice(0, limit)
    .map((a) => {
      const w = who(strategies, a.strategy_id);
      // An approved signal carrying an error never reached the broker.
      const failed = (a.status === "approved" || a.status === "rejected") && a.error_msg;
      const st = failed ? { mark: "block", label: a.status === "rejected" ? "Refused" : "Failed" }
        : STATUS[a.status] || { mark: "off", label: String(a.status || "—") };
      return {
        id: String(a.id || ""), strategyId: String(a.strategy_id || ""), code: w.code, name: w.name,
        at: a.executed_at || a.created_at || null,
        side: a.side === "sell" ? "sell" : "buy", qty: num(a.qty), ticker: String(a.ticker || "").toUpperCase(),
        price: num(a.suggested_price) > 0 ? num(a.suggested_price) : null,
        mark: st.mark, label: st.label, reason: failed ? String(a.error_msg).replace(/_/g, " ") : null,
        // Only an explicit paper:false is real money; an older row with no
        // flag is unknown and must not be labelled either way.
        paper: a.paper === true, live: a.paper === false,
      };
    });
}

/**
 * The ticket's Sharia line, from the app's real screen. It replaced a static
 * "● SHARIA PRE-CHECK" that showed green for every symbol without checking.
 * `serverBlocks`: whether the order path refuses a failing BUY. True since the
 * owner held hand orders to AAOIFI (2026-10-09, handOrderGate); the false
 * wording is kept for a venue that does not.
 * `side`: a sell is never blocked, so a failing screen is not a refusal there.
 */
export function ticketScreenLine(verdict, phase, serverBlocks = false, side = "buy") {
  if (phase === "idle") return { mark: "unknown", text: "type a symbol to screen it" };
  if (phase === "loading") return { mark: "unknown", text: "screening against AAOIFI…" };
  const st = verdict ? statusForStandard(verdict, "AAOIFI") : "unknown";
  if (st === "halal") return { mark: "ok", text: "passes AAOIFI" };
  if (side === "sell" && st !== "unknown") return { mark: st === "haram" ? "block" : "warn",
    text: `${st === "haram" ? "fails AAOIFI" : "AAOIFI result is inconclusive"} — selling it is always allowed` };
  if (st === "haram") return { mark: "block", text: serverBlocks
    ? "fails AAOIFI — a buy will be refused"
    : "fails AAOIFI. The order path does not stop it (only a fixed blocklist is enforced on hand orders) — this is your call to make" };
  if (st === "review") return { mark: "warn", text: serverBlocks
    ? "AAOIFI result is inconclusive — a buy will be refused until it passes"
    : "AAOIFI result is inconclusive — open it in the Screener before buying" };
  return { mark: "unknown", text: serverBlocks ? "not screened yet — a buy waits until it can be" : "not screened — no verdict could be fetched" };
}
