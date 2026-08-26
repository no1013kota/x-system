import type { Queryable } from "../db/queryable";

import { currentUsagePeriodKey } from "./usage-period";

/**
 * **超過分を次の期間へ繰り越す**（T-M8-324・運営者の指示 2026-08-27
 * 「翌月初にはマイナス分は引かれた状態でリセットさせてください」）。
 *
 * 予約をやめた（T-M8-324）ので、走り出した生成は最後まで通る。その結果
 * **使用量が上限を超えうる**（残量はマイナスで見える）。超えたぶんを無かったことにすると、
 * 期間の変わり目に「上限ぎりぎりで始めた生成」の実費が毎回消える——上限が実質的に効かなくなる。
 *
 * そこで**新しい期間の最初の1行を作るとき**、直前の期間の超過分を初期値として入れる。
 * 例: 上限100,000で105,000使った → 次の期間は 5,000 から始まる。
 *
 * **上限はいまのプランの値を使う**。期間中にプランが変わっていた場合は厳密には
 * 当時の上限だが、`usage_counters` は当時の上限を持たないため近似する。
 * 上位へ変えた人には有利（超過が小さく出る）、下位へ変えた人には不利になりうるが、
 * 下位への変更はその時点で世代を進めて0から数え直す（T-M8-299）ので実際には起きない。
 */
export async function carryOverUsage(
  tx: Queryable,
  params: { userId: string; limit: number },
): Promise<number> {
  const period = await currentUsagePeriodKey(tx, params.userId);
  // 既に今期の行があるなら何もしない（初回作成のときだけ繰り越す）。
  const existing = await tx.query(
    `select 1 from usage_counters where user_id = $1 and month = $2`,
    [params.userId, period],
  );
  if (existing.rowCount) return 0;

  // 直前の期間＝今期より前で最も新しい行。世代付きキーも文字列順で並ぶ（YYYY-MM-DD#N）。
  const { rows } = await tx.query<{ used: number }>(
    `select ai_credits_used as used from usage_counters
      where user_id = $1 and month < $2
      order by month desc limit 1`,
    [params.userId, period],
  );
  const carried = Math.max(0, (rows[0]?.used ?? 0) - params.limit);
  await tx.query(
    `insert into usage_counters (user_id, month, ai_credits_used)
     values ($1, $2, $3)
     on conflict (user_id, month) do nothing`,
    [params.userId, period, carried],
  );
  return carried;
}
