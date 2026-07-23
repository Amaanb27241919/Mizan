/**
 * MĪZAN — structured JSON logger.
 *
 * Every log line is a single JSON object on its own line so Vercel's log
 * pipeline (and any external aggregator) can parse without regex. Keeps
 * the same call shape regardless of severity:
 *
 *   info("snaptrade.login", { broker, userId });
 *   warn("rate.limit_hit",  { userId, action, count, max });
 *   error("plaid.exchange_failed", { err: e.message, stack: e.stack });
 *
 * A per-request ID is injected via withRequestContext() — every log line
 * emitted inside the request's async scope automatically carries it.
 */

import { AsyncLocalStorage } from "node:async_hooks";

const _ctx = new AsyncLocalStorage();

// Random 12-char ID. nanoid would be nicer but the harness blocks adding
// new deps for a single helper. crypto.randomUUID is built-in and exactly
// fine for log correlation (uniqueness within a 24-hour cron window).
export function newRequestId() {
  // Strip dashes and trim — keeps log lines readable.
  return globalThis.crypto?.randomUUID?.()?.replace(/-/g, "").slice(0, 12)
      || Math.random().toString(36).slice(2, 14);
}

/**
 * Run `fn` inside an async-local context that carries `meta` on every
 * subsequent log call. Used as the outermost wrapper in api/[...path].mjs
 * so per-request fields (rid, method, path, userId) are auto-attached.
 */
export function withRequestContext(meta, fn) {
  return _ctx.run({ ...meta }, fn);
}

/** Merge fields into the current request's log context (mid-handler). */
export function setLogContext(extra) {
  const store = _ctx.getStore();
  if (store) Object.assign(store, extra);
}

export function log(level, event, data = {}) {
  const ctx = _ctx.getStore() || {};
  // process.stdout.write keeps the JSON on a single line; console.log
  // would too on Node, but stdout is what Vercel actually pipes.
  const line = JSON.stringify({
    ts:    new Date().toISOString(),
    level,
    event,
    ...ctx,
    ...data,
  });
  if (level === "error") process.stderr.write(line + "\n");
  else                   process.stdout.write(line + "\n");
}

export const info  = (event, data) => log("info",  event, data);
export const warn  = (event, data) => log("warn",  event, data);
export const error = (event, data) => log("error", event, data);
