import { AppError } from "@/lib/observability/errors";
import { recordUnexpectedError } from "@/lib/observability/sentry";

/**
 * 予約済みの下位プラン変更の取り消し（T-M8-260）。
 *
 * Portalで下位プランを選ぶと Stripe は契約本体を変えず **subscription schedule** を付ける。
 * Portal は予約付きでも別プランへの変更は受け付ける（予約は置き換わる）が、
 * 「やっぱり今のプランのままにする」だけは Portal に無く、運営者のダッシュボード作業になっていた。
 * ここで schedule を release（解除）して、契約を今のフェーズのまま続ける（要件03 §2.2）。
 *
 * 本人の契約だけを対象にする（`stripe_subscription_id` は profiles から取り、入力からは受けない）。
 */

export interface ScheduledPlanChangeDb {
  query<T extends object = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}

export interface ScheduledPlanChangeGateway {
  subscriptions: {
    retrieve(id: string): Promise<{ schedule?: string | { id: string } | null }>;
  };
  subscriptionSchedules: {
    release(id: string): Promise<{ id: string; status: string }>;
  };
}

export type CancelScheduledPlanChangeResult = "released" | "nothing_scheduled";

export async function cancelScheduledPlanChange(
  db: ScheduledPlanChangeDb,
  stripe: ScheduledPlanChangeGateway,
  userId: string,
): Promise<CancelScheduledPlanChangeResult> {
  const { rows } = await db.query<{ stripe_subscription_id: string | null }>(
    `select stripe_subscription_id from profiles where id = $1`,
    [userId],
  );
  const subscriptionId = rows[0]?.stripe_subscription_id ?? null;
  if (!subscriptionId) throw new AppError("subscription_required");

  const subscription = await stripeCall(() => stripe.subscriptions.retrieve(subscriptionId));
  const schedule = subscription.schedule;
  const scheduleId = typeof schedule === "string" ? schedule : (schedule?.id ?? null);

  if (!scheduleId) {
    // Stripe側に予約が無い＝既に効いたか解除済み。DBの表示だけ残っていれば消して整える。
    await clearScheduledPlan(db, userId);
    return "nothing_scheduled";
  }

  await stripeCall(() => stripe.subscriptionSchedules.release(scheduleId));
  /*
    解除後は webhook（customer.subscription.updated・schedule=null）で同じ結果に落ち着くが、
    届くまでのあいだ画面に「◯日に変わります」が残ると「取り消したのに残っている」と
    見える。**ここで消しておく**（webhookが来ても同じ値なので二重に困らない）。
  */
  await clearScheduledPlan(db, userId);
  return "released";
}

/**
 * Stripe側の失敗は他のStripe経路（Portal・Checkout）と同じ `provider_error` で返す。
 * 既定の `internal_error`（「予期しないエラー」）だと、利用者に何を待てばよいかが伝わらない。
 * 原因は `errorResult` では記録されない code なので、ここで記録する。
 */
async function stripeCall<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (cause) {
    recordUnexpectedError(cause, { at: "scheduled-plan-change:stripe" });
    throw new AppError("provider_error", { cause });
  }
}

async function clearScheduledPlan(db: ScheduledPlanChangeDb, userId: string): Promise<void> {
  await db.query(
    `update profiles
        set scheduled_plan = null, scheduled_plan_at = null, updated_at = now()
      where id = $1`,
    [userId],
  );
}
