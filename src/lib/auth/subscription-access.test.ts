import { describe, expect, it } from "vitest";

import { AppError } from "@/lib/observability/errors";

import {
  SUBSCRIPTION_ACCESS,
  canBrowseApp,
  canExecuteSubscription,
  requireExecutableSubscription,
  subscriptionBannerFor,
} from "./subscription-access";

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

/**
 * 「プランを選ぶ」の跳ね返りを防ぐ判定（T-M8-53）。
 *
 * 設定＞課金は `stripe_customer_id` の有無だけでボタンを切り替えていたため、**契約は有効なのに
 * 顧客が未紐づけ**のとき「プランを選ぶ」が出た。押すと `/plans` が契約済みを理由に `/app` へ
 * 送り返すので、ホームへ弾かれて何も起きない（Webhookの到着順で一時的に起こり得る）。
 */
describe("canExecuteSubscription", () => {
  it("trialing / active は実行できる（＝プラン選択へ送ってはいけない）", () => {
    expect(canExecuteSubscription("trialing")).toBe(true);
    expect(canExecuteSubscription("active")).toBe(true);
  });

  it("未契約・停止中は実行できない（プラン選択へ送ってよい）", () => {
    for (const status of ["incomplete", "canceled", "past_due", "unpaid", "paused"]) {
      expect(canExecuteSubscription(status), status).toBe(false);
    }
  });

  it("未知の値は実行できない扱いにする（黙って通さない）", () => {
    expect(canExecuteSubscription("something_new")).toBe(false);
  });
});
