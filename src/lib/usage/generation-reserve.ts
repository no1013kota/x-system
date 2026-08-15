import { AppError } from "../observability/errors";
import { CURRENT_MONTH_JST_SQL } from "./current-month";
import type { Queryable } from "../x/token-refresh";
import { notifyUsageThresholds } from "./usage-threshold";

/**
 * 生成/画像 利用枠の reserve / refund（要件03 §7.1〜§7.4, T-M5-03/T-M6-03）。文章系top-level job（生成・LRN・
 * SUGGEST・MD-MERGE）と画像生成jobは開始時に枠を +1 reserve し、最終失敗（worker / stale）時に同一keyで
 * refund する。BYOKは枠を消費しないため呼び出し側が premium のときだけ reserve する。冪等: reserve/refund
 * とも `usage_events.idempotency_key` unique（`job:{id}:{type}:reserve|refund`）で二重計上を防ぐ。
 * `limit` 指定時（premium月次上限・要件03 §7.2/§7.4）は usage_counters を FOR UPDATE でロックして現在値を
 * 確認し、上限到達なら `usage_limit_exceeded` を投げて event/counter を一切変更しない。
 */

export type UsageReserveType = "generation" | "image";

const COUNTER_COLUMN: Record<UsageReserveType, string> = {
  generation: "generations_count",
  image: "images_count",
};
const OPERATION: Record<UsageReserveType, string> = {
  generation: "generation",
  image: "image_generation",
};

/**
 * 枠を +1 reserve する（同一transactionで counter FOR UPDATE→上限確認→event insert→counter +1）。JST月へ記録。
 * 既に同一reserve keyがあれば no-op（冪等・上限判定もしない）。counter行が無ければ作る。
 * `limit` 指定時、現在値が上限以上なら `usage_limit_exceeded` を投げ、event/counterを変更しない。
 */
export async function reserveUsage(
  tx: Queryable,
  params: {
    userId: string;
    xAccountId?: string | null;
    jobId: string;
    type: UsageReserveType;
    /** premium月次上限。未指定なら上限判定しない（BYOK/上限適用前の呼び出し）。 */
    limit?: number;
    /**
     * 消費クレジット数（T-M8-108。既定1）。上位モデルはコスト比の倍数を消費する
     * （model-catalog.ts の creditMultiplier）。refundは元reserve行のdeltaを返すため対称。
     */
    amount?: number;
  },
): Promise<boolean> {
  const key = `job:${params.jobId}:${params.type}:reserve`;
  const column = COUNTER_COLUMN[params.type];
  const amount = Math.max(1, Math.floor(params.amount ?? 1));
  await tx.query(
    `insert into usage_counters (user_id, month)
     values ($1, ${CURRENT_MONTH_JST_SQL})
     on conflict (user_id, month) do nothing`,
    [params.userId],
  );
  // 当月counterをロックして現在値を読む（並行reserveの上限すり抜けを防ぐ・要件03 §7.4）。
  const current = (
    await tx.query<{ n: number }>(
      `select ${column} as n from usage_counters where user_id = $1 and month = ${CURRENT_MONTH_JST_SQL} for update`,
      [params.userId],
    )
  ).rows[0];
  // 冪等: 既に予約済みなら no-op（上限判定しない＝再実行が既存予約を失敗させない）。
  const dup = await tx.query(`select 1 from usage_events where idempotency_key = $1`, [key]);
  if (dup.rowCount) return false;
  // 上限確認（premiumのみ・limit指定時）。消費量を足すと超えるなら event/counter を変えずに失敗。
  if (params.limit !== undefined && (current?.n ?? 0) + amount > params.limit) {
    throw new AppError("usage_limit_exceeded", {
      details: { type: params.type, limit: params.limit, count: current?.n ?? 0, amount },
    });
  }
  await tx.query(
    `insert into usage_events
       (user_id, x_account_id, job_id, month, counter_type, operation, delta, reason, idempotency_key)
     values ($1, $2, $3, ${CURRENT_MONTH_JST_SQL},
             $4::usage_counter_type, $5::usage_event_operation, $7, 'reserve', $6)
     on conflict (idempotency_key) do nothing`,
    [params.userId, params.xAccountId ?? null, params.jobId, params.type, OPERATION[params.type], key, amount],
  );
  const updated = await tx.query<{ n: number }>(
    `update usage_counters set ${column} = ${column} + $2, updated_at = now()
      where user_id = $1 and month = ${CURRENT_MONTH_JST_SQL}
      returning ${column} as n`,
    [params.userId, amount],
  );
  // 80%/100% 到達通知（premium・枠/月/閾値ごとに1件・要件03 §8, T-M6-13）。
  await notifyUsageThresholds(tx, {
    userId: params.userId,
    key: params.type === "generation" ? "generations" : "images",
    newCount: updated.rows[0]?.n ?? 0,
  });
  return true;
}

/**
 * 未返還 reserve を refund する（元reserve行から counter_type/month を引き継ぎ delta=-1・ref_event_id
 * を記録して usage_counters を -1）。元reserveが無い/既にrefund済みなら no-op（冪等）。
 */
export async function refundUsage(
  tx: Queryable,
  jobId: string,
  type: UsageReserveType,
): Promise<boolean> {
  const reserveKey = `job:${jobId}:${type}:reserve`;
  const refundKey = `job:${jobId}:${type}:refund`;
  const { rows } = await tx.query<{ user_id: string; month: string; counter_type: string; delta: number }>(
    `insert into usage_events
       (user_id, x_account_id, job_id, draft_id, month, counter_type, operation,
        delta, reason, idempotency_key, ref_event_id)
     select r.user_id, r.x_account_id, r.job_id, r.draft_id, r.month, r.counter_type,
            r.operation, -r.delta, 'refund', $2, r.id
       from usage_events r
      where r.idempotency_key = $1 and r.reason = 'reserve'
     on conflict (idempotency_key) do nothing
     returning user_id, month, counter_type, delta`,
    [reserveKey, refundKey],
  );
  const refunded = rows[0];
  if (!refunded) return false;
  const column =
    refunded.counter_type === "generation" ? "generations_count" : "images_count";
  // refund行のdeltaは -reserve量。counterはその絶対値ぶん戻す（可変量・T-M8-108）。
  await tx.query(
    `update usage_counters set ${column} = greatest(0, ${column} - $3), updated_at = now()
      where user_id = $1 and month = $2`,
    [refunded.user_id, refunded.month, Math.abs(refunded.delta)],
  );
  return true;
}
