// Vercel Routing Middleware
// Docs: https://vercel.com/docs/routing-middleware
//
// Purpose: MIZAN's brokerage + bank connectivity goes through Plaid, which only
// onboards US-resident users. Non-US visitors should land on /us-only rather
// than wasting time clicking Connect buttons that will fail in Plaid Link.
//
// Behavior:
//  - Allowlisted paths (API, static, legal, PWA assets, the /us-only page
//    itself) always pass through.
//  - Country is read from Vercel's x-vercel-ip-country header via the
//    @vercel/functions geolocation() helper.
//  - US + US territories (PR, VI, GU, MP, AS) pass through; empty/unknown
//    country also passes through (local dev, edge resolution failures).
//  - Everything else gets rewritten (same URL bar, different content) to
//    /us-only.
//
// Local dev safety: this middleware is a true no-op when process.env.VERCEL is
// unset, so `vite dev` / `node server.js` are unaffected.

import { geolocation, next, rewrite } from "@vercel/functions";

// US + Plaid-supported US territories. Plaid Link onboards these.
const ALLOWED_COUNTRIES = new Set(["US", "PR", "VI", "GU", "MP", "AS"]);

// Paths that must ALWAYS pass through, regardless of country.
//  - /api/*           server endpoints (Plaid webhooks originate from
//                     Plaid's own servers in unpredictable regions; never block)
//  - /_vercel/*       Vercel platform internals
//  - /assets/*        Vite-emitted hashed assets
//  - /icon-*          PWA icons
//  - /favicon.svg     favicon
//  - /manifest.webmanifest, /sw.js  PWA manifest + service worker
//  - /us-only         the destination page (would otherwise infinite-loop)
//  - /legal/*, /privacy, /terms, /security  legal pages must be globally reachable
function isAllowlistedPath(pathname: string): boolean {
  if (pathname.startsWith("/api/")) return true;
  if (pathname.startsWith("/_vercel/")) return true;
  if (pathname.startsWith("/assets/")) return true;
  if (pathname.startsWith("/icon-")) return true;
  if (pathname === "/favicon.svg") return true;
  if (pathname === "/manifest.webmanifest") return true;
  if (pathname === "/sw.js") return true;
  if (pathname === "/us-only" || pathname === "/us-only.html") return true;
  if (pathname.startsWith("/legal/")) return true;
  if (pathname === "/privacy" || pathname === "/terms" || pathname === "/security") {
    return true;
  }
  return false;
}

export default function middleware(request: Request): Response {
  // Local dev: vite dev / node server.js do not set VERCEL. Skip entirely so
  // developers without a US IP (or behind a VPN) can still use the app.
  if (!process.env.VERCEL) {
    return next();
  }

  const url = new URL(request.url);

  if (isAllowlistedPath(url.pathname)) {
    return next();
  }

  const { country } = geolocation(request);

  // Empty/undefined country: treat as "let through". Covers:
  //   - local dev edge cases
  //   - Vercel can't resolve the IP (rare, but happens for some carriers)
  //   - preview deploys without a real client IP
  if (!country) {
    return next();
  }

  if (ALLOWED_COUNTRIES.has(country)) {
    return next();
  }

  // Non-US visitor on a non-allowlisted path -> rewrite (NOT redirect) so the
  // URL stays put. /us-only.html is served as a static asset by Vercel.
  return rewrite(new URL("/us-only.html", request.url));
}

export const config = {
  // Run on every request. Path-level allowlisting is done in the handler
  // because Vercel's matcher regex is awkward for our combined allowlist
  // (mixed prefixes, exact paths, and the /api passthrough including the
  // webhook routes Plaid hits).
  matcher: "/:path*",
};
