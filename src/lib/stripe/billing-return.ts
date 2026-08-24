import type Stripe from "stripe";

import type { PlanId } from "@/lib/plans";

import {
  expandedId,
  loadDiscount,
  loadSchedule,
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
    retrieve(
      id: string,
      params?: { expand: string[] },
    ): Promise<Stripe.Subscription>;
  };
  /** 予約済みの下位変更を読む（T-M8-260）。無いと予約を null で上書きしてしまうため、本番の client は必ず持つ。 */
  subscriptionSchedules?: {
    retrieve(id: string): Promise<Stripe.SubscriptionSchedule>;
  };
  /** 適用中の割引を読む（T-M8-293）。schedule と同じ理由で、無いと割引を null で上書きしてしまう。 */
  coupons?: {
    retrieve(id: string): Promise<Stripe.Coupon>;
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

/**
 * Stripeから引き直した現在状態を `applyPreparedStripeEvent` へ流すための合成イベント。
 * `created` を現在時刻にするのでstale判定に負けず、確実に反映される。
 * billing-return（Checkout/Portal復帰）と resume（プラン再開・T-M8-264）で共用する。
 */
export function syntheticSubscriptionEvent(
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
        expandedId(session.customer) !== profile.stripe_customer_id)
    ) {
      return "skipped";
    }
    subscriptionId = expandedId(session.subscription);
  }
  if (!subscriptionId) return "skipped";

  // `discounts` は expand しないとIDだけしか返らない（割引率はクーポン側）。
  const subscription = await deps.stripe.subscriptions.retrieve(subscriptionId, {
    expand: ["discounts"],
  });
  /*
    schedule（期間末の下位変更の予約）と discount（適用中の割引）も読む。
    Portal の `after_completion` は即リダイレクトなので、**Portalでの操作直後の戻りは
    本物の webhook より先にここを通る**。ここで null を書くと、後続の webhook は
    `created` が古いため stale 扱いになり、次の契約イベントまで画面に出ない。

    **割引がこれに当たっていた**（T-M8-293・運営者の報告 2026-08-24）。解約導線で引き止めの
    半額クーポンを受け取って戻ってくると、この経路が `discount` を null で書き、
    「半額適用中」の表示（T-M8-279）が**一度も出ないまま**になっていた。
    schedule だけ読んで discount を読まない、という取りこぼしだった。
  */
  const schedule = await loadSchedule(deps.stripe, subscription);
  const discount = await loadDiscount(deps.stripe, subscription);
  const created = deps.now();
  const projection = subscriptionProjection(
    syntheticSubscriptionEvent(subscription, created),
    subscription,
    deps.priceIds,
    false,
    schedule,
    discount,
  );
  const result = await deps.applyProjection(projection);
  return result === "stale" ? "stale" : "updated";
}
