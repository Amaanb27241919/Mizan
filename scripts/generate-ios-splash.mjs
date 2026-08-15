/**
 * Generates iOS PWA launch images (`apple-touch-startup-image`) plus the <link>
 * tags that reference them.
 *
 *   node scripts/generate-ios-splash.mjs           # write PNGs + print tags
 *   node scripts/generate-ios-splash.mjs --check    # verify existing files only
 *
 * WHY: Android needs none of this — Chrome synthesises a launch screen from the
 * manifest's background_color + theme_color + icon. iOS synthesises nothing, so
 * an installed Mizan shows a BLANK WHITE screen from tap until React paints.
 * Safari only accepts an image whose media query matches the device exactly,
 * which is why this is a generated matrix rather than one file.
 *
 * Portrait only, deliberately. Covering landscape as well would double the
 * matrix to ~44 files for a case that barely happens — people tap a home-screen
 * icon holding the phone upright. A landscape launch falls back to a plain
 * background, which is the pre-existing behaviour, not a regression.
 *
 * Both colour schemes are generated. iOS picks by `prefers-color-scheme`, which
 * follows the SYSTEM appearance — while Mizan's theme lives in localStorage. So
 * a user who forces the app to dark on a light-appearance phone still gets the
 * light splash. That residual mismatch is unavoidable without iOS exposing the
 * app's own preference; generating both still fixes the common case, which is
 * a dark-phone user currently getting a white flash.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve("public/splash");
const BASE = process.env.PREVIEW_URL || "http://localhost:4173";
const CHECK_ONLY = process.argv.includes("--check");

// CSS width/height + DPR for every iPhone Safari currently reports. Several
// devices share metrics (X/XS/11 Pro/12 mini/13 mini are all 375x812@3), so
// one entry can cover a family. 414x896 appears at BOTH dpr 2 (XR/11) and
// dpr 3 (XS Max/11 Pro Max) and genuinely needs two files.
const DEVICES = [
  { w: 375, h: 667, dpr: 2, note: "SE 2nd/3rd, 6/7/8" },
  { w: 414, h: 736, dpr: 3, note: "8 Plus" },
  { w: 375, h: 812, dpr: 3, note: "X, XS, 11 Pro, 12/13 mini" },
  { w: 414, h: 896, dpr: 2, note: "XR, 11" },
  { w: 414, h: 896, dpr: 3, note: "XS Max, 11 Pro Max" },
  { w: 390, h: 844, dpr: 3, note: "12, 12 Pro, 13, 13 Pro, 14" },
  { w: 428, h: 926, dpr: 3, note: "12/13 Pro Max, 14 Plus" },
  { w: 393, h: 852, dpr: 3, note: "14 Pro, 15, 15 Pro, 16" },
  { w: 430, h: 932, dpr: 3, note: "14 Pro Max, 15 Plus/Pro Max, 16 Plus" },
  { w: 402, h: 874, dpr: 3, note: "16 Pro" },
  { w: 440, h: 956, dpr: 3, note: "16 Pro Max" },
];

// Must track index.html's first-paint block, or the splash hands over to a
// different colour and the launch flickers.
const THEMES = {
  light: { bg: "#faf8f4", ink: "#1c1b19", mask: false },
  dark:  { bg: "#0e1626", ink: "#f4f2ec", mask: true },
};

const fileFor = (d, theme) => `${d.w}x${d.h}@${d.dpr}-${theme}.png`;

/**
 * The lockup is public/logo.png — transparent artwork, so light can render it
 * natively (navy, brand-accurate) while dark paints the same shape as an ivory
 * silhouette via a CSS mask. Same composition either way.
 */
function html(theme, logoDataUri) {
  const t = THEMES[theme];
  const art = t.mask
    ? `<div style="width:62%;aspect-ratio:1400/313;background:${t.ink};
         -webkit-mask:url('${logoDataUri}') center/contain no-repeat;
         mask:url('${logoDataUri}') center/contain no-repeat"></div>`
    : `<img src="${logoDataUri}" style="width:62%;display:block">`;
  return `<!doctype html><html><body style="margin:0;height:100vh;background:${t.bg};
    display:flex;align-items:center;justify-content:center">${art}</body></html>`;
}

const pngSize = (f) => { const b = fs.readFileSync(f); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };

/** The <link> tags, in the exact form Safari matches on. */
function linkTags() {
  const lines = [];
  for (const theme of Object.keys(THEMES)) {
    for (const d of DEVICES) {
      lines.push(
        `    <link rel="apple-touch-startup-image" media="(prefers-color-scheme: ${theme}) and ` +
        `(device-width: ${d.w}px) and (device-height: ${d.h}px) and ` +
        `(-webkit-device-pixel-ratio: ${d.dpr}) and (orientation: portrait)" ` +
        `href="/splash/${fileFor(d, theme)}" />`
      );
    }
  }
  return lines.join("\n");
}

async function generate() {
  fs.mkdirSync(OUT, { recursive: true });
  const logo = "data:image/png;base64," + fs.readFileSync("public/logo.png").toString("base64");
  const browser = await chromium.launch();
  let total = 0;
  for (const theme of Object.keys(THEMES)) {
    for (const d of DEVICES) {
      const ctx = await browser.newContext({
        viewport: { width: d.w, height: d.h },
        deviceScaleFactor: d.dpr,
      });
      const page = await ctx.newPage();
      await page.setContent(html(theme, logo));
      await page.waitForTimeout(120);
      const file = path.join(OUT, fileFor(d, theme));
      await page.screenshot({ path: file });
      await ctx.close();
      const { w, h } = pngSize(file);
      if (w !== d.w * d.dpr || h !== d.h * d.dpr) {
        console.error(`FAIL ${fileFor(d, theme)} is ${w}x${h}, expected ${d.w * d.dpr}x${d.h * d.dpr}`);
        process.exitCode = 1;
      }
      total += fs.statSync(file).size;
    }
  }
  await browser.close();
  console.log(`${DEVICES.length * 2} files, ${(total / 1024).toFixed(0)}KB total\n`);
  console.log(linkTags());
}

function check() {
  let bad = 0;
  for (const theme of Object.keys(THEMES)) {
    for (const d of DEVICES) {
      const f = path.join(OUT, fileFor(d, theme));
      if (!fs.existsSync(f)) { console.error(`missing ${f}`); bad++; continue; }
      const { w, h } = pngSize(f);
      if (w !== d.w * d.dpr || h !== d.h * d.dpr) {
        console.error(`${fileFor(d, theme)} is ${w}x${h}, expected ${d.w * d.dpr}x${d.h * d.dpr}`);
        bad++;
      }
    }
  }
  console.log(bad ? `${bad} problems` : "all splash images present and correctly sized");
  process.exitCode = bad ? 1 : 0;
}

if (CHECK_ONLY) check();
else generate().catch((e) => { console.error(e); process.exit(1); });
