import { describe, expect, it } from "vitest";

import {
  ENVELOPE_VERSION,
  decryptWithKey,
  encryptWithKey,
  resolveKey,
  type Envelope,
} from "./envelope";

const KEY = resolveKey("0123456789abcdef0123456789abcdef"); // 32 utf8 chars

describe("resolveKey", () => {
  it("accepts a 32-char utf8 key", () => {
    expect(resolveKey("0123456789abcdef0123456789abcdef").length).toBe(32);
  });

  it("accepts a 64-char hex key", () => {
    expect(resolveKey("a".repeat(64)).length).toBe(32);
  });

  it("rejects a key that does not decode to 32 bytes", () => {
    expect(() => resolveKey("too-short")).toThrow(/32 bytes/);
  });
});

describe("encrypt/decrypt roundtrip", () => {
  it("recovers the plaintext (incl. multibyte)", () => {
    const plaintext = "sk-secret-トークン-🔐";
    expect(decryptWithKey(encryptWithKey(plaintext, KEY), KEY)).toBe(plaintext);
  });

  it("produces a JSON envelope with version, nonce, ciphertext, auth tag", () => {
    const env = JSON.parse(encryptWithKey("hello", KEY)) as Envelope;
    expect(env.v).toBe(ENVELOPE_VERSION);
    expect(env.n).toBeTruthy();
    expect(env.c).toBeTruthy();
    expect(env.t).toBeTruthy();
  });

  it("uses a fresh nonce per call", () => {
    const a = JSON.parse(encryptWithKey("same", KEY)) as Envelope;
    const b = JSON.parse(encryptWithKey("same", KEY)) as Envelope;
    expect(a.n).not.toBe(b.n);
    expect(a.c).not.toBe(b.c);
  });
});

describe("tamper detection", () => {
  it("fails when ciphertext is altered", () => {
    const env = JSON.parse(encryptWithKey("secret", KEY)) as Envelope;
    const flipped = Buffer.from(env.c, "base64");
    flipped[0] ^= 0xff;
    env.c = flipped.toString("base64");
    expect(() => decryptWithKey(JSON.stringify(env), KEY)).toThrow();
  });

  it("fails when the auth tag is altered", () => {
    const env = JSON.parse(encryptWithKey("secret", KEY)) as Envelope;
    const flipped = Buffer.from(env.t, "base64");
    flipped[0] ^= 0xff;
    env.t = flipped.toString("base64");
    expect(() => decryptWithKey(JSON.stringify(env), KEY)).toThrow();
  });

  it("fails when decrypted with a different key", () => {
    const other = resolveKey("f".repeat(64));
    expect(() => decryptWithKey(encryptWithKey("secret", KEY), other)).toThrow();
  });

  it("rejects an unsupported envelope version", () => {
    const env = JSON.parse(encryptWithKey("secret", KEY)) as Envelope;
    env.v = 99;
    expect(() => decryptWithKey(JSON.stringify(env), KEY)).toThrow(/version/);
  });

  it("rejects non-JSON input", () => {
    expect(() => decryptWithKey("not-json", KEY)).toThrow(/JSON/);
  });
});
