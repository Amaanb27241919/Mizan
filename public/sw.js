/**
 * MĪZAN Service Worker
 *
 * Strategy:
 *  - Cache-first for static assets (JS, CSS, fonts, icons, images)
 *  - Network-first for /api/* and HTML navigations (with cache fallback)
 */

// Bump this on any release that must invalidate cached app assets. The activate
// handler deletes every cache whose name !== CACHE_NAME, so a new version forces
// all clients to re-fetch fresh JS/CSS on next load (no stale-bundle lag).
const CACHE_NAME = "mizan-v14";

const STATIC_ASSET_EXTS = [
  ".js",
  ".css",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".svg",
  ".ico",
  ".webmanifest",
];

const PRECACHE_URLS = [
  "/",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/favicon.png",
  "/mark.png",
  "/mark-light.png",
  "/wordmark-ar.png",
  "/offline.html",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS).catch(() => undefined))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

function isStaticAsset(url) {
  const pathname = url.pathname.toLowerCase();
  return STATIC_ASSET_EXTS.some((ext) => pathname.endsWith(ext));
}

function isApiRequest(url) {
  return url.pathname.startsWith("/api/");
}

function isHtmlRequest(request) {
  if (request.mode === "navigate") return true;
  const accept = request.headers.get("accept") || "";
  return accept.includes("text/html");
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    // Guard against MIME-poisoning: when a stale client requests an old hashed
    // asset that no longer exists, Vercel's SPA rewrite returns index.html
    // (text/html, 200). Never cache or serve that HTML for a JS/CSS module
    // request — it crashes module loading ("Expected a JavaScript module but
    // got text/html"). Fall back to network/error instead so a reload recovers.
    const ct = (response && response.headers.get("content-type")) || "";
    const wantsScript = /\.(js|mjs|css)$/i.test(new URL(request.url).pathname);
    if (wantsScript && ct.includes("text/html")) {
      return cached || Response.error();
    }
    if (response && response.status === 200 && response.type !== "opaque" && !ct.includes("text/html")) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    return cached || Response.error();
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (
      response &&
      response.status === 200 &&
      request.method === "GET" &&
      !isApiRequest(new URL(request.url))
    ) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (isHtmlRequest(request)) {
      const offline = await caches.match("/offline.html");
      if (offline) return offline;
    }
    return Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;

  if (isApiRequest(url)) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isHtmlRequest(request)) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }
});

// ── Push notifications ──────────────────────────────────
// Payload comes in as JSON from lib/notify.mjs: { title, body, url }.
// We always show *something* — falling back to "Mizan" + "" keeps a bad
// payload from silently dropping the notification.
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { data = {}; }
  event.waitUntil(
    self.registration.showNotification(data.title || "Mizan", {
      body:  data.body || "",
      icon:  "/icon-192.png",
      badge: "/icon-192.png",
      data:  { url: data.url || "/" },
    })
  );
});

// Click → focus an existing tab if open, otherwise open a new one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          try {
            const clientUrl = new URL(client.url);
            const targetUrl = new URL(target, self.location.origin);
            if (clientUrl.origin === targetUrl.origin) {
              client.navigate(targetUrl.href).catch(() => {});
              return client.focus();
            }
          } catch (_) { /* fall through to openWindow */ }
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
