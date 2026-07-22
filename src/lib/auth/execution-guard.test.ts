import { describe, expect, it } from "vitest";

import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
} from "@/lib/legal";
import { AppError } from "@/lib/observability/errors";

import { requireExecutionAccess } from "./execution-guard";
import { routeGuardDestination } from "./route-guard";

describe("common execution guard", () => {
  it("allows current legal versions on an executable subscription", () => {
    expect(() =>
      requireExecutionAccess({
        privacyVersion: CURRENT_PRIVACY_VERSION,
        subscriptionStatus: "active",
        termsVersion: CURRENT_TERMS_VERSION,
      }),
    ).not.toThrow();
  });

  it("keeps old-version data browsable but requires re-consent before execution", () => {
    expect(
      routeGuardDestination({
        profile: { plan: "standard", subscription_status: "active" },
        url: new URL("https://app.example.com/app/posts?tab=history"),
        userId: "user-1",
      }),
    ).toBeNull();

    let error: unknown;
    try {
      requireExecutionAccess({
        privacyVersion: CURRENT_PRIVACY_VERSION,
        subscriptionStatus: "active",
        termsVersion: "older-version",
      });
    } catch (cause) {
      error = cause;
    }
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      code: "legal_consent_required",
      details: {
        missing: ["terms_consent"],
        settingsPath: "/app/consent",
      },
    });
  });

  it("applies subscription failure before legal consent", () => {
    expect(() =>
      requireExecutionAccess({
        privacyVersion: "old",
        subscriptionStatus: "past_due",
        termsVersion: "old",
      }),
    ).toThrow(expect.objectContaining({ code: "subscription_required" }));
  });
});
