#!/usr/bin/env node
// Regenerate CHANGELOG.md from the git history (Conventional Commits), grouped by
// ship date (MĪZAN deploys continuously — no version tags). Run from the repo root:
//   node scripts/gen-changelog.mjs
// Curated, narrative release notes live in MIZAN-STATE-AUDIT.md; this file is the
// mechanical, complete commit-derived changelog.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

// execFile (not exec) + fixed arg array = no shell, no injection surface.
const raw = execFileSync(
  'git',
  ['log', '--no-merges', '--pretty=format:%ad%x09%H%x09%s', '--date=short'],
  { maxBuffer: 1 << 26 },
).toString();

const CAT = { feat:'Added', fix:'Fixed', perf:'Changed', refactor:'Changed', docs:'Docs', chore:'Maintenance', ci:'Maintenance', build:'Maintenance', test:'Maintenance', style:'Maintenance' };
const ORDER = ['Added', 'Changed', 'Fixed', 'Docs', 'Maintenance', 'Other'];
const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const byDate = new Map();
for (const line of raw.split('\n')) {
  const [date, hash, subj] = line.split('\t');
  if (!date || !subj) continue;
  const m = subj.match(/^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.*)$/);
  let cat = 'Other', scope = '', desc = subj;
  if (m) { cat = CAT[m[1].toLowerCase()] || 'Other'; scope = m[2] || ''; desc = m[4] || subj; }
  if (!byDate.has(date)) byDate.set(date, {});
  const g = byDate.get(date);
  (g[cat] ||= []).push({ scope, desc: cap(desc.trim()), hash: hash.slice(0, 7) });
}

const dates = [...byDate.keys()].sort().reverse();
let out = `# Changelog

All notable changes to **MĪZAN**, generated from the git history ([Conventional Commits](https://www.conventionalcommits.org)). MĪZAN ships continuously to production, so entries are grouped by **ship date** rather than version tags. Newest first.

**Categories:** Added (features) · Changed (improvements & refactors) · Fixed (bug fixes) · Docs · Maintenance (chore/ci/test).

> Regenerate with \`node scripts/gen-changelog.mjs\`. Curated release notes with more narrative live in \`MIZAN-STATE-AUDIT.md\`.

`;
for (const date of dates) {
  out += `\n## ${date}\n`;
  const g = byDate.get(date);
  for (const cat of ORDER) {
    if (!g[cat] || !g[cat].length) continue;
    out += `\n### ${cat}\n`;
    for (const it of g[cat]) out += `- ${it.scope ? `**${it.scope}:** ` : ''}${it.desc} (\`${it.hash}\`)\n`;
  }
}
fs.writeFileSync('CHANGELOG.md', out);
console.log(`wrote CHANGELOG.md — ${dates.length} dates`);
