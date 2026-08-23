import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

import {
  prepareStripeEvent,
  subscriptionProjection,
} from "./subscription-sync";

const priceIds = {
  standard: "price_standard",
  expert: "price_expert",
  premium: "price_premium",
} as const;

function subscription(
  overrides: Partial<Stripe.Subscription> = {},
): Stripe.Subscription {
  return {
    id: "sub_current",
    object: "subscription",
    cancel_at_period_end: false,
    customer: "cus_001",
    items: {
      object: "list",
      data: [
        {
          current_period_end: 1_785_279_600,
          current_period_start: 1_784_674_800,
          price: { id: "price_expert" },
        } as Stripe.SubscriptionItem,
      ],
      has_more: false,
      url: "/v1/subscription_items",
    },
    metadata: { user_id: "11111111-1111-4111-8111-111111111111" },
    status: "trialing",
    trial_end: 1_785_279_600,
    trial_start: 1_784_674_800,
    ...overrides,
  } as Stripe.Subscription;
}

function event(
  type: string,
  object: Record<string, unknown>,
  created = 1_784_675_200,
): Stripe.Event {
  return {
    id: `evt_${type}`,
    type,
    created,
    data: { object },
  } as unknown as Stripe.Event;
}

/** テスト用gateway。invoicePaymentsは呼ばれないテストでは空の実装でよい。 */
function gateway(
  retrieve: (id: string) => Promise<Stripe.Subscription>,
  invoicePaymentsList?: (params: unknown) => Promise<{ data: { invoice: string | { id: string } | null }[] }>,
) {
  return {
    subscriptions: { retrieve },
    invoicePayments: {
      list:
        invoicePaymentsList ??
        (async () => {
          throw new Error("invoicePayments.list should not be called in this test");
        }),
    },
  };
}

describe("Stripe subscription synchronization", () => {
  /**
   * charge.refunded のinvoice解決（T-M8-174レビュー修正）。
   * **現行API（2026-06-24.dahlia）のChargeにはinvoiceフィールドが無い**（basilで削除）ため、
   * payment_intent → InvoicePayments で解決する。preparedを直接注入するdbテストでは
   * この層を素通りするので、ここで prepareStripeEvent を実際に通す。
   */
  it("charge.refunded: payment_intentからInvoicePayments経由でinvoiceを解決する", async () => {
    const list = vi.fn(async () => ({ data: [{ invoice: "in_resolved" }] }));
    const prepared = await prepareStripeEvent(
      event("charge.refunded", {
        id: "ch_1",
        payment_intent: "pi_1",
        amount_refunded: 500,
        refunded: false,
      }),
      gateway(vi.fn(), list),
      priceIds,
    );
    expect(list).toHaveBeenCalledWith({
      payment: { type: "payment_intent", payment_intent: "pi_1" },
      limit: 1,
    });
    expect(prepared).toEqual({
      kind: "charge_refund",
      stripeInvoiceId: "in_resolved",
      amountRefunded: 500,
      fullyRefunded: false,
    });
  });

  it("charge.refunded: 旧API形状（charge.invoiceあり）はそのまま使い、解決不能はnull", async () => {
    const legacy = await prepareStripeEvent(
      event("charge.refunded", { id: "ch_2", invoice: "in_legacy", refunded: true, amount_refunded: 3980 }),
      gateway(vi.fn()),
      priceIds,
    );
    expect(legacy).toMatchObject({ kind: "charge_refund", stripeInvoiceId: "in_legacy", fullyRefunded: true });

    const none = await prepareStripeEvent(
      event("charge.refunded", { id: "ch_3", payment_intent: null, refunded: true, amount_refunded: 100 }),
      gateway(vi.fn(), async () => ({ data: [] })),
      priceIds,
    );
    expect(none).toMatchObject({ kind: "charge_refund", stripeInvoiceId: null });
  });

  it.each([
    ["checkout.session.completed", { id: "cs_001", subscription: "sub_checkout" }, "sub_checkout"],
    ["customer.subscription.created", { id: "sub_created" }, "sub_created"],
    ["customer.subscription.updated", { id: "sub_updated" }, "sub_updated"],
  ] as const)("retrieves current state for %s", async (type, object, expectedId) => {
    const retrieve = vi.fn(async () => subscription());
    const prepared = await prepareStripeEvent(
      event(type, object),
      gateway(retrieve),
      priceIds,
    );

    expect(retrieve).toHaveBeenCalledWith(expectedId);
    expect(prepared).toMatchObject({
      kind: "subscription_sync",
      projection: {
        plan: "expert",
        status: "trialing",
        currentPeriodEnd: 1_785_279_600,
        trialStartedAt: 1_784_674_800,
      },
    });
  });

  it("uses the deleted event final object and forces canceled without retrieving", async () => {
    const retrieve = vi.fn(async () => subscription());
    const deleted = subscription({ id: "sub_deleted", status: "active" });
    const prepared = await prepareStripeEvent(
      event("customer.subscription.deleted", deleted as unknown as Record<string, unknown>),
      gateway(retrieve),
      priceIds,
    );

    expect(retrieve).not.toHaveBeenCalled();
    expect(prepared).toMatchObject({
      kind: "subscription_sync",
      projection: { subscriptionId: "sub_deleted", status: "canceled" },
    });
  });

  it.each([
    ["invoice.payment_failed", "failed"],
    ["invoice.paid", "paid"],
  ] as const)("retrieves current subscription state for %s", async (type, paymentState) => {
    const retrieve = vi.fn(async () => subscription({ status: "active" }));
    const invoice = {
      id: "in_001",
      attempt_count: 2,
      parent: {
        type: "subscription_details",
        quote_details: null,
        subscription_details: {
          metadata: null,
          subscription: "sub_invoice",
        },
      },
    } as Stripe.Invoice;
    const prepared = await prepareStripeEvent(
      event(type, invoice as unknown as Record<string, unknown>),
      gateway(retrieve),
      priceIds,
    );

    expect(retrieve).toHaveBeenCalledWith("sub_invoice");
    expect(prepared).toMatchObject({
      kind: "invoice_sync",
      invoice: { id: "in_001", attemptCount: 2, paymentState },
      projection: { status: "active" },
    });
  });

  it("records a one-off invoice without trying to synchronize a subscription", async () => {
    const retrieve = vi.fn(async () => subscription());
    const prepared = await prepareStripeEvent(
      event("invoice.paid", {
        id: "in_one_off",
        attempt_count: 1,
        parent: null,
      }),
      gateway(retrieve),
      priceIds,
    );
    expect(prepared).toEqual({ kind: "none" });
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("maps current-period end from the single subscription item", () => {
    const projection = subscriptionProjection(
      event("customer.subscription.updated", { id: "sub_current" }),
      subscription({ status: "active", trial_end: null, trial_start: null }),
      priceIds,
    );
    expect(projection).toMatchObject({
      plan: "expert",
      status: "active",
      currentPeriodEnd: 1_785_279_600,
      trialEnd: null,
      trialStartedAt: null,
    });
  });

  /**
   * トライアル中の解約は `cancel_at_period_end: true` ではなく **`cancel_at` だけ**が設定される
   * （T-M8-57・実測）。booleanしか読まないと、Portalで解約しても profile は「解約予定なし」の
   * ままになり、画面に何も出ない。
   */
  it("cancel_at が設定されていれば解約予定として扱う（トライアル中の解約）", () => {
    const sub = subscription({ cancel_at: 1_785_279_600, cancel_at_period_end: false });
    const projection = subscriptionProjection(
      event("customer.subscription.updated", sub as unknown as Record<string, unknown>),
      sub,
      priceIds,
    );
    expect(projection.cancelAtPeriodEnd).toBe(true);
  });

  it("cancel_at_period_end だけの解約予定も従来どおり扱う", () => {
    const sub = subscription({ cancel_at_period_end: true });
    const projection = subscriptionProjection(
      event("customer.subscription.updated", sub as unknown as Record<string, unknown>),
      sub,
      priceIds,
    );
    expect(projection.cancelAtPeriodEnd).toBe(true);
  });

  it("どちらも無ければ解約予定なし", () => {
    const sub = subscription();
    const projection = subscriptionProjection(
      event("customer.subscription.updated", sub as unknown as Record<string, unknown>),
      sub,
      priceIds,
    );
    expect(projection.cancelAtPeriodEnd).toBe(false);
  });

  it("rejects unknown and multiple Prices", () => {
    expect(() =>
      subscriptionProjection(
        event("customer.subscription.updated", { id: "sub_current" }),
        subscription({
          items: {
            object: "list",
            data: [
              { current_period_end: 1_785_279_600, price: { id: "price_unknown" } },
            ] as Stripe.SubscriptionItem[],
            has_more: false,
            url: "/v1/subscription_items",
          },
        }),
        priceIds,
      ),
    ).toThrow("unknown Price ID");

    expect(() =>
      subscriptionProjection(
        event("customer.subscription.updated", { id: "sub_current" }),
        subscription({
          items: {
            object: "list",
            data: [
              { current_period_end: 1_785_279_600, price: { id: "price_expert" } },
              { current_period_end: 1_785_279_600, price: { id: "price_expert" } },
            ] as Stripe.SubscriptionItem[],
            has_more: false,
            url: "/v1/subscription_items",
          },
        }),
        priceIds,
      ),
    ).toThrow("unknown Price ID");
  });
});

/**
 * 予約済みの下位変更（subscription schedule・T-M8-260）。
 * Portalの期間末予約は契約本体のPriceを変えず schedule を付けるだけなので、
 * 予約先と切替日は schedule の「次のフェーズ」から読む。
 */
describe("scheduled plan change (subscription schedule)", () => {
  const NOW = 1_784_675_200;
  function schedule(overrides: Partial<Stripe.SubscriptionSchedule> = {}): Stripe.SubscriptionSchedule {
    return {
      id: "sub_sched_1",
      object: "subscription_schedule",
      status: "active",
      phases: [
        { start_date: NOW - 100_000, end_date: 1_785_279_600, items: [{ price: "price_expert" }] },
        { start_date: 1_785_279_600, end_date: 1_787_958_000, items: [{ price: "price_standard" }] },
      ],
      ...overrides,
    } as unknown as Stripe.SubscriptionSchedule;
  }

  it("次のフェーズのPriceが違えば、予約先プランと切替日を投影へ載せる", () => {
    const projection = subscriptionProjection(
      event("customer.subscription.updated", {}, NOW),
      subscription({ status: "active" }),
      priceIds,
      false,
      schedule(),
    );
    expect(projection.scheduledPlan).toBe("standard");
    expect(projection.scheduledPlanAt).toBe(1_785_279_600);
  });

  it("schedule が無い・解除済み・次フェーズが同じPrice・未知のPrice なら予約なし", () => {
    const base = subscription({ status: "active" });
    const ev = event("customer.subscription.updated", {}, NOW);
    expect(subscriptionProjection(ev, base, priceIds, false, null).scheduledPlan).toBeNull();
    expect(
      subscriptionProjection(ev, base, priceIds, false, schedule({ status: "released" })).scheduledPlan,
    ).toBeNull();
    expect(
      subscriptionProjection(
        ev, base, priceIds, false,
        schedule({ phases: [{ start_date: NOW - 1, end_date: NOW + 1, items: [{ price: "price_expert" }] },
                            { start_date: NOW + 1, end_date: NOW + 2, items: [{ price: "price_expert" }] }] } as never),
      ).scheduledPlan,
    ).toBeNull();
    expect(
      subscriptionProjection(
        ev, base, priceIds, false,
        schedule({ phases: [{ start_date: NOW + 1, end_date: NOW + 2, items: [{ price: "price_unknown" }] }] } as never),
      ).scheduledPlan,
    ).toBeNull();
  });

  it("解約（deleted）では予約を持たない", () => {
    const projection = subscriptionProjection(
      event("customer.subscription.deleted", {}, NOW),
      subscription({ status: "active" }),
      priceIds,
      true,
      schedule(),
    );
    expect(projection.scheduledPlan).toBeNull();
  });

  it("prepareStripeEvent は契約に schedule が付いていれば取りに行き、失敗しても同期は続く", async () => {
    const withSchedule = subscription({ status: "active", schedule: "sub_sched_1" } as never);
    const ok = await prepareStripeEvent(
      event("customer.subscription.updated", { id: "sub_current" }, NOW),
      {
        ...gateway(async () => withSchedule),
        subscriptionSchedules: { retrieve: async () => schedule() },
      },
      priceIds,
    );
    expect(ok.kind).toBe("subscription_sync");
    if (ok.kind === "subscription_sync") expect(ok.projection.scheduledPlan).toBe("standard");

    const failing = await prepareStripeEvent(
      event("customer.subscription.updated", { id: "sub_current" }, NOW),
      {
        ...gateway(async () => withSchedule),
        subscriptionSchedules: {
          retrieve: async () => {
            throw new Error("stripe down");
          },
        },
      },
      priceIds,
    );
    if (failing.kind === "subscription_sync") {
      expect(failing.projection.plan, "契約本体の同期は止めない").toBe("expert");
      expect(failing.projection.scheduledPlan).toBeNull();
    }
  });
});
