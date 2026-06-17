/**
 * MĪZAN — application-layer encryption for secrets stored in Supabase.
 *
 * Algorithm: AES-256-GCM
 *   - 256-bit key derived from ENCRYPTION_KEY env var (32-byte hex).
 *   - 96-bit random IV per operation (GCM recommended practice).
 *   - 128-bit authentication tag (GCM default, guarantees integrity).
 *
 * Key validation is lazy (checked on first call), not at import time, so
 * the module can be imported in environments where ENCRYPTION_KEY is not
 * yet configured. Calls to encrypt() / decrypt() will throw clearly when
 * the key is missing or malformed.
 *
 * No external dependencies — uses Node's built-in `node:crypto` only.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function masterKey() {
  const hex = (process.env.ENCRYPTION_KEY || "").trim();
  if (!hex) {
    throw new Error(
      "ENCRYPTION_KEY is not set. " +
      "Generate one with: openssl rand -hex 32  " +
      "then add it to Vercel env vars and .env.local."
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      `ENCRYPTION_KEY must be exactly 32 bytes (64 hex chars); got ${hex.length} chars. ` +
      "Re-generate with: openssl rand -hex 32"
    );
  }
  return Buffer.from(hex, "hex");
}

/**
 * Encrypt a plaintext string.
 * Returns an object with base64-encoded { ciphertext, iv, authTag }.
 * Each call uses a fresh random IV — two encryptions of the same plaintext
 * produce different ciphertext, which is the correct GCM behavior.
 */
export function encrypt(plaintext) {
  if (typeof plaintext !== "string") {
    throw new TypeError("encrypt: plaintext must be a string");
  }
  const key    = masterKey();
  const iv     = randomBytes(12); // 96-bit IV (recommended for AES-GCM)
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc    = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: enc.toString("base64"),
    iv:         iv.toString("base64"),
    authTag:    cipher.getAuthTag().toString("base64"),
  };
}

/**
 * Decrypt a value previously produced by encrypt().
 * Throws if the authentication tag fails (tampered or wrong key).
 */
export function decrypt({ ciphertext, iv, authTag }) {
  if (!ciphertext || !iv || !authTag) {
    throw new Error("decrypt: ciphertext, iv, and authTag are all required");
  }
  const key      = masterKey();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Round-trip self-test. Call at startup or in tests to catch key
 * misconfiguration before it touches real secrets.
 *
 * Throws with a descriptive message if encrypt → decrypt does not
 * produce the original plaintext.
 */
export function selfTest() {
  const probe = "mizan-crypto-round-trip-probe";
  const enc   = encrypt(probe);
  if (typeof enc.ciphertext !== "string" || !enc.iv || !enc.authTag) {
    throw new Error("crypto.selfTest: encrypt returned unexpected shape");
  }
  const dec = decrypt(enc);
  if (dec !== probe) {
    throw new Error(`crypto.selfTest: round-trip mismatch — expected "${probe}", got "${dec}"`);
  }
}
