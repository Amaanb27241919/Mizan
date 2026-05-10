/**
 * Generate MĪZAN PWA icons (icon-192.png, icon-512.png) using only Node built-ins.
 *
 * Produces a solid dark-navy (#06080D) background with a centered blue (#2563EB)
 * diamond shape, written as a valid PNG (zlib + CRC32) — no external deps.
 *
 * Run: node scripts/gen-pwa-icons.mjs
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, "..", "public");

const BG = { r: 0x06, g: 0x08, b: 0x0d }; // #06080D
const FG = { r: 0x25, g: 0x63, b: 0xeb }; // #2563EB

// CRC32 table for PNG chunk checksums.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function buildPng(size) {
  // RGBA pixel buffer.
  const stride = size * 4;
  const raw = Buffer.alloc(size * stride);

  // Diamond geometry: centered, half-width = 36% of canvas.
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const half = size * 0.36;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inDiamond = Math.abs(x - cx) + Math.abs(y - cy) <= half;
      const c = inDiamond ? FG : BG;
      const o = y * stride + x * 4;
      raw[o] = c.r;
      raw[o + 1] = c.g;
      raw[o + 2] = c.b;
      raw[o + 3] = 0xff;
    }
  }

  // Add filter byte (0 = None) at the start of each scanline.
  const filtered = Buffer.alloc(size * (stride + 1));
  for (let y = 0; y < size; y++) {
    filtered[y * (stride + 1)] = 0;
    raw.copy(filtered, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }

  const idatData = zlib.deflateSync(filtered, { level: 9 });

  // IHDR: width, height, bit depth, color type (6 = RGBA), compression, filter, interlace.
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idatData),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const targets = [
  { size: 192, name: "icon-192.png" },
  { size: 512, name: "icon-512.png" },
];

for (const { size, name } of targets) {
  const png = buildPng(size);
  const outPath = path.join(PUBLIC_DIR, name);
  fs.writeFileSync(outPath, png);
  console.log(`wrote ${outPath} (${png.length} bytes, ${size}x${size})`);
}
