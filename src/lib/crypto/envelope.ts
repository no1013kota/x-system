import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

/**
 * AES-256-GCM envelope encryption for secrets at rest (要件01 §8, 要件02 §1,
 * PRD §7): BYOK API keys and X OAuth tokens.
 *
 * Kept free of the `server-only` marker so the pure crypto logic is unit-
 * testable; the runtime entrypoint (`index.ts`) adds `server-only` and binds
 * the key from the validated env. Envelopes carry a `v` field so the key/format
 * can be rotated later (rotation policy is a future ADR).
 */

export const ENVELOPE_VERSION = 1;
const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const NONCE_BYTES = 12;

export interface Envelope {
  v: number;
  /** base64 nonce (IV) */
  n: string;
  /** base64 ciphertext */
  c: string;
  /** base64 GCM auth tag */
  t: string;
}

/**
 * Accepts a 32-byte key as raw utf8 (exactly 32 chars), base64, or hex (64
 * chars). Throws when the decoded key is not exactly 32 bytes so a
 * misconfigured APP_ENCRYPTION_KEY fails loudly rather than weakening crypto.
 */
export function resolveKey(rawKey: string): Buffer {
  const candidates: Buffer[] = [];
  if (Buffer.byteLength(rawKey, "utf8") === KEY_BYTES) {
    candidates.push(Buffer.from(rawKey, "utf8"));
  }
  if (/^[0-9a-fA-F]{64}$/.test(rawKey)) {
    candidates.push(Buffer.from(rawKey, "hex"));
  }
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(rawKey)) {
    const decoded = Buffer.from(rawKey, "base64");
    if (decoded.length === KEY_BYTES) candidates.push(decoded);
  }
  const key = candidates.find((b) => b.length === KEY_BYTES);
  if (!key) {
    throw new Error(
      "APP_ENCRYPTION_KEY must decode to 32 bytes (utf8 32 chars, hex 64 chars, or base64).",
    );
  }
  return key;
}

export function encryptWithKey(plaintext: string, key: Buffer): string {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const envelope: Envelope = {
    v: ENVELOPE_VERSION,
    n: nonce.toString("base64"),
    c: ciphertext.toString("base64"),
    t: tag.toString("base64"),
  };
  return JSON.stringify(envelope);
}

export function decryptWithKey(serialized: string, key: Buffer): string {
  let envelope: Envelope;
  try {
    envelope = JSON.parse(serialized) as Envelope;
  } catch {
    throw new Error("Invalid encryption envelope: not valid JSON.");
  }
  if (envelope.v !== ENVELOPE_VERSION) {
    throw new Error(`Unsupported encryption envelope version: ${envelope.v}`);
  }
  if (!envelope.n || !envelope.c || !envelope.t) {
    throw new Error("Invalid encryption envelope: missing fields.");
  }
  const nonce = Buffer.from(envelope.n, "base64");
  const ciphertext = Buffer.from(envelope.c, "base64");
  const tag = Buffer.from(envelope.t, "base64");
  const decipher = createDecipheriv(ALGORITHM, key, nonce);
  decipher.setAuthTag(tag);
  // GCM verifies the auth tag in final(); tampering throws here.
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
