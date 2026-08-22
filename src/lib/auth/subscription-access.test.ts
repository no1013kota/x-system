import { describe, expect, it } from "vitest";

import { AppError } from "@/lib/observability/errors";

import { SUBSCRIPTION_ACCESS, canBrowseApp, isSubscriptionPeriodStale, requireExecutableSubscription, subscriptionBannerFor } from "./subscription-access";

describe("subscription access matrix", () => {
  it.each([
    ["incomplete", "settings_plans", false, "/plans"],
    ["incomplete_expired", "settings_plans", false, "/plans"],
    ["trialing", "app", true, "/app/settings?tab=billing"],
    ["active", "app", true, null],
    ["past_due", "app", false, "/app/settings?tab=billing"],
    ["paused", "app", false, "/app/settings?tab=billing"],
    ["canceled", "app", false, "/plans"],
    ["unpaid", "app", false, "/app/settings?tab=billing"],
  ] as const)(
    "%s maps browsing, execution, and primary action",
    (status, viewScope, canExecute, actionPath) => {
      expect(SUBSCRIPTION_ACCESS[status]).toEqual({
        actionPath,
        canExecute,
        viewScope,
      });
    },
  );

  it.each([
    ["trialing", true],
    ["active", true],
    ["past_due", true],
    ["canceled", true],
    ["incomplete", false],
    ["incomplete_expired", false],
    ["unknown-status", false],
  ] as const)("canBrowseApp(%s) = %s", (status, expected) => {
    expect(canBrowseApp(status)).toBe(expected);
  });

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

describe("isSubscriptionPeriodStale（契約の反映が届いていない疑い・T-M8-235）", () => {
  const now = new Date("2026-08-23T00:00:00Z");
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();

  it("trialing はトライアル期限＋猶予24時間を過ぎたら stale", () => {
    expect(isSubscriptionPeriodStale("trialing", { trialEndsAt: hoursAgo(25) }, now)).toBe(true);
    expect(isSubscriptionPeriodStale("trialing", { trialEndsAt: hoursAgo(23) }, now)).toBe(false);
  });

  it("active は current_period_end を見る（更新直後に締め出さないための猶予つき）", () => {
    expect(isSubscriptionPeriodStale("active", { currentPeriodEnd: hoursAgo(25) }, now)).toBe(true);
    expect(isSubscriptionPeriodStale("active", { currentPeriodEnd: hoursAgo(1) }, now)).toBe(false);
  });

  /** 分からないことを理由に締め出さない（止めるのは「期限切れだと分かっている」ときだけ）。 */
  it("期限が無い・壊れている・別statusのときは止めない", () => {
    expect(isSubscriptionPeriodStale("trialing", {}, now)).toBe(false);
    expect(isSubscriptionPeriodStale("trialing", { trialEndsAt: null }, now)).toBe(false);
    expect(isSubscriptionPeriodStale("active", { currentPeriodEnd: "not-a-date" }, now)).toBe(false);
    // trialing は trial_ends_at だけを見る（期間末が過去でもトライアル中なら止めない）。
    expect(
      isSubscriptionPeriodStale("trialing", { currentPeriodEnd: hoursAgo(99) }, now),
    ).toBe(false);
    // 実行できない status（past_due 等）は別の経路で止まる。ここでは false。
    expect(isSubscriptionPeriodStale("past_due", { currentPeriodEnd: hoursAgo(99) }, now)).toBe(false);
  });
});
