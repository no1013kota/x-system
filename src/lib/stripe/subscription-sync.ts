import type Stripe from "stripe";

import {
  recordCommissionForInvoice,
  reverseCommissionForInvoice,
  terminateAttributionForReferredUser,
} from "@/lib/affiliate/store";
import { isOperatorManagedPlan, PLANS } from "../plans";

import { revalidateByokAiPurposeConfig } from "@/lib/ai-purpose-config";
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
        /** 実際に支払われた金額（JPY）。招待報酬の計算に使う（T-M8-174）。 */
        amountPaid: number;
        /** 支払時刻（unix秒）。 */
        paidAtSec: number;
      };
      projection: SubscriptionProjection;
    }
  /** Refund（charge.refunded）。該当invoiceの招待報酬を取り消す（T-M8-174）。 */
  | { kind: "charge_refund"; stripeInvoiceId: string | null }
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

/**
 * 遷移先プランのXアカウント上限を超える分を disabled にする（T-M8-168で汎用化）。
 *
 * 旧実装は `applyStandardAccountLimit` ＝「1つだけ残して他を全部無効化」の**ハードコード**
 * だった。上限はプランごとに違い今後も変わる（standard/premium=1・expert=3、2026-08-20時点）ため、
 * ハードコードのままだと上限の変更のたびに正当なアカウントを黙って無効化し得る。plans.ts から引く。
 * 残す優先順位は 選択中 → 作成が古い順（旧実装と同じ）。データは消さない（status変更のみ）。
 */
async function applyXAccountLimit(
  database: StripeEventDatabase,
  target: PlanTransitionTarget,
  limit: number,
): Promise<void> {
  const keepers = await database.query<{ id: string }>(
    `select id from x_accounts
      where user_id = $1 and status = 'active'
      order by (id = $2::uuid) desc, created_at asc, id asc
      limit $3`,
    [target.id, target.active_x_account_id, limit],
  );
  const keeperIds = keepers.rows.map((row) => row.id);
  await database.query(
    `update x_accounts
        set status = 'disabled', updated_at = now()
      where user_id = $1
        and status = 'active'
        and not (id = any($2::uuid[]))`,
    [target.id, keeperIds],
  );
  // 選択中が残っていればそのまま。消えたら先頭（選択中優先→最古）の残存へ付け替える。
  const nextActive =
    target.active_x_account_id && keeperIds.includes(target.active_x_account_id)
      ? target.active_x_account_id
      : (keeperIds[0] ?? null);
  await database.query(
    `update profiles
        set active_x_account_id = $2::uuid, updated_at = now()
      where id = $1`,
    [target.id, nextActive],
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
  const config = revalidateByokAiPurposeConfig(
    target.ai_purpose_config,
    new Set(keys.rows.map((row) => row.provider)),
  );
  await database.query(
    `update profiles set ai_purpose_config = $2::jsonb, updated_at = now()
      where id = $1`,
    [target.id, config],
  );
}

/** Applies plan-dependent X/account settings in the subscription transaction. */
async function applyPlanTransition(
  database: StripeEventDatabase,
  target: PlanTransitionTarget,
  nextPlan: PlanId,
): Promise<void> {
  if (target.plan === nextPlan) return;

  // 遷移先プランで使えない auth_type の連携は expired にする（premium⇄expert間は同じmanagedなので不変）。
  const nextManaged = isOperatorManagedPlan(nextPlan);
  const prevManaged = isOperatorManagedPlan(target.plan);
  if (nextManaged && !prevManaged) {
    await database.query(
      `update x_accounts set status = 'expired', updated_at = now()
        where user_id = $1 and auth_type = 'byok' and status <> 'expired'`,
      [target.id],
    );
  } else if (!nextManaged && prevManaged) {
    await database.query(
      `update x_accounts set status = 'expired', updated_at = now()
        where user_id = $1 and auth_type = 'managed' and status <> 'expired'`,
      [target.id],
    );
    await revalidateByokPurposeConfig(database, target);
  }

  await applyXAccountLimit(database, target, PLANS[nextPlan].xAccountLimit);
  await clearInactiveSelection(database, target.id);
}

export function expandedId(value: { id: string } | string | null): string | null {
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
    // **`cancel_at` も「解約予定」として読む**（T-M8-57）。トライアル中の解約では、Stripeは
    // `cancel_at_period_end: true` ではなく **`cancel_at`（=trial_end の日時）だけ**を設定する。
    // boolean しか読んでいなかったため、Portalで解約しても同期後の profile は「解約予定なし」の
    // ままで、画面に何も出なかった（2026-08-05、利用者が実際に踏んだ）。
    cancelAtPeriodEnd: subscription.cancel_at_period_end || subscription.cancel_at != null,
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
  if (event.type === "charge.refunded") {
    const charge = event.data.object as Stripe.Charge;
    const invoiceRef = (charge as unknown as { invoice?: unknown }).invoice ?? null;
    return {
      kind: "charge_refund",
      stripeInvoiceId: expandedId(invoiceRef as { id: string } | string | null),
    };
  }

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
        amountPaid: invoice.amount_paid ?? 0,
        paidAtSec: invoice.status_transitions?.paid_at ?? event.created,
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

type InvoiceSyncDetail = Extract<
  PreparedStripeEvent,
  { kind: "invoice_sync" }
>["invoice"];

/**
 * 請求失敗（invoice payment_failed）時のユーザー通知を冪等に記録する。billing通知の
 * in_app/email いずれかが有効なときだけ dedupe_key 付きで insert し、リトライ webhook の
 * 二重通知を防ぐ。event claim transaction 内で呼ぶ。
 */
async function notifyInvoicePaymentFailed(
  database: StripeEventDatabase,
  target: { id: string; notification_config: unknown },
  invoice: InvoiceSyncDetail,
  projection: SubscriptionProjection,
): Promise<void> {
  const config = target.notification_config as {
    billing?: { email?: unknown; in_app?: unknown };
  } | null;
  const inAppEnabled = config?.billing?.in_app === true;
  const emailEnabled = config?.billing?.email === true;
  if (!inAppEnabled && !emailEnabled) return;
  const dedupeKey = `billing:invoice:${invoice.id}:payment_failed`;
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
        attempt_count: invoice.attemptCount,
        invoice_id: invoice.id,
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

/** Applies a prepared projection while the event claim transaction is open. */
export async function applyPreparedStripeEvent(
  database: StripeEventDatabase,
  prepared: unknown,
): Promise<SubscriptionApplyResult> {
  const value = prepared as PreparedStripeEvent;
  if (!value || value.kind === "none") return "not_applicable";
  if (value.kind === "charge_refund") {
    // Refund: 該当invoiceの招待報酬を取り消す（profileの照合は不要・T-M8-174）。
    if (value.stripeInvoiceId) {
      await reverseCommissionForInvoice(database, value.stripeInvoiceId);
    }
    return "updated";
  }
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
    await notifyInvoicePaymentFailed(database, target, value.invoice, projection);
  }
  // 招待プログラム（T-M8-174）: 支払成功が報酬のSource of Truth（invite_cp.md §6）。
  if (value.kind === "invoice_sync" && value.invoice.paymentState === "paid") {
    await recordCommissionForInvoice(database, {
      referredUserId: target.id,
      stripeInvoiceId: value.invoice.id,
      amountPaid: value.invoice.amountPaid,
      paidAtSec: value.invoice.paidAtSec,
    });
  }
  // 紹介ユーザーの解約で報酬期間を終了する（再契約でも再開しない・invite_cp.md §7）。
  if (projection.status === "canceled") {
    await terminateAttributionForReferredUser(
      database,
      target.id,
      new Date(projection.eventCreated * 1000).toISOString(),
    );
  }
  return "updated";
}
