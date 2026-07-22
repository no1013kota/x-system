import type Stripe from "stripe";

import { DB_ENUMS } from "@/lib/db/enums";
import type { PlanId } from "@/lib/plans";

import {
  type StripeEventDatabase,
  UnknownStripePriceError,
} from "./webhook";

type SubscriptionStatus = (typeof DB_ENUMS.subscription_status)[number];

const SUBSCRIPTION_STATUSES = new Set<string>(DB_ENUMS.subscription_status);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface StripeSubscriptionGateway {
  subscriptions: {
    retrieve(id: string): Promise<Stripe.Subscription>;
  };
}

export interface SubscriptionProjection {
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: number;
  customerId: string;
  eventCreated: number;
  plan: PlanId;
  status: SubscriptionStatus;
  subscriptionId: string;
  trialEnd: number | null;
  trialStartedAt: number | null;
  userId: string | null;
}

export type PreparedStripeEvent =
  | { kind: "subscription_sync"; projection: SubscriptionProjection }
  | { kind: "none" };

export type SubscriptionApplyResult = "updated" | "stale" | "not_applicable";

export class StripeSubscriptionSyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StripeSubscriptionSyncError";
  }
}

function expandedId(value: { id: string } | string | null): string | null {
  if (typeof value === "string") return value;
  return value?.id ?? null;
}

function subscriptionIdFromEvent(event: Stripe.Event): string | null {
  const object = event.data.object as unknown as {
    id?: unknown;
    subscription?: unknown;
  };
  if (event.type === "checkout.session.completed") {
    if (typeof object.subscription === "string") return object.subscription;
    if (
      object.subscription &&
      typeof object.subscription === "object" &&
      "id" in object.subscription &&
      typeof (object.subscription as { id?: unknown }).id === "string"
    ) {
      return (object.subscription as { id: string }).id;
    }
    return null;
  }
  return typeof object.id === "string" ? object.id : null;
}

function userIdFromMetadata(metadata: Stripe.Metadata): string | null {
  const userId = metadata.user_id;
  if (!userId) return null;
  if (!UUID_PATTERN.test(userId)) {
    throw new StripeSubscriptionSyncError("Subscription user_id metadata is invalid.");
  }
  return userId;
}

export function subscriptionProjection(
  event: Stripe.Event,
  subscription: Stripe.Subscription,
  priceIds: Record<PlanId, string>,
  forceCanceled = false,
): SubscriptionProjection {
  const items = subscription.items?.data ?? [];
  const priceId = items.length === 1 ? items[0].price?.id : null;
  const planEntry = priceId
    ? Object.entries(priceIds).find(([, configured]) => configured === priceId)
    : undefined;
  if (!priceId || !planEntry) throw new UnknownStripePriceError(event, priceId);

  const currentPeriodEnd = items[0].current_period_end;
  if (!Number.isInteger(currentPeriodEnd) || currentPeriodEnd <= 0) {
    throw new StripeSubscriptionSyncError("Subscription period end is invalid.");
  }
  const customerId = expandedId(subscription.customer);
  if (!customerId) {
    throw new StripeSubscriptionSyncError("Subscription customer is missing.");
  }
  const status = forceCanceled ? "canceled" : subscription.status;
  if (!SUBSCRIPTION_STATUSES.has(status)) {
    throw new StripeSubscriptionSyncError("Subscription status is unsupported.");
  }

  return {
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    currentPeriodEnd,
    customerId,
    eventCreated: event.created,
    plan: planEntry[0] as PlanId,
    status: status as SubscriptionStatus,
    subscriptionId: subscription.id,
    trialEnd: subscription.trial_end,
    trialStartedAt:
      status === "trialing" ? (subscription.trial_start ?? event.created) : null,
    userId: userIdFromMetadata(subscription.metadata),
  };
}

/** Retrieves current state before opening the short database transaction. */
export async function prepareStripeEvent(
  event: Stripe.Event,
  stripe: StripeSubscriptionGateway,
  priceIds: Record<PlanId, string>,
): Promise<PreparedStripeEvent> {
  if (
    event.type !== "checkout.session.completed" &&
    event.type !== "customer.subscription.created" &&
    event.type !== "customer.subscription.updated" &&
    event.type !== "customer.subscription.deleted"
  ) {
    return { kind: "none" };
  }

  if (event.type === "customer.subscription.deleted") {
    return {
      kind: "subscription_sync",
      projection: subscriptionProjection(
        event,
        event.data.object as Stripe.Subscription,
        priceIds,
        true,
      ),
    };
  }

  const subscriptionId = subscriptionIdFromEvent(event);
  if (!subscriptionId) {
    throw new StripeSubscriptionSyncError("Stripe event has no subscription ID.");
  }
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  return {
    kind: "subscription_sync",
    projection: subscriptionProjection(event, subscription, priceIds),
  };
}

/** Applies a prepared projection while the event claim transaction is open. */
export async function applyPreparedStripeEvent(
  database: StripeEventDatabase,
  prepared: unknown,
): Promise<SubscriptionApplyResult> {
  const value = prepared as PreparedStripeEvent;
  if (!value || value.kind !== "subscription_sync") return "not_applicable";
  const projection = value.projection;

  const targets = await database.query<{
    id: string;
    stripe_customer_id: string | null;
    subscription_event_created_at: Date | string | null;
  }>(
    `select id, stripe_customer_id, subscription_event_created_at
       from profiles
      where stripe_customer_id = $1
         or ($2::uuid is not null and id = $2::uuid)
      for update`,
    [projection.customerId, projection.userId],
  );
  if (targets.rows.length !== 1) {
    throw new StripeSubscriptionSyncError("Subscription profile mapping is ambiguous or missing.");
  }
  const target = targets.rows[0];
  if (
    (projection.userId && target.id !== projection.userId) ||
    (target.stripe_customer_id &&
      target.stripe_customer_id !== projection.customerId)
  ) {
    throw new StripeSubscriptionSyncError("Subscription profile mapping does not match.");
  }

  const lastCreated = target.subscription_event_created_at
    ? new Date(target.subscription_event_created_at).getTime() / 1000
    : null;
  if (lastCreated !== null && projection.eventCreated < lastCreated) {
    return "stale";
  }

  await database.query(
    `update profiles
        set plan = $2::plan_type,
            subscription_status = $3::subscription_status,
            current_period_end = to_timestamp($4),
            cancel_at_period_end = $5,
            trial_ends_at = case when $6::bigint is null then null else to_timestamp($6) end,
            stripe_customer_id = $7,
            stripe_subscription_id = $8,
            subscription_event_created_at = to_timestamp($9),
            trial_used_at = case
              when $3::subscription_status = 'trialing' then coalesce(
                trial_used_at,
                to_timestamp(coalesce($10::bigint, $9::bigint))
              )
              else trial_used_at
            end,
            updated_at = now()
      where id = $1`,
    [
      target.id,
      projection.plan,
      projection.status,
      projection.currentPeriodEnd,
      projection.cancelAtPeriodEnd,
      projection.trialEnd,
      projection.customerId,
      projection.subscriptionId,
      projection.eventCreated,
      projection.trialStartedAt,
    ],
  );
  return "updated";
}
