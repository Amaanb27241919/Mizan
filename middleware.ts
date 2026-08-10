// Vercel Routing Middleware
// Docs: https://vercel.com/docs/routing-middleware
//
// Purpose (narrowed 2026-07-31, owner call): publish the visitor's country to
// the SPA so it can gate the Plaid "Connect Bank" affordance. Nothing is
// blocked here any more.
//
// What this used to do: from 2026-05-25 (`540ffda`) it rewrote every non-US
// visitor to /us-only.html. Plaid is genuinely US-only, but the block was much
// wider than its cause — Sharia screening, the Zakat worksheet, the Assistant,
// the watchlist and SnapTrade brokerage linking have no US dependency at all,
// and SnapTrade is a Canadian company supporting Questrade and Wealthsimple.
// Canadian users were walled out of the ~80% of Mizan that works for them.
//
// Behavior now:
//  - Every request passes through, from every country.
//  - On document requests we attach a readable `mz_country` cookie holding the
//    Vercel edge geolocation country.
//  - The cookie is a UX hint ONLY. It is client-readable and therefore
//    client-editable, so the authoritative gate lives server-side in
//    lib/handlers.mjs (/api/plaid/link-token + /api/plaid/exchange), which
//    reads the x-vercel-ip-country header the edge sets and a browser cannot
//    forge. Editing the cookie changes which button you see, never what the
//    server will do.
//
// Local dev safety: a true no-op when process.env.VERCEL is unset, so
// `vite dev` / `node server.js` are unaffected.

import { geolocation, next } from "@vercel/functions";
import { COUNTRY_COOKIE } from "./lib/geo.mjs";

// Paths that never need the cookie: API routes read the edge header directly,
// and static assets are not documents. Skipping them avoids emitting a
// Set-Cookie on every hashed asset in the bundle.
function skipsCookie(pathname: string): boolean {
  return (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_vercel/") ||
    pathname.startsWith("/assets/") ||
    pathname.startsWith("/icon-") ||
    pathname === "/favicon.svg" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/sw.js"
  );
}

export default function middleware(request: Request): Response {
  // Local dev: vite dev / node server.js do not set VERCEL.
  if (!process.env.VERCEL) {
    return next();
  }

  const url = new URL(request.url);
  if (skipsCookie(url.pathname)) {
    return next();
  }

  const { country } = geolocation(request);

  // Unresolvable country: set no cookie. The client treats "absent" as
  // eligible, matching the server's fail-open in lib/geo.mjs.
  if (!country) {
    return next();
  }

  // Not HttpOnly on purpose — the SPA has to read it to decide whether to
  // render the Connect Bank button. Nothing security-relevant rides on it.
  // SameSite=Lax so it survives the Plaid OAuth redirect back to /oauth-redirect.
  const cookie =
    `${COUNTRY_COOKIE}=${encodeURIComponent(country)}; Path=/; Max-Age=86400; SameSite=Lax; Secure`;

  return next({ headers: { "Set-Cookie": cookie } });
}

export const config = {
  // Run on every request; path filtering happens in the handler because
  // Vercel's matcher regex is awkward for our mix of prefixes and exact paths.
  matcher: "/:path*",
};
