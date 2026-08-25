import { AppError } from "@/lib/observability/errors";
import { recordUnexpectedError } from "@/lib/observability/sentry";

/**
 * 無料トライアル中の解約は**その場で終了**させる（T-M8-278・運営者の指示 2026-08-23）。
 *
 * 有料の契約は「払った期間の終わりまで使える」が筋だが、**トライアルは払っていない**ので、
 * 解約したのに終了日まで使える状態は説明しにくい。押した時点で止める。
 *
 * **残りのトライアル期間は捨てない**。`profiles.trial_ends_at` はそのまま残し、
 * 期限内に「トライアルを再開する」を押したら**同じ終了日で契約を作り直す**（`resume.ts`）。
 * Stripe は終了した契約を再開できないため、再開は必ず新しい契約になる。
 *
 * 有料契約（trialing 以外）には使わない——そちらは Portal の解約画面（期間末・引き止めクーポン）が担当。
 */

export interface CancelNowDb {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
}

export interface CancelNowGateway {
  subscriptions: {
    retrieve(id: string): Promise<{ status: string; trial_end?: number | null }>;
    cancel(id: string): Promise<{ status: string }>;
  };
}

export interface CancelNowResult {
  status: "canceled" | "already_canceled";
  /** 残っているトライアルの終了日時（ISO）。期限切れ・無ければ null。 */
  trialEndsAt: string | null;
}

export async function cancelTrialNow(
  db: CancelNowDb,
  stripe: CancelNowGateway,
  userId: string,
  nowMs: number = Date.now(),
): Promise<CancelNowResult> {
  const { rows } = await db.query<{
    stripe_subscription_id: string | null;
    subscription_status: string;
    trial_ends_at: string | null;
  }>(
    `select stripe_subscription_id, subscription_status, trial_ends_at::text as trial_ends_at
       from profiles where id = $1`,
    [userId],
  );
  const profile = rows[0];
  if (!profile?.stripe_subscription_id) throw new AppError("subscription_required");
  /*
    **トライアル中だけの経路**。有料契約をここで即時解約すると、払った分を返さずに止めることになる
    （Portalの期間末解約が正しい扱い）。呼び出し側の画面も trialing のときだけこのボタンを出す。
  */
  if (profile.subscription_status !== "trialing") throw new AppError("subscription_required");

  const subscriptionId = profile.stripe_subscription_id;
  const current = await stripeCall(() => stripe.subscriptions.retrieve(subscriptionId));
  const alreadyCanceled = current.status === "canceled" || current.status === "incomplete_expired";
  if (!alreadyCanceled) await stripeCall(() => stripe.subscriptions.cancel(subscriptionId));

  /*
    webhook（customer.subscription.deleted）でも同じ結果に落ち着くが、押した直後に画面が
    変わらないと「効いていない」と読める。ここで反映しておく（webhookが来ても同じ値）。
    **`trial_ends_at` は消さない**——残りの期間で再開するために要る。
  */
  await db.query(
    `update profiles
        set subscription_status = 'canceled', cancel_at_period_end = false,
            scheduled_plan = null, scheduled_plan_at = null, updated_at = now()
      where id = $1`,
    [userId],
  );
  const endsAt = profile.trial_ends_at ? new Date(profile.trial_ends_at) : null;
  const remaining = endsAt && !Number.isNaN(endsAt.getTime()) && endsAt.getTime() > nowMs ? endsAt : null;
  return {
    status: alreadyCanceled ? "already_canceled" : "canceled",
    trialEndsAt: remaining ? remaining.toISOString() : null,
  };
}

/** Stripe側の失敗は他のStripe経路と同じ `provider_error` で返す（「予期しないエラー」にしない）。 */
async function stripeCall<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (cause) {
    recordUnexpectedError(cause, { at: "stripe:cancel-trial-now" });
    throw new AppError("provider_error", { cause });
  }
}
