import { describe, expect, it } from "vitest";

import { AppError } from "@/lib/observability/errors";

import {
  SUBSCRIPTION_ACCESS,
  requireExecutableSubscription,
  subscriptionBannerFor,
} from "./subscription-access";

describe("subscription access matrix", () => {
  it.each([
    ["incomplete", "settings_plans", false, "checkout", "/plans"],
    ["incomplete_expired", "settings_plans", false, "checkout", "/plans"],
    ["trialing", "app", true, "none", "/app/settings?tab=billing"],
    ["active", "app", true, "none", null],
    ["past_due", "app", false, "portal", "/app/settings?tab=billing"],
    ["paused", "app", false, "portal", "/app/settings?tab=billing"],
    ["canceled", "app", false, "checkout", "/plans"],
    ["unpaid", "app", false, "portal", "/app/settings?tab=billing"],
  ] as const)(
    "%s maps browsing, execution, and primary action",
    (status, viewScope, canExecute, action, actionPath) => {
      expect(SUBSCRIPTION_ACCESS[status]).toEqual({
        action,
        actionPath,
        canBrowseApp: viewScope === "app",
        canExecute,
        viewScope,
      });
    },
  );

  it.each(["trialing", "active"])("allows execution for %s", (status) => {
    expect(() => requireExecutableSubscription(status)).not.toThrow();
  });

  it.each([
    ["past_due", "/app/settings?tab=billing"],
    ["unpaid", "/app/settings?tab=billing"],
    ["paused", "/app/settings?tab=billing"],
    ["canceled", "/plans"],
  ])("blocks execution for %s with a resolution path", (status, settingsPath) => {
    let error: unknown;
    try {
      requireExecutableSubscription(status);
    } catch (cause) {
      error = cause;
    }
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      code: "subscription_required",
      details: {
        missing: ["subscription"],
        settingsPath,
        subscriptionStatus: status,
      },
    });
  });
});

describe("subscription banner", () => {
  it("shows the JST trial end and no payment action", () => {
    expect(
      subscriptionBannerFor({
        stripeCustomerId: "cus_1",
        subscriptionStatus: "trialing",
        trialEndsAt: "2026-07-29T15:00:00.000Z",
      }),
    ).toEqual({
      action: null,
      description: "無料トライアルは2026年7月30日までです。",
      title: "無料トライアル中",
      tone: "info",
    });
  });

  it.each(["past_due", "unpaid", "paused"])(
    "shows a persistent Portal action for %s independently of notification config",
    (subscriptionStatus) => {
      expect(
        subscriptionBannerFor({
          stripeCustomerId: "cus_1",
          subscriptionStatus,
          trialEndsAt: null,
        }),
      ).toMatchObject({ action: "portal", tone: "warning" });
    },
  );

  it("uses Checkout for canceled subscriptions and no banner for active", () => {
    expect(
      subscriptionBannerFor({
        stripeCustomerId: "cus_1",
        subscriptionStatus: "canceled",
        trialEndsAt: null,
      }),
    ).toMatchObject({ action: "checkout", tone: "warning" });
    expect(
      subscriptionBannerFor({
        stripeCustomerId: "cus_1",
        subscriptionStatus: "active",
        trialEndsAt: null,
      }),
    ).toBeNull();
  });
});
