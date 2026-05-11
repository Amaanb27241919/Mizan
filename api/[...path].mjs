/**
 * MĪZAN — Vercel catch-all serverless function.
 *
 * Single function handles every `/api/*` route to stay under Vercel
 * Hobby's 12-function cap. Delegates all logic to the shared handler
 * module so dev (server.js) and prod (this file) cannot drift.
 */

import { handleApiRequest } from "../lib/handlers.mjs";

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, "http://x");
    const result = await handleApiRequest({
      method:   req.method,
      pathname: url.pathname,
      query:    Object.fromEntries(url.searchParams),
      body:     typeof req.body === "string" ? (req.body ? JSON.parse(req.body) : {}) : (req.body || {}),
      headers:  req.headers,
    });
    res.status(result.status).setHeader("Content-Type", "application/json");
    if (result.headers) {
      for (const [k, v] of Object.entries(result.headers)) res.setHeader(k, v);
    }
    res.send(JSON.stringify(result.body));
  } catch (err) {
    const status = Number.isInteger(err?.status) ? err.status : 500;
    res.status(status).json({ error: err.message || "Internal error" });
  }
}

export const config = { runtime: "nodejs" };
