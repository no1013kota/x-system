import type { Queryable } from "../x/token-refresh";

/**
 * 生成/画像 利用枠の reserve / refund（要件03 §7.1〜§7.4, T-M5-03）。文章系top-level job（生成・LRN）と
 * 画像生成jobは開始時に枠を +1 reserve し、最終失敗（worker / stale）時に同一keyで refund する。
 * BYOKは枠を消費しないため呼び出し側が premium のときだけ reserve する。冪等: reserve/refund とも
 * `usage_events.idempotency_key` unique（`job:{id}:{type}:reserve|refund`）で二重計上を防ぐ。
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
 * 枠を +1 reserve する（同一transactionで event insert ＋ usage_counters +1）。JST月へ記録する。
 * 既に同一reserve keyがあれば no-op（冪等）。counter行が無ければ作る。
 */
export async function reserveUsage(
  tx: Queryable,
  params: { userId: string; xAccountId?: string | null; jobId: string; type: UsageReserveType },
): Promise<boolean> {
  const key = `job:${params.jobId}:${params.type}:reserve`;
  const column = COUNTER_COLUMN[params.type];
  await tx.query(
    `insert into usage_counters (user_id, month)
     values ($1, to_char((now() at time zone 'Asia/Tokyo'), 'YYYY-MM'))
     on conflict (user_id, month) do nothing`,
    [params.userId],
  );
  const { rowCount } = await tx.query(
    `insert into usage_events
       (user_id, x_account_id, job_id, month, counter_type, operation, delta, reason, idempotency_key)
     values ($1, $2, $3, to_char((now() at time zone 'Asia/Tokyo'), 'YYYY-MM'),
             $4::usage_counter_type, $5::usage_event_operation, 1, 'reserve', $6)
     on conflict (idempotency_key) do nothing`,
    [params.userId, params.xAccountId ?? null, params.jobId, params.type, OPERATION[params.type], key],
  );
  if ((rowCount ?? 0) === 0) return false; // 既存reserve → 二重加算しない
  await tx.query(
    `update usage_counters set ${column} = ${column} + 1, updated_at = now()
      where user_id = $1 and month = to_char((now() at time zone 'Asia/Tokyo'), 'YYYY-MM')`,
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
