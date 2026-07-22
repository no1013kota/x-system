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
      md: "price_md",
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
});
