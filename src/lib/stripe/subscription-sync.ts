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
  | {
      kind: "invoice_sync";
      invoice: {
        attemptCount: number;
        id: string;
        paymentState: "failed" | "paid";
      };
      projection: SubscriptionProjection;
    }
  | { kind: "none" };

export type SubscriptionApplyResult = "updated" | "stale" | "not_applicable";

export class StripeSubscriptionSyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StripeSubscriptionSyncError";
  }
}

interface PlanTransitionTarget {
  active_x_account_id: string | null;
  ai_purpose_config: unknown;
  id: string;
  plan: PlanId;
}

function purposeProvider(
  config: unknown,
  purpose: "image" | "text",
): string | null {
  if (!config || typeof config !== "object") return null;
  const value = (config as Record<string, unknown>)[purpose];
  return typeof value === "string" ? value : null;
}

async function clearInactiveSelection(
  database: StripeEventDatabase,
  userId: string,
): Promise<void> {
  await database.query(
    `update profiles p
        set active_x_account_id = null, updated_at = now()
      where p.id = $1
        and p.active_x_account_id is not null
        and not exists (
          select 1 from x_accounts x
           where x.id = p.active_x_account_id
             and x.user_id = p.id
             and x.status = 'active'
        )`,
    [userId],
  );
}

async function applyStandardAccountLimit(
  database: StripeEventDatabase,
  target: PlanTransitionTarget,
): Promise<void> {
  const keeper = await database.query<{ id: string }>(
    `select id from x_accounts
      where user_id = $1 and status = 'active'
      order by (id = $2::uuid) desc, created_at asc, id asc
      limit 1`,
    [target.id, target.active_x_account_id],
  );
  const keeperId = keeper.rows[0]?.id ?? null;
  await database.query(
    `update x_accounts
        set status = 'disabled', updated_at = now()
      where user_id = $1
        and status = 'active'
        and ($2::uuid is null or id <> $2::uuid)`,
    [target.id, keeperId],
  );
  await database.query(
    `update profiles
        set active_x_account_id = $2::uuid, updated_at = now()
      where id = $1`,
    [target.id, keeperId],
  );
}

async function revalidateByokPurposeConfig(
  database: StripeEventDatabase,
  target: PlanTransitionTarget,
): Promise<void> {
  const keys = await database.query<{ provider: string }>(
    `select provider::text as provider from user_api_keys
      where user_id = $1
        and status = 'valid'
        and provider in ('anthropic', 'openai', 'google')`,
    [target.id],
  );
  const valid = new Set(keys.rows.map((row) => row.provider));
  const text = purposeProvider(target.ai_purpose_config, "text");
  const image = purposeProvider(target.ai_purpose_config, "image");
  const raw =
    target.ai_purpose_config && typeof target.ai_purpose_config === "object"
      ? (target.ai_purpose_config as Record<string, unknown>)
      : {};
  await database.query(
    `update profiles set ai_purpose_config = $2::jsonb, updated_at = now()
      where id = $1`,
    [
      target.id,
      {
        ...raw,
        text: text && valid.has(text) ? text : null,
        image:
          image &&
          (image === "openai" || image === "google") &&
          valid.has(image)
            ? image
            : null,
      },
    ],
  );
}

/** Applies plan-dependent X/account settings in the subscription transaction. */
async function applyPlanTransition(
  database: StripeEventDatabase,
  target: PlanTransitionTarget,
  nextPlan: PlanId,
): Promise<void> {
  if (target.plan === nextPlan) return;

  if (nextPlan === "premium") {
    await database.query(
      `update x_accounts set status = 'expired', updated_at = now()
        where user_id = $1 and auth_type = 'byok' and status <> 'expired'`,
      [target.id],
    );
  } else if (target.plan === "premium") {
    await database.query(
      `update x_accounts set status = 'expired', updated_at = now()
        where user_id = $1 and auth_type = 'managed' and status <> 'expired'`,
      [target.id],
    );
    await revalidateByokPurposeConfig(database, target);
  }

  if (nextPlan === "standard") {
    await applyStandardAccountLimit(database, target);
  } else {
    await clearInactiveSelection(database, target.id);
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
    event.type !== "customer.subscription.deleted" &&
    event.type !== "invoice.payment_failed" &&
    event.type !== "invoice.paid"
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

  if (event.type === "invoice.payment_failed" || event.type === "invoice.paid") {
    const invoice = event.data.object as Stripe.Invoice;
    const subscription = invoice.parent?.subscription_details?.subscription;
    const subscriptionId = expandedId(subscription ?? null);
    if (!subscriptionId) return { kind: "none" };
    const current = await stripe.subscriptions.retrieve(subscriptionId);
    return {
      kind: "invoice_sync",
      invoice: {
        attemptCount: invoice.attempt_count,
        id: invoice.id,
        paymentState:
          event.type === "invoice.payment_failed" ? "failed" : "paid",
      },
      projection: subscriptionProjection(event, current, priceIds),
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
  if (!value || value.kind === "none") return "not_applicable";
  const projection = value.projection;

  const targets = await database.query<{
    active_x_account_id: string | null;
    ai_purpose_config: unknown;
    id: string;
    notification_config: unknown;
    plan: PlanId;
    stripe_customer_id: string | null;
    subscription_event_created_at: Date | string | null;
  }>(
    `select id, active_x_account_id, ai_purpose_config, notification_config,
            plan, stripe_customer_id, subscription_event_created_at
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

  await applyPlanTransition(database, target, projection.plan);

  if (value.kind === "invoice_sync" && value.invoice.paymentState === "failed") {
    const config = target.notification_config as {
      billing?: { email?: unknown; in_app?: unknown };
    } | null;
    const inAppEnabled = config?.billing?.in_app === true;
    const emailEnabled = config?.billing?.email === true;
    if (inAppEnabled || emailEnabled) {
      const dedupeKey = `billing:invoice:${value.invoice.id}:payment_failed`;
      await database.query(
        `insert into notifications
          (user_id, type, dedupe_key, title, body, link, payload,
           in_app_enabled, email_status, email_available_at)
         values (
           $1, 'billing', $2,
           'お支払いを確認できませんでした',
           'お支払い方法をご確認ください。更新後は契約状態へ自動的に反映されます。',
           '/app/settings?tab=billing', $3::jsonb, $4,
           case when $5 then 'queued'::email_delivery_status
                else 'not_requested'::email_delivery_status end,
           case when $5 then now() else null end
         )
         on conflict (user_id, dedupe_key) where dedupe_key is not null
         do nothing`,
        [
          target.id,
          dedupeKey,
          {
            attempt_count: value.invoice.attemptCount,
            invoice_id: value.invoice.id,
            notification_config_snapshot: {
              email: emailEnabled,
              in_app: inAppEnabled,
            },
            subscription_id: projection.subscriptionId,
            subscription_status: projection.status,
          },
          inAppEnabled,
          emailEnabled,
        ],
      );
    }
  }
  return "updated";
}
