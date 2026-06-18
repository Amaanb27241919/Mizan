/**
 * Generate the 1024x1024 PNG icon for Plaid Link customization.
 *
 * Plaid's Dashboard requires a 1024x1024 PNG under 4 MB for the Link
 * customization "App logo" slot. This script renders Mizan's favicon
 * geometry (rounded square + outer circle + diamond + inner dot, all
 * original Mizan primitives) at 1024x1024 using only Node built-ins —
 * zlib for IDAT compression, manual CRC32 for chunk checksums.
 *
 * Output: public/mizan-plaid-1024.png
 *
 * Run: node scripts/gen-plaid-upload-icon.mjs
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, "..", "public");

// Mizan brand palette — matches public/favicon.svg.
const BG = { r: 0x07, g: 0x08, b: 0x0e }; // #07080E  near-black
const FG = { r: 0x00, g: 0xc8, b: 0x96 }; // #00C896  Mizan green

// Target canvas.
const SIZE = 1024;

// Geometry — proportional to the 32-unit favicon viewBox, scaled to 1024.
// Favicon: rx=6, circle r=13, diamond corners {(16,5),(27,13.5),(16,22),(5,13.5)},
//          inner solid circle at (16,13.5) r=2.5. Multiply by 32 = SIZE/32.
const S = SIZE / 32;
const CORNER_R   = 6  * S;          // rounded square corner radius
const RING_R     = 13 * S;          // outer ring radius
const RING_W     = 1.5 * S;         // outer ring stroke width
const DIAMOND_W  = 1.2 * S;         // diamond stroke width
const INNER_R    = 2.5 * S;         // inner solid dot radius
// Diamond half-extents in SVG units: horizontal 11, vertical 8.5.
const DIAM_HX    = 11  * S;
const DIAM_HY    = 8.5 * S;

const CX = (SIZE - 1) / 2;          // canvas center x
const CY = (SIZE - 1) / 2;          // canvas center y
const INNER_CY = 13.5 * S - 0.5;    // inner dot vertical center (cy=13.5 in SVG)

// CRC32 — bit-by-bit reflection. Standard PNG checksum.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

// Anti-aliased pixel coverage helpers. Each returns [0,1] where 1 = fully
// inside the shape, 0 = fully outside. Sub-pixel SSAA at 3x3 keeps edges
// crisp without ballooning runtime (1024^2 * 9 ≈ 9.4M samples; fine).
const AA_STEPS = [
  -1 / 3, 0, 1 / 3,                 // sample offsets within each pixel
];

function insideRoundedRect(x, y) {
  // Treat the whole canvas as the rect; only the corners need rounding.
  // Corner check: if the pixel is in one of the 4 corner quadrants AND
  // outside the corner arc, it's outside.
  const left   = x < CORNER_R;
  const right  = x > SIZE - 1 - CORNER_R;
  const top    = y < CORNER_R;
  const bottom = y > SIZE - 1 - CORNER_R;
  if ((left || right) && (top || bottom)) {
    const cx = left ? CORNER_R : SIZE - 1 - CORNER_R;
    const cy = top  ? CORNER_R : SIZE - 1 - CORNER_R;
    const dx = x - cx, dy = y - cy;
    return dx * dx + dy * dy <= CORNER_R * CORNER_R;
  }
  return true;
}

function insideRingStroke(x, y) {
  // Annulus: distance from center within [RING_R - W/2, RING_R + W/2].
  const dx = x - CX, dy = y - CY;
  const d = Math.sqrt(dx * dx + dy * dy);
  return Math.abs(d - RING_R) <= RING_W / 2;
}

function insideDiamondStroke(x, y) {
  // Diamond as oriented rhombus: |dx|/HX + |dy|/HY = 1 is the edge.
  // Compute signed distance to that edge (approximate, scaled by the
  // gradient magnitude) and threshold by half stroke width.
  const dx = Math.abs(x - CX);
  const dy = Math.abs(y - CY);
  const t = dx / DIAM_HX + dy / DIAM_HY; // 1.0 on the edge
  // Convert the unitless deviation into pixel distance via the gradient
  // norm: |grad| = sqrt(1/HX^2 + 1/HY^2). Pixel-space distance = |t-1|/|grad|.
  const gradNorm = Math.sqrt(1 / (DIAM_HX * DIAM_HX) + 1 / (DIAM_HY * DIAM_HY));
  const pixelDist = Math.abs(t - 1) / gradNorm;
  return pixelDist <= DIAMOND_W / 2;
}

function insideInnerDot(x, y) {
  const dx = x - CX, dy = y - INNER_CY;
  return dx * dx + dy * dy <= INNER_R * INNER_R;
}

// SSAA coverage: fraction of the 9 sub-samples that are inside.
function coverage(predicate, x, y) {
  let hits = 0;
  for (const oy of AA_STEPS) for (const ox of AA_STEPS) {
    if (predicate(x + ox, y + oy)) hits++;
  }
  return hits / 9;
}

function lerp(a, b, t) { return Math.round(a + (b - a) * t); }
function blend(under, over, alpha) {
  return {
    r: lerp(under.r, over.r, alpha),
    g: lerp(under.g, over.g, alpha),
    b: lerp(under.b, over.b, alpha),
  };
}

function buildPng() {
  const stride = SIZE * 4;
  const raw = Buffer.alloc(SIZE * stride);

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      // Layer 0: rounded-square background fill (alpha = AA coverage of the
      // rounded rect). Outside the rounded rect the pixel is fully transparent.
      const aRect = coverage(insideRoundedRect, x, y);
      if (aRect === 0) {
        // Fully outside the icon — transparent pixel.
        const o = y * stride + x * 4;
        raw[o] = 0; raw[o + 1] = 0; raw[o + 2] = 0; raw[o + 3] = 0;
        continue;
      }

      let color = BG;
      // Layer 1: outer ring (FG over BG).
      const aRing = coverage(insideRingStroke, x, y);
      if (aRing > 0) color = blend(color, FG, aRing);
      // Layer 2: diamond outline (FG over current).
      const aDiam = coverage(insideDiamondStroke, x, y);
      if (aDiam > 0) color = blend(color, FG, aDiam);
      // Layer 3: inner solid dot (FG over current).
      const aDot = coverage(insideInnerDot, x, y);
      if (aDot > 0) color = blend(color, FG, aDot);

      const o = y * stride + x * 4;
      raw[o]     = color.r;
      raw[o + 1] = color.g;
      raw[o + 2] = color.b;
      raw[o + 3] = Math.round(aRect * 255);
    }
  }

  // Prepend the filter-type byte (0 = None) to each scanline before deflating.
  const filtered = Buffer.alloc(SIZE * (stride + 1));
  for (let y = 0; y < SIZE; y++) {
    filtered[y * (stride + 1)] = 0;
    raw.copy(filtered, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idatData = zlib.deflateSync(filtered, { level: 9 });

  // IHDR — 13 bytes: width(4), height(4), bit_depth(1), color_type(1),
  // compression(1), filter(1), interlace(1).
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idatData),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const png = buildPng();
const outPath = path.join(PUBLIC_DIR, "mizan-plaid-1024.png");
fs.writeFileSync(outPath, png);
const kb = (png.length / 1024).toFixed(1);
console.log(`wrote ${outPath} (${png.length.toLocaleString()} bytes, ${kb} KB, ${SIZE}x${SIZE})`);
if (png.length > 4 * 1024 * 1024) {
  console.error("× WARNING: file exceeds Plaid's 4 MB limit. Reduce SSAA or canvas size.");
  process.exit(1);
}
