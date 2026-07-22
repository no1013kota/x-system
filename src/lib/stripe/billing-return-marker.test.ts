import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  BILLING_RETURN_MAX_AGE_SEC,
  billingReturnCookieHeader,
  clearBillingReturnCookieHeader,
  openBillingReturnMarker,
  sealBillingReturnMarker,
} from "./billing-return-marker";

describe("billing return marker", () => {
  const key = randomBytes(32);

  it("round-trips a short-lived source/user marker", () => {
    const marker = { issuedAt: 1_000, source: "portal" as const, userId: "u1" };
    expect(
      openBillingReturnMarker(
        sealBillingReturnMarker(marker, key),
        key,
        1_000 + BILLING_RETURN_MAX_AGE_SEC,
      ),
    ).toEqual(marker);
  });

  it("rejects expired and tampered markers", () => {
    const sealed = sealBillingReturnMarker(
      { issuedAt: 1_000, source: "checkout", userId: "u1" },
      key,
    );
    expect(() =>
      openBillingReturnMarker(
        sealed,
        key,
        1_001 + BILLING_RETURN_MAX_AGE_SEC,
      ),
    ).toThrow();
    expect(() =>
      openBillingReturnMarker(`${sealed.slice(0, -2)}xx`, key, 1_001),
    ).toThrow();
  });

  it("uses HttpOnly, SameSite=Lax, short TTL, and explicit deletion", () => {
    expect(billingReturnCookieHeader("sealed", true)).toContain(
      "HttpOnly; SameSite=Lax; Max-Age=1800; Secure",
    );
    expect(clearBillingReturnCookieHeader(false)).toContain("Max-Age=0");
  });
});
