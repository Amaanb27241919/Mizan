/**
 * MĪZAN — Unified dev server (ESM)
 *
 * Runs Vite (frontend) + the SnapTrade backend on a single port (3000)
 * from a single terminal: `npm run dev`.
 *
 * In production (NODE_ENV=production), serves the built `dist/` folder.
 *
 * Route logic lives in `lib/handlers.mjs` — shared with the Vercel
 * catch-all serverless function at `api/[...path].mjs` so dev and prod
 * cannot drift.
 *
 * Crash diagnostics: signals, uncaught errors, and exit reasons are
 * appended to .dev.log so we can see what killed the process.
 */

import http from "node:http";
import fs   from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Crash / signal diagnostics ───────────────────────────
const LOG_FILE = path.join(__dirname, ".dev.log");
const ts = () => new Date().toISOString();
const logLine = msg => {
  const line = `[${ts()}] pid=${process.pid} ${msg}\n`;
  process.stderr.write(line);
  try { fs.appendFileSync(LOG_FILE, line); } catch {}
};

logLine(`startup node=${process.version} rss=${(process.memoryUsage().rss / 1e6).toFixed(0)}MB`);

["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"].forEach(sig => {
  process.on(sig, () => {
    logLine(`received ${sig} — shutting down`);
    process.exit(0);
  });
});

process.on("uncaughtException",  err => logLine(`uncaughtException: ${err.stack || err}`));
process.on("unhandledRejection", err => logLine(`unhandledRejection: ${err && err.stack || err}`));
process.on("exit", code => logLine(`exit code=${code}`));

// SIGKILL cannot be caught — but a periodic memory log lets us see if
// macOS OOM-killed us due to a memory blow-up.
setInterval(() => {
  const m = process.memoryUsage();
  logLine(`mem rss=${(m.rss / 1e6).toFixed(0)}MB heap=${(m.heapUsed / 1e6).toFixed(0)}MB`);
}, 60_000).unref();

// ── Load .env.local ──────────────────────────────────────
function loadEnv(filePath) {
  try {
    fs.readFileSync(filePath, "utf8").split("\n").forEach(line => {
      const clean = line.trim();
      if (!clean || clean.startsWith("#")) return;
      const eq = clean.indexOf("=");
      if (eq === -1) return;
      const key = clean.slice(0, eq).trim();
      const val = clean.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (key && val && !process.env[key]) process.env[key] = val;
    });
  } catch {}
}
loadEnv(path.join(__dirname, ".env.local"));
loadEnv(path.join(__dirname, ".env"));

// ── PWA icon generation (idempotent, runs at boot) ───────
// Materializes public/icon-192.png and public/icon-512.png if missing.
// Solid dark-navy (#06080D) background with a centered blue (#2563EB) diamond.
// Pure Node built-ins (zlib + Buffer) — no image deps.
function ensurePwaIcons() {
  const publicDir = path.join(__dirname, "public");
  const targets = [
    { size: 192, file: path.join(publicDir, "icon-192.png") },
    { size: 512, file: path.join(publicDir, "icon-512.png") },
  ];
  if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
  if (targets.every(t => fs.existsSync(t.file))) return;

  const BG = [0x06, 0x08, 0x0d];
  const FG = [0x25, 0x63, 0xeb];

  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();
  const crc32 = buf => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, "ascii");
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  };

  for (const { size, file } of targets) {
    if (fs.existsSync(file)) continue;
    const cx = (size - 1) / 2, cy = (size - 1) / 2, half = size * 0.36;
    const stride = size * 4;
    const filtered = Buffer.alloc(size * (stride + 1));
    for (let y = 0; y < size; y++) {
      const rowStart = y * (stride + 1);
      filtered[rowStart] = 0;
      for (let x = 0; x < size; x++) {
        const inDiamond = Math.abs(x - cx) + Math.abs(y - cy) <= half;
        const c = inDiamond ? FG : BG;
        const o = rowStart + 1 + x * 4;
        filtered[o] = c[0]; filtered[o + 1] = c[1]; filtered[o + 2] = c[2]; filtered[o + 3] = 0xff;
      }
    }
    const idat = zlib.deflateSync(filtered, { level: 9 });
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
    ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const png = Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
    fs.writeFileSync(file, png);
    logLine(`pwa: wrote ${path.basename(file)} (${png.length} bytes)`);
  }
}
try { ensurePwaIcons(); } catch (err) { logLine(`pwa icon gen failed: ${err.message}`); }

// Sanity check SnapTrade keys before booting the dev server.
const CLIENT_ID = (
  process.env.VITE_SNAPTRADE_CLIENT_ID ||
  process.env.SNAPTRADE_CLIENT_ID || ""
).trim();
const CONSUMER_KEY = (
  process.env.VITE_SNAPTRADE_CONSUMER_KEY ||
  process.env.SNAPTRADE_CONSUMER_KEY || ""
).trim();
if (!CLIENT_ID || !CONSUMER_KEY) {
  console.error("\n  ❌  Missing SnapTrade keys in .env.local\n");
  console.error("  Add these two lines with your actual values:");
  console.error("  VITE_SNAPTRADE_CLIENT_ID=your-client-id-here");
  console.error("  VITE_SNAPTRADE_CONSUMER_KEY=your-consumer-key-here\n");
  process.exit(1);
}

// ── Shared API route handler ─────────────────────────────
const { handleApiRequest } = await import("./lib/handlers.mjs");

// Thin wrapper: stream/parse the body, call the shared handler,
// serialize the result. All route logic lives in lib/handlers.mjs.
async function handleApi(req, res, url) {
  let body = "";
  for await (const chunk of req) body += chunk;
  let parsed = {};
  try { parsed = body ? JSON.parse(body) : {}; } catch {}

  const result = await handleApiRequest({
    method: req.method,
    pathname: url.pathname,
    query: Object.fromEntries(url.searchParams),
    body: parsed,
    headers: req.headers,
  });
  res.writeHead(result.status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(result.body));
}

// ── Boot: Vite middleware + API on one port ──────────────
const PORT = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === "production";

let viteMiddleware = null;
let staticHandler  = null;

if (isProd) {
  const distDir = path.join(__dirname, "dist");
  if (!fs.existsSync(distDir)) {
    console.error(`\n  ❌  ${distDir} not found. Run 'npm run build' first.\n`);
    process.exit(1);
  }
  staticHandler = (req, res) => {
    let p = req.url.split("?")[0];
    if (p === "/" || !path.extname(p)) p = "/index.html";
    const file = path.join(distDir, p);
    if (!file.startsWith(distDir) || !fs.existsSync(file)) {
      res.writeHead(404); res.end("Not found"); return;
    }
    const ext = path.extname(file).toLowerCase();
    const types = {
      ".html":"text/html",".js":"application/javascript",".css":"text/css",
      ".json":"application/json",".svg":"image/svg+xml",".png":"image/png",
      ".jpg":"image/jpeg",".woff2":"font/woff2",".ico":"image/x-icon",
      ".webmanifest":"application/manifest+json",
      ".woff":"font/woff",".txt":"text/plain",
    };
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  };
} else {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    root: __dirname,
    server: { middlewareMode: true },
    appType: "spa",
  });
  viteMiddleware = vite.middlewares;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (
    url.pathname.startsWith("/api/snaptrade") ||
    url.pathname.startsWith("/api/finnhub")   ||
    url.pathname.startsWith("/api/polygon")   ||
    url.pathname === "/api/advisor"
  ) {
    console.log(`${req.method} ${url.pathname}`);
    try { await handleApi(req, res, url); }
    catch (err) {
      logLine(`api error: ${err.stack || err}`);
      console.error("  ✗", err.message);
      const status = Number.isInteger(err?.status) ? err.status : 500;
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (viteMiddleware) return viteMiddleware(req, res);
  if (staticHandler)  return staticHandler(req, res);
  res.writeHead(503); res.end("No frontend handler");
});

server.on("error", err => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n  ✗  Port ${PORT} is already in use.`);
    console.error(`     Free it with:  lsof -ti:${PORT} | xargs kill -9\n`);
    process.exit(1);
  }
  logLine(`server error: ${err.stack || err}`);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`
  MĪZAN ${isProd ? "(production)" : "(dev)"}
  → http://localhost:${PORT}
  Client ID: ${CLIENT_ID.slice(0, 8)}...

  API:
    GET  /api/snaptrade/status
    POST /api/snaptrade/login     { broker, connectionType }
    GET  /api/snaptrade/accounts
    GET  /api/snaptrade/holdings?accountId=xxx

  Crash log: ${LOG_FILE}
`);
});
