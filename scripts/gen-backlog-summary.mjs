#!/usr/bin/env node
/**
 * MĪZAN — build-time BACKLOG.md → compact JSON for the Admin Center.
 *
 * BACKLOG.md is ~176KB of prose and evidence. Bundling it raw would put a
 * sixth of a megabyte of markdown into the client for a panel only the owner
 * opens, so this extracts just what the admin tile renders: bucket headers and
 * per-item id / title / done-state.
 *
 * Runs as part of `npm run build`, and the output IS committed — so the import
 * always resolves for `npm test` and `vite dev` without anyone remembering to
 * run a generator first. The build regenerating it is what keeps it honest.
 *
 * Parsing rules, matched to how BACKLOG.md is actually written:
 *   `## <LETTER> — <title>`   starts a bucket (single capital letter + em dash)
 *   `### <ID> — <title>`      is an item inside the current bucket
 *   an item is DONE when its heading carries ✅ or the word DONE
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = resolve(root, "BACKLOG.md");
const OUT = resolve(root, "src/generated/backlog.json");

// `## F — Fixes / correctness (autonomous)` → bucket F.
// Anchored to a single capital letter so the dated "## 2026-07-28 — …" session
// blocks and "## How to use this file" are skipped.
const BUCKET_RE = /^##\s+([A-Z])\s+—\s+(.+?)\s*$/;
const ITEM_RE = /^###\s+([A-Z]\d+)\s+—\s+(.+?)\s*$/;
const DONE_RE = /✅|\bDONE\b/;

// Completion is recorded two different ways in this file: older items put
// "✅ DONE" in the heading, newer ones carry a `- **Status:** ✅ SHIPPED …`
// bullet underneath. Read both, or freshly-completed work keeps showing as open.
const STATUS_RE = /^-\s+\*\*Status:\*\*\s*(.+)$/;
const STATUS_DONE_RE = /✅|\bSHIPPED\b|\bDONE\b/i;

function parse(md) {
  const buckets = [];
  let current = null;
  let lastItem = null;
  for (const line of md.split("\n")) {
    const b = line.match(BUCKET_RE);
    if (b) {
      current = { key: b[1], title: b[2].replace(/\s*\(.*\)\s*$/, "").trim(), items: [] };
      buckets.push(current);
      lastItem = null;
      continue;
    }
    // A `### ` heading before any bucket header belongs to a session-notes
    // block, not to the taxonomy — ignore it.
    if (!current) continue;
    const i = line.match(ITEM_RE);
    if (i) {
      const title = i[2].trim();
      lastItem = {
        id: i[1],
        // Strip the done marker from the display title; `done` carries it.
        title: title.replace(/\s*—?\s*✅\s*DONE.*$/i, "").replace(/\s*✅\s*/g, " ").trim(),
        done: DONE_RE.test(title),
      };
      current.items.push(lastItem);
      continue;
    }
    // The Status bullet belongs to the item most recently opened above it.
    if (lastItem && !lastItem.done) {
      const st = line.match(STATUS_RE);
      if (st && STATUS_DONE_RE.test(st[1])) lastItem.done = true;
    }
  }
  return buckets;
}

const md = readFileSync(SRC, "utf8");
const buckets = parse(md);
if (buckets.length === 0) {
  console.error("[backlog] no buckets parsed — BACKLOG.md structure changed?");
  process.exit(1);
}

// S ("Already shipped") and X ("Obsolete") are archives — their items are
// resolved by definition, and the headings don't carry a ✅ because the bucket
// itself IS the marker. Without this they'd report as 5/5 and 2/2 open, which
// is simply false.
const ARCHIVE_BUCKETS = new Set(["S", "X"]);

const payload = {
  // Deliberately no generatedAt timestamp: it would dirty the committed file on
  // every build and produce noise commits that say nothing.
  source: "BACKLOG.md",
  buckets: buckets.map((b) => {
    const archive = ARCHIVE_BUCKETS.has(b.key);
    const items = archive ? b.items.map((i) => ({ ...i, done: true })) : b.items;
    return {
      ...b,
      items,
      archive,
      open: items.filter((i) => !i.done).length,
      total: items.length,
    };
  }),
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n");

const totals = payload.buckets.map((b) => `${b.key}:${b.open}/${b.total}`).join(" ");
console.log(`[backlog] ${payload.buckets.length} buckets → ${OUT.replace(root + "/", "")}  (${totals})`);
