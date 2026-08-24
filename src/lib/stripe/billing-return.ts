import type Stripe from "stripe";

import { recordUnexpectedError } from "@/lib/observability/sentry";
import { PLANS, type PlanId } from "@/lib/plans";

import {
  expandedId,
  loadDiscount,
  loadSchedule,
  subscriptionProjection,
  type SubscriptionApplyResult,
  type SubscriptionProjection,
} from "./subscription-sync";
import { applyTrialDowngradeNow } from "./trial-plan-change";
import type {
  BillingReturnMarker,
  BillingReturnSource,
} from "./billing-return-marker";

export interface BillingReturnProfile {
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_event_created_at: string | null;
  /** 変更前のプラン（T-M8-299）。トライアル中に下がったかどうかの判定に使う。 */
  plan?: PlanId | null;
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
    /** トライアル中の下位変更を即時に反映する（T-M8-299）。 */
    update?(
      id: string,
      params: Stripe.SubscriptionUpdateParams,
    ): Promise<Stripe.Subscription>;
  };
  /** 予約済みの下位変更を読む（T-M8-260）。無いと予約を null で上書きしてしまうため、本番の client は必ず持つ。 */
  subscriptionSchedules?: {
    retrieve(id: string): Promise<Stripe.SubscriptionSchedule>;
    /** トライアル中の下位変更を即時へ畳むために解除する（T-M8-299）。無い gateway では畳まない。 */
    release?(id: string): Promise<{ id: string; status: string }>;
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
  /**
   * 利用枠を今すぐ0へ戻す（T-M8-299）。トライアル中に下位プランへ切り替えたときだけ呼ぶ。
   * 省略された場合はリセットしない（テストや古い呼び出しで枠が勝手に消えないように）。
   */
  resetUsage?(userId: string): Promise<void>;
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
  /*
    **トライアル中の下位変更はここで即時へ畳む**（T-M8-299・運営者の指示 2026-08-25）。
    Portal は値下げを期間末の予約にするが、1円も払っていないトライアル中に
    期間末まで上位プランのまま待たせる理由がない。予約を解除して今すぐ差し替え、
    利用枠も0へ戻す（Stripe は `current_period_start` を動かさないので自動では戻らない）。
  */
  const trialChange =
    deps.stripe.subscriptions.update && deps.stripe.subscriptionSchedules?.release
      ? await applyTrialDowngradeNow(
          {
            subscriptionSchedules: { release: deps.stripe.subscriptionSchedules.release },
            subscriptions: { update: deps.stripe.subscriptions.update },
          },
          subscription,
          // "unavailable"（読めなかった）は予約の有無が分からないので畳まない。
          schedule === "unavailable" ? null : schedule,
          deps.priceIds,
          deps.now(),
        )
      : { plan: null, subscription: null };
  const effective = trialChange.subscription ?? subscription;
  // 即時に畳んだあとは予約が無い状態が正（release済みなので schedule は読み直さず null 扱い）。
  const effectiveSchedule = trialChange.subscription ? null : schedule;
  const created = deps.now();
  const projection = subscriptionProjection(
    syntheticSubscriptionEvent(effective, created),
    effective,
    deps.priceIds,
    false,
    effectiveSchedule,
    discount,
  );
  const result = await deps.applyProjection(projection);
  /*
    枠のリセットは**反映のあと**に行う（先に進めると、反映が失敗したときだけ枠が消える）。
    失敗しても戻り自体は成功として返す——枠は次の期間で戻るが、契約の反映のほうが重い。
  */
  /*
    **トライアル中にプランが下がったら枠を0へ戻す**（T-M8-299・運営者の指示 2026-08-25）。
    予約を畳んだ経路（`trialChange`）だけを見ると取りこぼす——Portalが予約を作らず
    その場で下げることもあるため、**変更前後のプランを比べて**判定する。
    Stripe はトライアル中の価格変更で `current_period_start` を動かさない（2026-08-25 実測）ので、
    枠は自動では戻らない。上位への変更では戻さない（枠が増えるので戻す必要がない）。
  */
  const wentDownDuringTrial =
    projection.status === "trialing" &&
    profile.plan != null &&
    projection.plan !== profile.plan &&
    PLANS[projection.plan].monthlyPriceJpy < PLANS[profile.plan].monthlyPriceJpy;
  if (wentDownDuringTrial && deps.resetUsage) {
    try {
      await deps.resetUsage(input.userId);
    } catch (error) {
      recordUnexpectedError(error, { at: "stripe:trial-downgrade-usage", userId: input.userId });
    }
  }
  return result === "stale" ? "stale" : "updated";
}
