import type Stripe from "stripe";

import { recordUnexpectedError } from "@/lib/observability/sentry";
import type { PlanId } from "@/lib/plans";

import { scheduledPlanFromSchedule } from "./subscription-sync";

/**
 * **無料トライアル中の下位プラン変更は、その場で切り替える**（T-M8-299・運営者の指示 2026-08-25）。
 *
 * Portal は値下げを「期間末に切り替える予約（subscription schedule）」にする設定
 * （`schedule_at_period_end.conditions=[decreasing_item_amount]`・要件03 §2.2）で、
 * これは**有料契約では正しい**——払った期間ぶんは使えるべきだから。
 * ところが**トライアル中は1円も払っていない**ので、期間末（＝トライアル終了日）まで
 * 上位プランのまま待たせる理由がない。待たせると「下げたのに枠が上位のまま」に見える。
 *
 * Portalの設定は契約の状態で条件を変えられない（`conditions` は金額と請求間隔のみ）ので、
 * **アプリ側で戻ってきたときに畳む**——予約を解除して、今すぐ価格を差し替える。
 *
 * トライアル中の価格変更は即時に効き、日割りも請求も発生しない（2026-08-25 実測: `trialing` のまま
 * price だけが変わり、請求額は0円。`current_period_start` は動かない＝利用枠は自動では戻らないので、
 * 枠のリセットは呼び出し側が `usage_epoch` を進めて行う）。
 */
export interface TrialPlanChangeGateway {
  subscriptions: {
    update(
      id: string,
      params: Stripe.SubscriptionUpdateParams,
    ): Promise<Stripe.Subscription>;
  };
  subscriptionSchedules: {
    release(id: string): Promise<{ id: string; status: string }>;
  };
}

export interface TrialPlanChangeResult {
  /** 即時に切り替えた後の契約。切り替えていなければ null。 */
  subscription: Stripe.Subscription | null;
  /** 切り替え先のプラン（利用枠のリセット対象を呼び出し側が判断するのに使う）。 */
  plan: PlanId | null;
}

/**
 * 予約済みの下位変更がトライアル中に付いていたら、その場へ畳む。
 *
 * 何もしない条件（いずれも正常）: トライアル中でない／予約が無い／予約先が今と同じ。
 * **失敗しても呼び出し側を止めない**——予約のまま残るだけで、契約状態の反映のほうが重要。
 */
export async function applyTrialDowngradeNow(
  stripe: TrialPlanChangeGateway,
  subscription: Stripe.Subscription,
  schedule: Stripe.SubscriptionSchedule | null | undefined,
  priceIds: Record<PlanId, string>,
  nowSec: number,
): Promise<TrialPlanChangeResult> {
  const none: TrialPlanChangeResult = { plan: null, subscription: null };
  if (subscription.status !== "trialing") return none;

  const item = subscription.items?.data?.[0];
  const currentPriceId = typeof item?.price === "string" ? item.price : item?.price?.id;
  if (!item?.id || !currentPriceId) return none;

  const scheduled = scheduledPlanFromSchedule(schedule, currentPriceId, priceIds, nowSec);
  if (!scheduled) return none;

  const scheduleId = typeof subscription.schedule === "string"
    ? subscription.schedule
    : (subscription.schedule?.id ?? null);

  try {
    /*
      **先に予約を外す**。schedule が付いたままの契約は、Price を直接変えても
      期間末に schedule のフェーズへ戻されてしまう（予約が生きているため）。
    */
    if (scheduleId) await stripe.subscriptionSchedules.release(scheduleId);
    const updated = await stripe.subscriptions.update(subscription.id, {
      items: [{ id: item.id, price: priceIds[scheduled.plan] }],
      // トライアル中なので日割りは発生しない。明示して「請求されるのでは」の疑いを残さない。
      proration_behavior: "none",
    });
    return { plan: scheduled.plan, subscription: updated };
  } catch (error) {
    recordUnexpectedError(error, {
      at: "stripe:trial-downgrade",
      subscriptionId: subscription.id,
    });
    return none;
  }
}
