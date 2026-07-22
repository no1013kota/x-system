import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

import {
  prepareStripeEvent,
  subscriptionProjection,
} from "./subscription-sync";

const priceIds = {
  standard: "price_standard",
  md: "price_md",
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
          price: { id: "price_md" },
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

describe("Stripe subscription synchronization", () => {
  it.each([
    ["checkout.session.completed", { id: "cs_001", subscription: "sub_checkout" }, "sub_checkout"],
    ["customer.subscription.created", { id: "sub_created" }, "sub_created"],
    ["customer.subscription.updated", { id: "sub_updated" }, "sub_updated"],
  ] as const)("retrieves current state for %s", async (type, object, expectedId) => {
    const retrieve = vi.fn(async () => subscription());
    const prepared = await prepareStripeEvent(
      event(type, object),
      { subscriptions: { retrieve } },
      priceIds,
    );

    expect(retrieve).toHaveBeenCalledWith(expectedId);
    expect(prepared).toMatchObject({
      kind: "subscription_sync",
      projection: {
        plan: "md",
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
      { subscriptions: { retrieve } },
      priceIds,
    );

    expect(retrieve).not.toHaveBeenCalled();
    expect(prepared).toMatchObject({
      kind: "subscription_sync",
      projection: { subscriptionId: "sub_deleted", status: "canceled" },
    });
  });

  it("maps current-period end from the single subscription item", () => {
    const projection = subscriptionProjection(
      event("customer.subscription.updated", { id: "sub_current" }),
      subscription({ status: "active", trial_end: null, trial_start: null }),
      priceIds,
    );
    expect(projection).toMatchObject({
      plan: "md",
      status: "active",
      currentPeriodEnd: 1_785_279_600,
      trialEnd: null,
      trialStartedAt: null,
    });
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
              { current_period_end: 1_785_279_600, price: { id: "price_md" } },
              { current_period_end: 1_785_279_600, price: { id: "price_md" } },
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
