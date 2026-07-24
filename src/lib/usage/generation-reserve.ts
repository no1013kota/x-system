import { AppError } from "../observability/errors";
import type { Queryable } from "../x/token-refresh";

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

const MONTH_EXPR = `to_char((now() at time zone 'Asia/Tokyo'), 'YYYY-MM')`;

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
  },
): Promise<boolean> {
  const key = `job:${params.jobId}:${params.type}:reserve`;
  const column = COUNTER_COLUMN[params.type];
  await tx.query(
    `insert into usage_counters (user_id, month)
     values ($1, ${MONTH_EXPR})
     on conflict (user_id, month) do nothing`,
    [params.userId],
  );
  // 当月counterをロックして現在値を読む（並行reserveの上限すり抜けを防ぐ・要件03 §7.4）。
  const current = (
    await tx.query<{ n: number }>(
      `select ${column} as n from usage_counters where user_id = $1 and month = ${MONTH_EXPR} for update`,
      [params.userId],
    )
  ).rows[0];
  // 冪等: 既に予約済みなら no-op（上限判定しない＝再実行が既存予約を失敗させない）。
  const dup = await tx.query(`select 1 from usage_events where idempotency_key = $1`, [key]);
  if (dup.rowCount) return false;
  // 上限確認（premiumのみ・limit指定時）。到達時は event/counter を変えずに失敗。
  if (params.limit !== undefined && (current?.n ?? 0) >= params.limit) {
    throw new AppError("usage_limit_exceeded", {
      details: { type: params.type, limit: params.limit, count: current?.n ?? 0 },
    });
  }
  await tx.query(
    `insert into usage_events
       (user_id, x_account_id, job_id, month, counter_type, operation, delta, reason, idempotency_key)
     values ($1, $2, $3, ${MONTH_EXPR},
             $4::usage_counter_type, $5::usage_event_operation, 1, 'reserve', $6)
     on conflict (idempotency_key) do nothing`,
    [params.userId, params.xAccountId ?? null, params.jobId, params.type, OPERATION[params.type], key],
  );
  await tx.query(
    `update usage_counters set ${column} = ${column} + 1, updated_at = now()
      where user_id = $1 and month = ${MONTH_EXPR}`,
    [params.userId],
  );
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
  const { rows } = await tx.query<{ user_id: string; month: string; counter_type: string }>(
    `insert into usage_events
       (user_id, x_account_id, job_id, draft_id, month, counter_type, operation,
        delta, reason, idempotency_key, ref_event_id)
     select r.user_id, r.x_account_id, r.job_id, r.draft_id, r.month, r.counter_type,
            r.operation, -1, 'refund', $2, r.id
       from usage_events r
      where r.idempotency_key = $1 and r.reason = 'reserve'
     on conflict (idempotency_key) do nothing
     returning user_id, month, counter_type`,
    [reserveKey, refundKey],
  );
  const refunded = rows[0];
  if (!refunded) return false;
  const column =
    refunded.counter_type === "generation" ? "generations_count" : "images_count";
  await tx.query(
    `update usage_counters set ${column} = greatest(0, ${column} - 1), updated_at = now()
      where user_id = $1 and month = $2`,
    [refunded.user_id, refunded.month],
  );
  return true;
}
