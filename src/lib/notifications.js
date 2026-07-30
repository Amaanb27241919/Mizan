/**
 * MĪZAN — in-app notification store. Pure: no React, no DOM, no storage, no I/O.
 *
 * Added 2026-07-30. Mizan already detected the things worth telling a user about
 * — a holding flipping non-compliant, a dividend landing, a price alert crossing
 * — but every one of them was delivered ONLY as a browser Notification, behind
 * `Notification.permission === "granted"`. Two consequences:
 *   1. A user who never granted permission (most of them) got nothing at all.
 *      The detection code returned early, so dividends were never even marked
 *      seen — the whole alerting system was dead code for them.
 *   2. Even when granted, an OS toast is fire-and-forget. Miss it and the event
 *      is gone; there was no record anywhere in the app.
 * Detection is now decoupled from delivery: events always land here, and the
 * browser notification is an optional extra channel on top.
 */

// Cap the stored list. Long enough to scroll back through a quiet month, short
// enough that it never becomes a meaningful chunk of the synced user_state row.
export const NOTIF_CAP = 100;

/**
 * Valid top-level nav ids. A notification's `nav` MUST be one of these or null:
 * MizanApp renders tabs as `{nav==="overview" && …}`, so an unrecognised value
 * renders NOTHING — tapping a notification would blank the page. Sub-tabs
 * (screener, activity, watchlist) are internal Portfolio state with no
 * deep-link, so they resolve to "portfolio".
 */
export const NAV_TARGETS = ["overview", "portfolio", "finances", "goals", "advisor", "settings", "trade"];

// Every notification declares where tapping it should take the user.
export const NOTIF_KINDS = {
  sharia:     { label: "Compliance",  nav: "portfolio" },
  dividend:   { label: "Dividend",    nav: "portfolio" },
  alert:      { label: "Price alert", nav: "portfolio" },
  signal:     { label: "Bot signal",  nav: "trade" },
  connection: { label: "Connection",  nav: "settings" },
  system:     { label: "Mīzan",       nav: null },
};

/**
 * Build one notification. `id` must be STABLE for the underlying event — it's
 * the dedupe key, so re-running a detector must not produce a second copy.
 */
export function makeNotification({ id, kind = "system", title, body = "", ts, nav, meta = null }) {
  const k = NOTIF_KINDS[kind] ? kind : "system";
  const target = nav === undefined ? NOTIF_KINDS[k].nav : nav;
  return {
    id: String(id),
    kind: k,
    title: String(title || ""),
    body: String(body || ""),
    ts: ts || new Date().toISOString(),
    // Anything not in NAV_TARGETS is dropped to null rather than trusted — a
    // bad nav value blanks the page, so failing to navigate is the safe side.
    nav: NAV_TARGETS.includes(target) ? target : null,
    meta,
    read: false,
  };
}

/**
 * Merge new notifications into the stored list: newest first, deduped by id,
 * capped. An incoming duplicate does NOT resurrect a read notification as
 * unread — otherwise a detector that re-runs on every sync would make the
 * badge reappear forever and train the user to ignore it.
 */
export function addNotifications(existing = [], incoming = [], cap = NOTIF_CAP) {
  const list = Array.isArray(existing) ? existing : [];
  const add  = (Array.isArray(incoming) ? incoming : []).filter((n) => n && n.id);
  if (!add.length) return list;

  const seen = new Map(list.map((n) => [String(n.id), n]));
  const fresh = [];
  for (const n of add) {
    const id = String(n.id);
    if (seen.has(id)) continue;
    seen.set(id, n);
    fresh.push({ ...n, id });
  }
  if (!fresh.length) return list;

  return [...fresh, ...list]
    .sort((a, b) => String(b.ts || "").localeCompare(String(a.ts || "")))
    .slice(0, cap);
}

export function unreadCount(list = []) {
  return (Array.isArray(list) ? list : []).reduce((n, x) => n + (x && !x.read ? 1 : 0), 0);
}

export function markAllRead(list = []) {
  const arr = Array.isArray(list) ? list : [];
  return arr.some((n) => !n.read) ? arr.map((n) => (n.read ? n : { ...n, read: true })) : arr;
}

export function markRead(list = [], id) {
  const arr = Array.isArray(list) ? list : [];
  const key = String(id);
  return arr.some((n) => String(n.id) === key && !n.read)
    ? arr.map((n) => (String(n.id) === key ? { ...n, read: true } : n))
    : arr;
}

export function clearAll() {
  return [];
}

/** Compact relative time for the panel. Deterministic — `now` is injectable. */
export function relativeTime(ts, now = Date.now()) {
  const t = new Date(ts).getTime();
  if (!Number.isFinite(t)) return "";
  const secs = Math.max(0, Math.round((now - t) / 1000));
  if (secs < 60)    return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60)    return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24)   return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7)     return `${days}d ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5)    return `${weeks}w ago`;
  return new Date(ts).toLocaleDateString();
}

// ── Detectors ───────────────────────────────────────────────────────────────
// Pure event→notification mappers. They take the SAME inputs the existing
// browser-notification effects use, so the in-app record and the OS toast can
// never describe different things.

/** Sharia verdict changes worth telling someone about: into or out of haram. */
export function shariaChangeNotifications(baseline = {}, current = {}, asOf = "") {
  const out = [];
  for (const [ticker, res] of Object.entries(current || {})) {
    const was = baseline?.[ticker]?.status;
    const now = res?.status;
    if (!was || !now || was === now) continue;
    if (now === "haram") {
      out.push(makeNotification({
        id: `sharia:${ticker}:${was}->${now}:${asOf}`,
        kind: "sharia",
        title: `${ticker} flagged non-compliant`,
        body: `Sharia status changed from ${was} to ${now}. Review it in the Screener.`,
        meta: { ticker, from: was, to: now },
      }));
    } else if (was === "haram" && now === "halal") {
      out.push(makeNotification({
        id: `sharia:${ticker}:${was}->${now}:${asOf}`,
        kind: "sharia",
        title: `${ticker} is now compliant`,
        body: `Sharia status changed from ${was} to ${now}.`,
        meta: { ticker, from: was, to: now },
      }));
    }
  }
  return out;
}

/**
 * Dividends not yet seen. Caps the individual entries and coalesces the rest
 * into one summary line, so a first sync after a long absence can't bury every
 * other notification.
 */
export function dividendNotifications(fresh = [], { max = 5 } = {}) {
  const list = Array.isArray(fresh) ? fresh.filter(Boolean) : [];
  if (!list.length) return [];
  const out = list.slice(0, max).map((d) => {
    const ticker = d.symbol?.symbol || d.symbol?.raw_symbol || d.symbol || "—";
    const amount = Math.abs(Number(d.amount) || 0);
    return makeNotification({
      id: `dividend:${d.id}`,
      kind: "dividend",
      title: `${ticker} dividend received`,
      body: `+$${amount.toFixed(2)}${d.trade_date ? ` on ${d.trade_date}` : ""}. Check whether any of it needs purifying.`,
      ts: d.trade_date ? new Date(d.trade_date).toISOString() : undefined,
      meta: { ticker, amount },
    });
  });
  if (list.length > max) {
    out.push(makeNotification({
      id: `dividend:bulk:${list[max].id}:${list.length}`,
      kind: "dividend",
      title: `${list.length - max} more dividends received`,
      body: "Open Activity to review them.",
    }));
  }
  return out;
}

/** Watchlist price targets crossed. Mirrors the alertAbove/alertBelow logic. */
export function priceAlertNotifications(crossings = []) {
  return (Array.isArray(crossings) ? crossings : []).map(({ symbol, price, target, direction }) =>
    makeNotification({
      id: `alert:${symbol}:${direction}:${target}`,
      kind: "alert",
      title: `${symbol} ${direction === "above" ? "↑" : "↓"} ${target}`,
      body: `Price ${Number(price).toFixed(2)} ${direction === "above" ? "hit your target of" : "crossed below"} ${target}.`,
      meta: { symbol, price, target, direction },
    }));
}
