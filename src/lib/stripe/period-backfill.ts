import type Stripe from "stripe";

import { recordUnexpectedError } from "@/lib/observability/sentry";

/**
 * 契約期間の補完（T-M8-258 の移行・レビュー指摘）。
 *
 * `profiles.current_period_start` は T-M8-258 で追加された列で、書くのは Stripe イベントの同期だけ。
 * 既存の契約者は**次のイベント（多くは更新日）まで null のまま**＝利用枠は暦月で数え、画面は
 * 「次回の更新日」としか出せない。さらに期間途中で Portal を開いただけでも同期が走り、
 * 利用者ごとにバラバラの時期に期間キーが切り替わる（その期間の枠が0から数え直される）。
 *
 * 運営者の手順（再同期コマンドの実行）に頼らず、scheduler_tick の日次処理で null の契約者を
 * Stripe から読んで埋める（原則3）。**契約本体（plan/status）は触らず期間の2列だけ**書く——
 * 投影全体を適用すると `subscription_event_created_at` が進み、後続の webhook を stale にする。
 * 1回あたり `limit` 件までで、残りは翌日へ持ち越す（本番の契約者数なら1日で終わる）。
 */

export interface PeriodBackfillDb {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
}

export interface PeriodBackfillStripe {
  subscriptions: { retrieve(id: string): Promise<Stripe.Subscription> };
}

export interface PeriodBackfillResult {
  /** 対象（null の契約者）として読んだ件数。 */
  checked: number;
  /** 埋めた件数。 */
  updated: number;
  /** Stripe から読めなかった／期間が取れなかった件数（記録済み。翌日に再試行）。 */
  failed: number;
}

export async function backfillSubscriptionPeriods(deps: {
  db: PeriodBackfillDb;
  stripe: PeriodBackfillStripe;
  limit?: number;
}): Promise<PeriodBackfillResult> {
  const limit = deps.limit ?? 50;
  const { rows } = await deps.db.query<{ id: string; stripe_subscription_id: string }>(
    `select id, stripe_subscription_id
       from profiles
      where current_period_start is null
        and stripe_subscription_id is not null
        and subscription_status in ('trialing', 'active', 'past_due', 'unpaid', 'paused')
      order by updated_at
      limit $1`,
    [limit],
  );
  let updated = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const subscription = await deps.stripe.subscriptions.retrieve(row.stripe_subscription_id);
      const item = subscription.items?.data?.[0];
      const start = item?.current_period_start;
      const end = item?.current_period_end;
      if (!Number.isInteger(start) || !Number.isInteger(end) || start <= 0 || start > end) {
        throw new Error("subscription period is missing or invalid");
      }
      const res = await deps.db.query(
        `update profiles
            set current_period_start = to_timestamp($2),
                current_period_end = to_timestamp($3),
                updated_at = now()
          where id = $1 and current_period_start is null`,
        [row.id, start, end],
      );
      updated += res.rowCount ?? 0;
    } catch (error) {
      failed += 1;
      recordUnexpectedError(error, { at: "period-backfill", userId: row.id });
    }
  }
  return { checked: rows.length, updated, failed };
}
