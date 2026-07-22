import type Stripe from "stripe";

import type { PlanId } from "@/lib/plans";

import {
  subscriptionProjection,
  type SubscriptionApplyResult,
  type SubscriptionProjection,
} from "./subscription-sync";
import type {
  BillingReturnMarker,
  BillingReturnSource,
} from "./billing-return-marker";

export interface BillingReturnProfile {
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_event_created_at: string | null;
}

export interface BillingReturnStripeGateway {
  checkout: {
    sessions: {
      retrieve(id: string): Promise<Stripe.Checkout.Session>;
    };
  };
  subscriptions: {
    retrieve(id: string): Promise<Stripe.Subscription>;
  };
}

export interface BillingReturnDependencies {
  applyProjection(projection: SubscriptionProjection): Promise<SubscriptionApplyResult>;
  getProfile(userId: string): Promise<BillingReturnProfile | null>;
  now(): number;
  priceIds: Record<PlanId, string>;
  stripe: BillingReturnStripeGateway;
}

export type BillingReturnResult = "current" | "skipped" | "stale" | "updated";

function idOf(value: string | { id: string } | null): string | null {
  return typeof value === "string" ? value : value?.id ?? null;
}

function syntheticEvent(
  subscription: Stripe.Subscription,
  created: number,
): Stripe.Event {
  return {
    id: `billing_return_${created}`,
    object: "event",
    api_version: null,
    created,
    data: { object: subscription, previous_attributes: undefined },
    livemode: subscription.livemode,
    pending_webhooks: 0,
    request: null,
    type: "customer.subscription.updated",
  } as Stripe.Event;
}

/**
 * Reconciles only a genuine, one-time billing return. A webhook event at or
 * after flow start proves the profile is already current, avoiding Stripe I/O.
 */
export async function reconcileBillingReturn(
  input: {
    marker: BillingReturnMarker | null;
    sessionId?: string | null;
    source: BillingReturnSource;
    userId: string;
  },
  deps: BillingReturnDependencies,
): Promise<BillingReturnResult> {
  if (
    !input.marker ||
    input.marker.userId !== input.userId ||
    input.marker.source !== input.source
  ) {
    return "skipped";
  }

  const profile = await deps.getProfile(input.userId);
  if (!profile) return "skipped";
  const reflectedAt = profile.subscription_event_created_at
    ? Math.floor(new Date(profile.subscription_event_created_at).getTime() / 1000)
    : null;
  if (reflectedAt !== null && reflectedAt >= input.marker.issuedAt) {
    return "current";
  }

  let subscriptionId = profile.stripe_subscription_id;
  if (input.source === "checkout") {
    if (!input.sessionId) return "skipped";
    const session = await deps.stripe.checkout.sessions.retrieve(input.sessionId);
    if (
      session.client_reference_id !== input.userId ||
      (profile.stripe_customer_id &&
        idOf(session.customer) !== profile.stripe_customer_id)
    ) {
      return "skipped";
    }
    subscriptionId = idOf(session.subscription);
  }
  if (!subscriptionId) return "skipped";

  const subscription = await deps.stripe.subscriptions.retrieve(subscriptionId);
  const created = deps.now();
  const projection = subscriptionProjection(
    syntheticEvent(subscription, created),
    subscription,
    deps.priceIds,
  );
  const result = await deps.applyProjection(projection);
  return result === "stale" ? "stale" : "updated";
}
