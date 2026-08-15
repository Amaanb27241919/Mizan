// Guards the PWA install surface for Chrome/Android and Safari/iOS.
//
// These are static-asset contracts, not behaviour, so they belong in the fast
// unit suite rather than E2E. Every check below corresponds to something that
// silently degrades rather than erroring: a missing screenshot drops Chrome
// back to the plain install prompt, a mismatched `id` orphans existing
// installs, a broken icon path shows a blank home-screen tile.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const PUB = path.resolve(__dirname, "../../public");
const manifest = JSON.parse(fs.readFileSync(path.join(PUB, "manifest.webmanifest"), "utf8"));
const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../index.html"), "utf8");

/** PNG header read — width/height without pulling in an image library. */
function pngSize(file) {
  const b = fs.readFileSync(file);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

describe("PWA manifest", () => {
  it("keeps `id` equal to `start_url`", () => {
    // When `id` is absent the computed identity IS start_url. Mizan shipped
    // without one, so every existing install is keyed on "/?source=pwa".
    // Setting id to anything else — "/" being the tempting choice — makes
    // Chrome treat this as a DIFFERENT app: existing installs stop updating
    // and a reinstall creates a duplicate. It must stay byte-identical.
    expect(manifest.id).toBe(manifest.start_url);
  });

  it("does not lock orientation", () => {
    // Owner decision 2026-08-15: installed app rotates, so the landscape work
    // reaches installed users and not just browser tabs.
    expect(manifest.orientation).toBeUndefined();
  });

  it("points every icon, screenshot and shortcut icon at a file that exists", () => {
    const refs = [
      ...manifest.icons.map((i) => i.src),
      ...manifest.screenshots.map((s) => s.src),
      ...manifest.shortcuts.flatMap((s) => (s.icons || []).map((i) => i.src)),
    ];
    const missing = [...new Set(refs)].filter((src) => !fs.existsSync(path.join(PUB, src)));
    expect(missing, `manifest references missing files: ${missing.join(", ")}`).toEqual([]);
  });

  it("declares icon sizes that match the actual files", () => {
    const wrong = manifest.icons.filter((i) => {
      const { width, height } = pngSize(path.join(PUB, i.src));
      return `${width}x${height}` !== i.sizes;
    }).map((i) => i.src);
    expect(wrong, `icon `.concat(wrong.join(", "), " sizes disagree with the file")).toEqual([]);
  });

  it("ships maskable icons whose artwork survives Android's crop", () => {
    // A maskable icon is cropped to the platform's shape; only the centred
    // circle of 40% radius is guaranteed visible. Declaring `maskable` on
    // artwork that runs to the edges gets it clipped on Android.
    const maskable = manifest.icons.filter((i) => (i.purpose || "").includes("maskable"));
    expect(maskable.length).toBeGreaterThan(0);
    // The mark is a white field with centred artwork; assert the file really
    // is opaque, since a transparent maskable icon is composited unpredictably
    // and iOS flattens alpha onto black.
    for (const i of maskable) {
      const b = fs.readFileSync(path.join(PUB, i.src));
      expect(b.readUInt8(25), `${i.src} must be RGBA/RGB PNG`).toBeGreaterThanOrEqual(2);
    }
  });

  // Chrome's documented limits for the richer install UI. Break any of them and
  // Chrome silently falls back to the basic prompt — no error, no warning.
  it("meets Chrome's screenshot rules for the richer install UI", () => {
    expect(manifest.screenshots.length).toBeGreaterThan(0);
    for (const s of manifest.screenshots) {
      const { width, height } = pngSize(path.join(PUB, s.src));
      expect(`${width}x${height}`, `${s.src} sizes field is wrong`).toBe(s.sizes);
      const min = Math.min(width, height), max = Math.max(width, height);
      expect(min, `${s.src} too small`).toBeGreaterThanOrEqual(320);
      expect(max, `${s.src} too large`).toBeLessThanOrEqual(3840);
      expect(max, `${s.src} is too elongated (max must be <= 2.3x min)`).toBeLessThanOrEqual(2.3 * min);
      expect(["narrow", "wide"]).toContain(s.form_factor);
      expect(s.type).toBe("image/png");
    }
  });

  it("uses one aspect ratio per form factor", () => {
    // Chrome requires all screenshots of a given form factor to share an
    // aspect ratio; mixing them drops the rich UI.
    for (const ff of ["narrow", "wide"]) {
      const group = manifest.screenshots.filter((s) => s.form_factor === ff);
      expect(group.length, `no ${ff} screenshots`).toBeGreaterThan(0);
      const ratios = new Set(group.map((s) => {
        const [w, h] = s.sizes.split("x").map(Number);
        return (Math.max(w, h) / Math.min(w, h)).toFixed(3);
      }));
      expect(ratios.size, `${ff} screenshots mix aspect ratios`).toBe(1);
    }
  });

  it("keeps the description inside Chrome's 300-character limit", () => {
    expect(manifest.description.length).toBeGreaterThan(0);
    expect(manifest.description.length).toBeLessThanOrEqual(300);
  });

  it("only offers shortcuts to tabs the app can actually deep-link to", () => {
    // The ?tab= reader in MizanApp validates against this list. A shortcut
    // outside it would land on whatever tab localStorage last held, making the
    // shortcut menu a lie.
    const DEEP_LINKABLE = ["overview", "finances", "portfolio", "goals", "advisor", "settings"];
    for (const s of manifest.shortcuts) {
      const tab = new URL(s.url, "https://app.mizan.exchange").searchParams.get("tab");
      expect(DEEP_LINKABLE, `shortcut "${s.name}" targets un-linkable tab ${tab}`).toContain(tab);
    }
  });
});

describe("iOS PWA meta tags", () => {
  it("never uses the deprecated black-translucent status bar style", () => {
    // black-translucent forces WHITE status-bar text over the page background.
    // Mizan's default face is the paper canvas, so the clock/battery/signal
    // were invisible for every light-theme user. Apple has also deprecated the
    // value. `default` gives dark text below the bar.
    const m = indexHtml.match(/apple-mobile-web-app-status-bar-style"\s+content="([^"]+)"/);
    expect(m, "status bar style meta tag is missing").toBeTruthy();
    expect(m[1]).not.toBe("black-translucent");
    expect(["default", "black"]).toContain(m[1]);
  });

  it("serves an apple-touch-icon at the 180x180 iOS expects", () => {
    const m = indexHtml.match(/rel="apple-touch-icon"\s+sizes="180x180"\s+href="([^"]+)"/);
    expect(m, "no 180x180 apple-touch-icon link").toBeTruthy();
    const file = path.join(PUB, m[1]);
    expect(fs.existsSync(file), `${m[1]} missing`).toBe(true);
    expect(pngSize(file)).toEqual({ width: 180, height: 180 });
  });

  // iOS only accepts a launch image whose media query matches the device
  // exactly. A file that is missing, or present at the wrong pixel size, is
  // ignored in silence and the user gets a blank white launch — the exact
  // problem these exist to fix. So parse each tag's own media query and hold
  // the file to it, rather than trusting the filename.
  it("ships a correctly sized launch image for every startup-image tag", () => {
    const tags = [...indexHtml.matchAll(
      /<link rel="apple-touch-startup-image" media="([^"]+)" href="([^"]+)"/g
    )];
    expect(tags.length, "no apple-touch-startup-image tags").toBeGreaterThan(0);

    const problems = [];
    const seen = new Set();
    for (const [, media, href] of tags) {
      const w = +media.match(/device-width:\s*(\d+)px/)?.[1];
      const h = +media.match(/device-height:\s*(\d+)px/)?.[1];
      const dpr = +media.match(/-webkit-device-pixel-ratio:\s*(\d+)/)?.[1];
      const scheme = media.match(/prefers-color-scheme:\s*(light|dark)/)?.[1];
      if (!w || !h || !dpr || !scheme) { problems.push(`${href}: unparseable media query`); continue; }

      // Two tags claiming the same device+scheme means one silently wins.
      const k = `${w}x${h}@${dpr}/${scheme}`;
      if (seen.has(k)) problems.push(`duplicate media query for ${k}`);
      seen.add(k);

      const file = path.join(PUB, href);
      if (!fs.existsSync(file)) { problems.push(`${href}: missing`); continue; }
      const { width, height } = pngSize(file);
      if (width !== w * dpr || height !== h * dpr) {
        problems.push(`${href}: is ${width}x${height}, media query demands ${w * dpr}x${h * dpr}`);
      }
    }
    expect(problems, problems.join("\n  ")).toEqual([]);
  });

  it("covers both colour schemes for every device it covers at all", () => {
    // A device with only a light splash gives dark-appearance users the white
    // flash this whole matrix exists to remove.
    const tags = [...indexHtml.matchAll(/<link rel="apple-touch-startup-image" media="([^"]+)"/g)];
    const byDevice = {};
    for (const [, media] of tags) {
      const d = `${media.match(/device-width:\s*(\d+)px/)?.[1]}x${media.match(/device-height:\s*(\d+)px/)?.[1]}@${media.match(/-webkit-device-pixel-ratio:\s*(\d+)/)?.[1]}`;
      (byDevice[d] ||= new Set()).add(media.match(/prefers-color-scheme:\s*(light|dark)/)?.[1]);
    }
    const incomplete = Object.entries(byDevice)
      .filter(([, schemes]) => !(schemes.has("light") && schemes.has("dark")))
      .map(([d]) => d);
    expect(incomplete, `devices missing a colour scheme: ${incomplete.join(", ")}`).toEqual([]);
  });

  it("allows pinch-zoom", () => {
    // WCAG 1.4.4. Mizan's densest surfaces are numeric tables.
    const m = indexHtml.match(/name="viewport"\s+content="([^"]+)"/);
    expect(m).toBeTruthy();
    expect(m[1]).not.toMatch(/user-scalable\s*=\s*no/);
    expect(m[1]).toMatch(/viewport-fit=cover/);   // needed for safe-area insets
  });
});
