import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  reconcileBillingReturn,
  type BillingReturnDependencies,
} from "./billing-return";

const USER_ID = "018f89d5-71bb-7fd1-8710-2c4bd05aa680";
const STARTED_AT = 1_784_675_200;

function subscription(): Stripe.Subscription {
  return {
    id: "sub_current",
    customer: "cus_current",
    status: "active",
    cancel_at_period_end: false,
    trial_end: null,
    trial_start: null,
    livemode: false,
    metadata: { user_id: USER_ID },
    items: {
      data: [
        {
          current_period_end: STARTED_AT + 86_400,
          current_period_start: STARTED_AT - 86_400,
          price: { id: "price_standard" },
        } as Stripe.SubscriptionItem,
      ],
    },
  } as unknown as Stripe.Subscription;
}

function dependencies(): BillingReturnDependencies {
  return {
    applyProjection: vi.fn(async () => "updated" as const),
    getProfile: vi.fn(async () => ({
      stripe_customer_id: "cus_current",
      stripe_subscription_id: "sub_current",
      subscription_event_created_at: null,
    })),
    now: () => STARTED_AT + 60,
    priceIds: {
      standard: "price_standard",
      expert: "price_expert",
      premium: "price_premium",
    },
    stripe: {
      checkout: {
        sessions: {
          retrieve: vi.fn(async () => ({
            client_reference_id: USER_ID,
            customer: "cus_current",
            subscription: "sub_current",
          }) as Stripe.Checkout.Session),
        },
      },
      subscriptions: {
        retrieve: vi.fn(async () => subscription()),
      },
    },
  };
}

describe("billing return reconciliation", () => {
  let deps: BillingReturnDependencies;

  beforeEach(() => {
    deps = dependencies();
  });

  it.each([
    ["checkout", "cs_test_123"],
    ["portal", null],
  ] as const)("retrieves the current subscription once for an unreflected %s return", async (source, sessionId) => {
    await expect(
      reconcileBillingReturn(
        {
          marker: { issuedAt: STARTED_AT, source, userId: USER_ID },
          sessionId,
          source,
          userId: USER_ID,
        },
        deps,
      ),
    ).resolves.toBe("updated");
    expect(deps.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(1);
    expect(deps.applyProjection).toHaveBeenCalledTimes(1);
    expect(deps.applyProjection).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: "cus_current",
        eventCreated: STARTED_AT + 60,
        subscriptionId: "sub_current",
      }),
    );
  });

  it.each(["checkout", "portal"] as const)("does not call Stripe when %s was already reflected", async (source) => {
    deps.getProfile = vi.fn(async () => ({
      stripe_customer_id: "cus_current",
      stripe_subscription_id: "sub_current",
      subscription_event_created_at: new Date(STARTED_AT * 1000).toISOString(),
    }));
    await expect(
      reconcileBillingReturn(
        {
          marker: { issuedAt: STARTED_AT, source, userId: USER_ID },
          sessionId: source === "checkout" ? "cs_test_123" : null,
          source,
          userId: USER_ID,
        },
        deps,
      ),
    ).resolves.toBe("current");
    expect(deps.stripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
    expect(deps.stripe.subscriptions.retrieve).not.toHaveBeenCalled();
  });

  it("does not call Stripe on a normal display without a valid return marker", async () => {
    await expect(
      reconcileBillingReturn(
        { marker: null, source: "portal", userId: USER_ID },
        deps,
      ),
    ).resolves.toBe("skipped");
    expect(deps.getProfile).not.toHaveBeenCalled();
    expect(deps.stripe.subscriptions.retrieve).not.toHaveBeenCalled();
  });

  it("rejects a Checkout Session belonging to a different user", async () => {
    deps.stripe.checkout.sessions.retrieve = vi.fn(async () => ({
      client_reference_id: "different-user",
      customer: "cus_current",
      subscription: "sub_current",
    }) as Stripe.Checkout.Session);
    await expect(
      reconcileBillingReturn(
        {
          marker: { issuedAt: STARTED_AT, source: "checkout", userId: USER_ID },
          sessionId: "cs_test_123",
          source: "checkout",
          userId: USER_ID,
        },
        deps,
      ),
    ).resolves.toBe("skipped");
    expect(deps.stripe.subscriptions.retrieve).not.toHaveBeenCalled();
  });

  /**
   * Portal で下位変更を予約した直後の戻りは本物の webhook より先に着く。ここで schedule を読まないと
   * 予約を null で書き、後続の webhook が stale 扱いになって予約が画面に出ない（レビュー指摘・T-M8-260）。
   */
  it("reads the subscription schedule on a portal return so the reservation is not overwritten", async () => {
    const withSchedule = { ...subscription(), schedule: "sub_sched_1" } as Stripe.Subscription;
    deps.stripe.subscriptions.retrieve = vi.fn(async () => withSchedule);
    deps.stripe.subscriptionSchedules = {
      retrieve: vi.fn(async () =>
        ({
          id: "sub_sched_1",
          status: "active",
          phases: [
            { start_date: STARTED_AT - 86_400, end_date: STARTED_AT + 86_400, items: [{ price: "price_standard" }] },
            { start_date: STARTED_AT + 86_400, end_date: STARTED_AT + 86_401, items: [{ price: "price_premium" }] },
          ],
        }) as unknown as Stripe.SubscriptionSchedule,
      ),
    };
    await reconcileBillingReturn(
      { marker: { issuedAt: STARTED_AT, source: "portal", userId: USER_ID }, sessionId: null, source: "portal", userId: USER_ID },
      deps,
    );
    const applied = vi.mocked(deps.applyProjection).mock.calls[0][0];
    expect(applied.scheduledPlan).toBe("premium");
    expect(applied.scheduledPlanAt).toBe(STARTED_AT + 86_400);
    expect(applied.scheduleUnavailable).toBe(false);

    // gateway が schedule を読めない形なら「読めなかった」として保存済みの予約を守る。
    delete deps.stripe.subscriptionSchedules;
    await reconcileBillingReturn(
      { marker: { issuedAt: STARTED_AT, source: "portal", userId: USER_ID }, sessionId: null, source: "portal", userId: USER_ID },
      deps,
    );
    expect(vi.mocked(deps.applyProjection).mock.calls[1][0].scheduleUnavailable).toBe(true);
  });

  /**
   * 解約導線で引き止めの半額クーポンを受け取った直後の戻りも、本物の webhook より先に着く
   * （T-M8-286・運営者の報告 2026-08-24）。schedule と同じ理由で discount も読まないと
   * null で上書きし、後続の webhook は `created` が古いため stale 扱いになって、
   * 「半額適用中」の表示（T-M8-279）が**一度も出ないまま**になる。実際にそうなっていた。
   */
  it("reads the applied discount on a portal return so the retention coupon is not overwritten", async () => {
    /*
      `discounts` は expand したうえで **`source.coupon` にクーポンIDの文字列**が入る形
      （2026-08-24 に実データで確認。`discount.coupon` は返らない）。
    */
    const withDiscount = {
      ...subscription(),
      discounts: [
        { id: "di_1", source: { type: "coupon", coupon: "half_off" }, end: STARTED_AT + 7_776_000 },
      ],
    } as unknown as Stripe.Subscription;
    deps.stripe.subscriptions.retrieve = vi.fn(async () => withDiscount);
    deps.stripe.coupons = {
      retrieve: vi.fn(async () => ({ id: "half_off", percent_off: 50 }) as unknown as Stripe.Coupon),
    };

    await reconcileBillingReturn(
      { marker: { issuedAt: STARTED_AT, source: "portal", userId: USER_ID }, sessionId: null, source: "portal", userId: USER_ID },
      deps,
    );
    const applied = vi.mocked(deps.applyProjection).mock.calls[0][0];
    expect(applied.discount, "戻りの同期で割引が消えている").toEqual({
      percentOff: 50,
      amountOffJpy: null,
      endsAt: STARTED_AT + 7_776_000,
    });
    // expand を落とすと discounts がIDだけになり割引率を読めない。retrieve の呼び方も固定する。
    expect(deps.stripe.subscriptions.retrieve).toHaveBeenCalledWith("sub_current", {
      expand: ["discounts"],
    });
  });
});
