/**
 * MĪZAN — Vercel catch-all serverless function.
 *
 * Single function handles every `/api/*` route to stay under Vercel
 * Hobby's 12-function cap. Delegates all logic to the shared handler
 * module so dev (server.js) and prod (this file) cannot drift.
 */

// Side-effect import: validates required env vars at cold-start and logs
// a ✓/✗ per variable. Doesn't throw — missing optional vars degrade
// gracefully — but missing REQUIRED vars surface in the function log so
// you don't waste hours debugging "auth: not configured" 500s.
import "../scripts/check-env.mjs";

// Initialize Sentry FIRST so subsequent module loads can be instrumented
// for errors. No-op when SENTRY_DSN is unset.
import { initSentry, Sentry } from "../lib/sentry.mjs";
initSentry();

import { handleApiRequest } from "../lib/handlers.mjs";

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, "http://x");
    const result = await handleApiRequest({
      method:   req.method,
      pathname: url.pathname,
      query:    Object.fromEntries(url.searchParams),
      body:     typeof req.body === "string" ? (req.body ? JSON.parse(req.body) : {}) : (req.body || {}),
      // Raw body for signature verification (Plaid webhook). When Vercel has
      // already parsed the JSON into an object the raw bytes are gone, so this
      // is the string form only; verifyPlaidWebhook falls back to signature +
      // freshness when the body hash can't be checked.
      rawBody:  typeof req.body === "string" ? req.body : "",
      headers:  req.headers,
    });
    // Honor handler-provided Content-Type (e.g. text/csv for /api/export/*).
    // When the handler sets one, write `result.body` as-is and skip the JSON
    // default. Otherwise, fall back to application/json + JSON.stringify.
    const extraHeaders = result.headers || {};
    const ctOverride = extraHeaders["Content-Type"] || extraHeaders["content-type"];
    if (!ctOverride) res.setHeader("Content-Type", "application/json");
    for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
    res.status(result.status);
    res.send(ctOverride && typeof result.body === "string" ? result.body : JSON.stringify(result.body));
  } catch (err) {
    // Report to Sentry (no-op when DSN unset; PII scrubbed in beforeSend)
    try { Sentry.captureException(err); } catch { /* swallow */ }
    const status = Number.isInteger(err?.status) ? err.status : 500;
    const body = { error: err.message || "Internal error" };
    if (typeof err?.code === "string") body.code = err.code;
    res.status(status).json(body);
  }
}

export const config = { runtime: "nodejs" };
