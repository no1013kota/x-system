import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

import { applyTrialDowngradeNow } from "./trial-plan-change";

/**
 * 無料トライアル中の下位変更は即時（T-M8-299・運営者の指示 2026-08-25）。
 * Portal は値下げを期間末の予約にするが、1円も払っていないトライアルで期間末まで
 * 上位プランのまま待たせる理由がない（「下げたのに枠が上位のまま」に見える）。
 */
const PRICES = { standard: "price_standard", premium: "price_premium", expert: "price_expert" };
const NOW = 1_790_000_000;

function subscription(over: Partial<Stripe.Subscription> = {}): Stripe.Subscription {
  return {
    id: "sub_1",
    status: "trialing",
    schedule: "sub_sched_1",
    items: { data: [{ id: "si_1", price: { id: "price_expert" } }] },
    ...over,
  } as unknown as Stripe.Subscription;
}

function schedule(priceId: string, startsAt = NOW + 86_400): Stripe.SubscriptionSchedule {
  return {
    id: "sub_sched_1",
    status: "active",
    phases: [
      { start_date: NOW - 86_400, end_date: startsAt, items: [{ price: "price_expert" }] },
      { start_date: startsAt, end_date: startsAt + 1, items: [{ price: priceId }] },
    ],
  } as unknown as Stripe.SubscriptionSchedule;
}

function gateway() {
  return {
    subscriptions: {
      update: vi.fn(async () => subscription({ items: { data: [{ id: "si_1", price: { id: "price_standard" } }] } } as never)),
    },
    subscriptionSchedules: { release: vi.fn(async () => ({ id: "sub_sched_1", status: "released" })) },
  };
}

describe("applyTrialDowngradeNow", () => {
  it("トライアル中の予約は、解除してその場で価格を差し替える", async () => {
    const stripe = gateway();
    const result = await applyTrialDowngradeNow(stripe, subscription(), schedule("price_standard"), PRICES, NOW);

    expect(result.plan).toBe("standard");
    expect(result.subscription).not.toBeNull();
    // **解除が先**。予約が生きたまま価格を変えても、期間末に予約のフェーズへ戻される。
    expect(stripe.subscriptionSchedules.release).toHaveBeenCalledWith("sub_sched_1");
    expect(stripe.subscriptions.update).toHaveBeenCalledWith("sub_1", {
      items: [{ id: "si_1", price: "price_standard" }],
      // トライアル中なので日割りは発生しない。明示して疑いを残さない。
      proration_behavior: "none",
    });
    expect(stripe.subscriptionSchedules.release.mock.invocationCallOrder[0]).toBeLessThan(
      stripe.subscriptions.update.mock.invocationCallOrder[0],
    );
  });

  it("有料契約（trialing でない）には触らない——払った期間ぶんは使えるべき", async () => {
    const stripe = gateway();
    const result = await applyTrialDowngradeNow(
      stripe,
      subscription({ status: "active" }),
      schedule("price_standard"),
      PRICES,
      NOW,
    );
    expect(result).toEqual({ plan: null, subscription: null });
    expect(stripe.subscriptionSchedules.release).not.toHaveBeenCalled();
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it("予約が無ければ何もしない", async () => {
    const stripe = gateway();
    expect(await applyTrialDowngradeNow(stripe, subscription(), null, PRICES, NOW)).toEqual({
      plan: null,
      subscription: null,
    });
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it("予約先が今と同じプランなら何もしない", async () => {
    const stripe = gateway();
    expect(
      await applyTrialDowngradeNow(stripe, subscription(), schedule("price_expert"), PRICES, NOW),
    ).toEqual({ plan: null, subscription: null });
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it("Stripeが失敗しても呼び出し側を止めない（予約のまま残るだけ）", async () => {
    const stripe = gateway();
    stripe.subscriptions.update = vi.fn(async () => {
      throw new Error("stripe down");
    });
    expect(
      await applyTrialDowngradeNow(stripe, subscription(), schedule("price_standard"), PRICES, NOW),
    ).toEqual({ plan: null, subscription: null });
  });
});
