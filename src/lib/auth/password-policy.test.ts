import { describe, expect, it } from "vitest";

import {
  PASSWORD_MAX_BYTES,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  checkPassword,
  isPasswordValid,
} from "./password-policy";

describe("password policy", () => {
  it("uses an 8-character minimum", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
  });

  it("accepts a password at the 8-character minimum", () => {
    expect(checkPassword("a".repeat(8))).toMatchObject({
      minLength: true,
      maxLength: true,
      withinBytes: true,
    });
    expect(isPasswordValid("a".repeat(8))).toBe(true);
  });

  it("rejects a password shorter than the minimum", () => {
    expect(checkPassword("a".repeat(7)).minLength).toBe(false);
    expect(isPasswordValid("a".repeat(7))).toBe(false);
  });

  it("rejects a password longer than the maximum", () => {
    expect(checkPassword("a".repeat(PASSWORD_MAX_LENGTH + 1)).maxLength).toBe(
      false,
    );
  });

  it("counts characters, not bytes, for the length rule", () => {
    // 8 multibyte characters satisfy the character minimum...
    expect(checkPassword("あ".repeat(8)).minLength).toBe(true);
    // ...but 25 of them (75 bytes) exceed the bcrypt 72-byte cap.
    const overBytes = "あ".repeat(25);
    expect(new TextEncoder().encode(overBytes).byteLength).toBeGreaterThan(
      PASSWORD_MAX_BYTES,
    );
    expect(checkPassword(overBytes).withinBytes).toBe(false);
    expect(isPasswordValid(overBytes)).toBe(false);
  });
});
