import { describe, expect, it } from "vitest";

import {
  confirmationSuccessPath,
  parseConfirmationType,
  safeAuthNext,
} from "./confirm";

const BASE_URL = "https://app.example.com";

describe("auth confirmation routing", () => {
  it("accepts only supported OTP types", () => {
    expect(parseConfirmationType("signup")).toBe("signup");
    expect(parseConfirmationType("recovery")).toBe("recovery");
    expect(parseConfirmationType("email")).toBeNull();
    expect(parseConfirmationType(null)).toBeNull();
  });

  it.each([
    ["/plans", "/plans"],
    ["/reset-password", "/reset-password"],
    ["/app", "/app"],
    ["/app/posts?tab=drafts", "/app/posts?tab=drafts"],
  ])("allows known internal destinations: %s", (value, expected) => {
    expect(safeAuthNext(value, BASE_URL)).toBe(expected);
  });

  it.each([
    "https://evil.example/path",
    "//evil.example/path",
    "\\evil.example/path",
    "/signup",
    "/login",
    "/auth/confirm",
  ])("rejects an unsafe or unapproved destination: %s", (value) => {
    expect(safeAuthNext(value, BASE_URL)).toBeNull();
  });

  it("removes auth secrets and fragments from an accepted next value", () => {
    expect(
      safeAuthNext(
        "/app/posts?tab=drafts&token_hash=secret&type=signup&next=%2Fapp#token",
        BASE_URL,
      ),
    ).toBe("/app/posts?tab=drafts");
  });

  it("uses type-specific defaults when next is absent or rejected", () => {
    expect(confirmationSuccessPath("signup", null, BASE_URL)).toBe("/plans");
    expect(
      confirmationSuccessPath("recovery", "https://evil.example", BASE_URL),
    ).toBe("/reset-password");
  });
});
