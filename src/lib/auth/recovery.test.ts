import { describe, expect, it } from "vitest";

import { resolveKey } from "@/lib/crypto/envelope";

import {
  RecoverySessionError,
  sealRecoverySession,
  updatePasswordInputFromFormData,
  verifyRecoverySession,
} from "./recovery";

const key = resolveKey("0123456789abcdef0123456789abcdef");

describe("recovery session", () => {
  it("accepts the sealed marker only for the matching user before expiry", () => {
    const sealed = sealRecoverySession({ userId: "user-1", issuedAt: 1_000 }, key);

    expect(() =>
      verifyRecoverySession(sealed, key, { userId: "user-1", now: 901_000 }),
    ).not.toThrow();
  });

  it.each([
    [undefined, "user-1", 2_000],
    [sealRecoverySession({ userId: "user-1", issuedAt: 1_000 }, key), "user-2", 2_000],
    [sealRecoverySession({ userId: "user-1", issuedAt: 1_000 }, key), "user-1", 901_001],
    ["tampered", "user-1", 2_000],
  ])("rejects a missing, mismatched, expired, or tampered marker", (sealed, userId, now) => {
    expect(() => verifyRecoverySession(sealed, key, { userId, now })).toThrow(
      RecoverySessionError,
    );
  });
});

describe("updatePasswordInputFromFormData", () => {
  it("rejects weak, mismatched, and over-72-byte passwords", () => {
    const mismatch = new FormData();
    mismatch.set("password", "safe-password-123");
    mismatch.set("password_confirmation", "different-value");
    const tooManyBytes = new FormData();
    tooManyBytes.set("password", "あ".repeat(25));
    tooManyBytes.set("password_confirmation", "あ".repeat(25));

    expect(updatePasswordInputFromFormData(mismatch).error?.flatten().fieldErrors)
      .toHaveProperty("password_confirmation");
    expect(
      updatePasswordInputFromFormData(tooManyBytes).error?.flatten().fieldErrors.password,
    ).toContain("パスワードはUTF-8で72バイト以内にしてください。");
  });
});
