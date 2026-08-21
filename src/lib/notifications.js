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

/**
 * Changes to the user's OWN partner connections — SnapTrade brokerages and
 * Plaid banks. Fed by /api/connections/health, whose items are
 * `{ provider, item_id, institution, status }` with status "ok" | "reauth".
 *
 * Four transitions are worth a notification, and nothing else is:
 *   added    — a new institution appears
 *   reauth   — a working connection starts needing to be reconnected
 *   restored — a broken connection starts working again
 *   removed  — an institution disappears
 *
 * SEEDING IS LOAD-BEARING. Pass `baseline = null` on the very first run for a
 * user, and this returns NOTHING — the caller then stores the current list as
 * the baseline. Without that, every existing connection reads as brand new and
 * a five-account user is greeted by five "connected" notifications for things
 * they linked months ago. This is the exact trap the dividend detector fell
 * into (see CLAUDE.md §2 notifications.js), so it is explicit in the signature
 * rather than left to the caller to remember.
 *
 * Ids carry a day stamp so a genuine re-connection weeks later notifies again,
 * while a connection flapping within one day produces at most one notification
 * per transition. A connection that simply STAYS broken never re-fires, because
 * only the transition is detected, not the state.
 */
export function connectionNotifications(baseline, current = [], day = new Date().toISOString().slice(0, 10)) {
  // null/undefined baseline = never seeded. Say nothing; the caller seeds.
  if (baseline == null) return [];

  const list = (x) => (Array.isArray(x) ? x : []);
  const key = (i) => `${i.provider}:${i.item_id}`;
  const before = new Map(list(baseline).map((i) => [key(i), i]));
  const after = new Map(list(current).map((i) => [key(i), i]));
  const out = [];

  const label = (i) => i.institution || (i.provider === "plaid" ? "Bank" : "Brokerage");
  const via = (i) => (i.provider === "plaid" ? "Plaid" : "SnapTrade");

  for (const [k, now] of after) {
    const was = before.get(k);
    if (!was) {
      out.push(makeNotification({
        id: `conn:added:${k}:${day}`,
        kind: "connection",
        title: `${label(now)} connected`,
        body: `Linked via ${via(now)}. Balances and transactions will appear as they sync.`,
        meta: { provider: now.provider, item_id: now.item_id, event: "added" },
      }));
      continue;
    }
    if (was.status !== "reauth" && now.status === "reauth") {
      out.push(makeNotification({
        id: `conn:reauth:${k}:${day}`,
        kind: "connection",
        title: `${label(now)} needs reconnecting`,
        body: `${via(now)} can no longer reach this account, so its balances are going stale. Reconnect it in Settings → Connections.`,
        meta: { provider: now.provider, item_id: now.item_id, event: "reauth" },
      }));
    } else if (was.status === "reauth" && now.status === "ok") {
      out.push(makeNotification({
        id: `conn:restored:${k}:${day}`,
        kind: "connection",
        title: `${label(now)} is reconnected`,
        body: `${via(now)} is syncing this account again.`,
        meta: { provider: now.provider, item_id: now.item_id, event: "restored" },
      }));
    }
  }

  for (const [k, was] of before) {
    if (after.has(k)) continue;
    out.push(makeNotification({
      id: `conn:removed:${k}:${day}`,
      kind: "connection",
      title: `${label(was)} disconnected`,
      body: `This ${via(was)} connection was removed. Its accounts no longer count toward your net worth.`,
      meta: { provider: was.provider, item_id: was.item_id, event: "removed" },
    }));
  }

  return out;
}

/** The baseline shape to store — only what the detector compares. */
export function connectionBaseline(items = []) {
  return (Array.isArray(items) ? items : []).map((i) => ({
    provider: i.provider, item_id: i.item_id, institution: i.institution, status: i.status,
  }));
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
