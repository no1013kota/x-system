import { AppError } from "../observability/errors";
import { carryOverUsage } from "./usage-carryover";
import { currentUsagePeriodKey } from "./usage-period";
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

/** T-M8-109: 文章・画像とも1本のAIクレジット（金額制）へ計上する。typeは冪等キーとoperationの区別に残す。 */
const COUNTER_COLUMN: Record<UsageReserveType, string> = {
  generation: "ai_credits_used",
  image: "ai_credits_used",
};
const OPERATION: Record<UsageReserveType, string> = {
  generation: "generation",
  image: "image_generation",
};

/**
 * 枠を +1 reserve する（同一transactionで counter FOR UPDATE→上限確認→event insert→counter +1）。
 * 契約期間の期間キー（`usage-period.ts`・T-M8-258）へ記録。
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
  const column = COUNTER_COLUMN[params.type];
  const period = await currentUsagePeriodKey(tx, params.userId);
  // 期間が変わった最初の1回で、前期の超過分を初期値として持ち込む（T-M8-324）。
  if (params.limit !== undefined) {
    await carryOverUsage(tx, { userId: params.userId, limit: params.limit });
  } else {
    await tx.query(
      `insert into usage_counters (user_id, month)
       values ($1, $2)
       on conflict (user_id, month) do nothing`,
      [params.userId, period],
    );
  }
  /*
    **開始前に「まだ残っているか」だけを見る**（T-M8-324・運営者の指示 2026-08-27）。

    以前は見積もりを先に押さえ（reserve）、成功時に実費で精算し、失敗時に返還していた。
    そのため**完了のたびに使用量が下がって見え**、利用者から「何もしていないのに減る」と
    問い合わせが来た。いまは**実費が確定したときだけ書く**（`chargeUsage`）。

    上限の当たり方（要決定D-48・案A）:
    - 残量が尽きていれば**新しい生成を始めさせない**
    - **走り出した生成は最後まで通す**ので、結果として使用量が上限を超えうる（残量はマイナス）
    - 超過分は次の期間へ繰り越して差し引く（`carryOverUsageSql`）
  */
  const current = (
    await tx.query<{ n: number }>(
      `select ${column} as n from usage_counters where user_id = $1 and month = $2 for update`,
      [params.userId, period],
    )
  ).rows[0];
  if (params.limit !== undefined && (current?.n ?? 0) >= params.limit) {
    throw new AppError("usage_limit_exceeded", {
      details: { type: params.type, limit: params.limit, count: current?.n ?? 0 },
    });
  }
  return true;
}

/**
 * **実費を記録する**（T-M8-109→T-M8-324）。予約をやめたので、ここが唯一の消費の書き込み。
 *
 * 冪等キーは job と種別で1つ（`job:{id}:{type}:charge`）。同じjobを何度精算しても二重に引かない。
 * **上限を超えても拒否しない**——既に発生した実費は無かったことにできない。超過は残量が
 * マイナスとして見え、次の期間へ繰り越される（要決定D-48・案A）。
 */
export async function settleUsage(
  tx: Queryable,
  params: {
    jobId: string;
    type: UsageReserveType;
    actualCredits: number;
    userId: string;
    xAccountId?: string | null;
  },
): Promise<boolean> {
  const chargeKey = `job:${params.jobId}:${params.type}:charge`;
  const amount = Math.max(1, Math.ceil(params.actualCredits));
  const period = await currentUsagePeriodKey(tx, params.userId);
  await tx.query(
    `insert into usage_counters (user_id, month)
     values ($1, $2)
     on conflict (user_id, month) do nothing`,
    [params.userId, period],
  );
  const inserted = await tx.query(
    `insert into usage_events
       (user_id, x_account_id, job_id, month, counter_type, operation, delta, reason, idempotency_key)
     values ($1, $2, $3, $4, 'ai_credit'::usage_counter_type,
             $5::usage_event_operation, $6, 'consume', $7)
     on conflict (idempotency_key) do nothing
     returning id`,
    [
      params.userId,
      params.xAccountId ?? null,
      params.jobId,
      period,
      OPERATION[params.type],
      amount,
      chargeKey,
    ],
  );
  if (!inserted.rowCount) return false; // 既に記録済み（冪等）
  const updated = await tx.query<{ n: number }>(
    `update usage_counters
        set ai_credits_used = ai_credits_used + $3, updated_at = now()
      where user_id = $1 and month = $2
      returning ai_credits_used as n`,
    [params.userId, period, amount],
  );
  await notifyUsageThresholds(tx, {
    userId: params.userId,
    key: "ai_credits",
    newCount: updated.rows[0]?.n ?? 0,
    periodKey: period,
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
  // refund行のdeltaは -reserve量。counterはその絶対値ぶん戻す（可変量・T-M8-108/109）。
  await tx.query(
    `update usage_counters set ai_credits_used = greatest(0, ai_credits_used - $3), updated_at = now()
      where user_id = $1 and month = $2`,
    [refunded.user_id, refunded.month, Math.abs(refunded.delta)],
  );
  return true;
}
