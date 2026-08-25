import { AppError } from "@/lib/observability/errors";
import { recordUnexpectedError } from "@/lib/observability/sentry";

/**
 * 解約予定の取り消し（T-M8-271・運営者の指示 2026-08-23「押した後はすぐに取り消す」）。
 *
 * 以前は Stripe の Portal トップへ飛ばし、そこで「プランを続ける」を押させていた。押した人からは
 * **同じ操作をもう1画面挟むだけ**に見えるうえ、Portal のどこにあるかも説明できなかった。
 * ここで契約の `cancel_at_period_end` / `cancel_at` を直接消して、その場で終わらせる。
 *
 * **`cancel_at` と `cancel_at_period_end` は片方だけ送る**。両方渡すと Stripe が
 * `Received both cancel_at_period_end and cancel_at parameters.` で400を返す（2026-08-23 実測）。
 * 現行APIは期間末解約を `cancel_at`（日時）で表し `cancel_at_period_end` はその写しなので、
 * **日時が入っていれば `cancel_at: null`**、入っていなければ `cancel_at_period_end: false` を送る
 * （トライアル中の解約は日時だけが立つ・T-M8-57）。
 *
 * 本人の契約だけを対象にする（`stripe_subscription_id` は profiles から取り、入力からは受けない）。
 * 解約済み（`canceled`）の再開は別経路（`resume.ts`・T-M8-264）——契約が終わっているので作り直しになる。
 */

export interface ScheduledCancellationDb {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
}

export interface ScheduledCancellationGateway {
  subscriptions: {
    retrieve(id: string): Promise<{ status: string; cancel_at_period_end?: boolean | null; cancel_at?: number | null }>;
    update(
      id: string,
      params: { cancel_at: null } | { cancel_at_period_end: false },
    ): Promise<{ status: string; cancel_at_period_end?: boolean | null; cancel_at?: number | null }>;
  };
}

export type CancelScheduledCancellationResult = "resumed" | "nothing_scheduled";

export async function cancelScheduledCancellation(
  db: ScheduledCancellationDb,
  stripe: ScheduledCancellationGateway,
  userId: string,
): Promise<CancelScheduledCancellationResult> {
  const { rows } = await db.query<{ stripe_subscription_id: string | null }>(
    `select stripe_subscription_id from profiles where id = $1`,
    [userId],
  );
  const subscriptionId = rows[0]?.stripe_subscription_id ?? null;
  if (!subscriptionId) throw new AppError("subscription_required");

  const subscription = await stripeCall(() => stripe.subscriptions.retrieve(subscriptionId));
  /*
    **解約済みはここでは戻せない**（Stripeは終了した契約を再開できない）。契約タブの「プランを再開」
    （T-M8-264）が新しい契約を作る経路なので、そちらへ促す。
  */
  if (subscription.status === "canceled" || subscription.status === "incomplete_expired") {
    throw new AppError("subscription_required");
  }
  if (!subscription.cancel_at_period_end && subscription.cancel_at == null) {
    // Stripe側に解約予定が無い＝既に取り消し済み。DBの表示だけ残っていれば消して整える。
    await clearCancelSchedule(db, userId);
    return "nothing_scheduled";
  }

  const clear = subscription.cancel_at != null ? { cancel_at: null as null } : { cancel_at_period_end: false as const };
  await stripeCall(() => stripe.subscriptions.update(subscriptionId, clear));
  /*
    webhook（customer.subscription.updated）でも同じ結果に落ち着くが、届くまでのあいだ画面に
    「◯日に解約されます」が残ると「取り消したのに残っている」と見える。ここで消しておく
    （webhookが来ても同じ値なので二重に困らない）。
  */
  await clearCancelSchedule(db, userId);
  return "resumed";
}

/**
 * Stripe側の失敗は他のStripe経路（Portal・Checkout）と同じ `provider_error` で返す。
 * 既定の `internal_error`（「予期しないエラー」）だと、利用者に何を待てばよいかが伝わらない。
 */
async function stripeCall<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (cause) {
    recordUnexpectedError(cause, { at: "scheduled-cancellation:stripe" });
    throw new AppError("provider_error", { cause });
  }
}

async function clearCancelSchedule(db: ScheduledCancellationDb, userId: string): Promise<void> {
  await db.query(
    `update profiles set cancel_at_period_end = false, updated_at = now() where id = $1`,
    [userId],
  );
}
