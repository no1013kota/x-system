import type { Queryable } from "../db/queryable";

/**
 * 利用枠の「期間キー」（T-M8-258）。
 *
 * 利用枠（AIクレジット・通常投稿・URL付き投稿）は**契約期間＝請求期間**ごとに数える。キーは
 * `profiles.current_period_start`（Stripeから同期）の **JST 日付 `YYYY-MM-DD`**。更新日に新しい
 * 期間キーの行が 0 から始まるので、月初リセットのjobは要らない（要件03 §7.2）。
 *
 * **未同期（`current_period_start` が null）のあいだは従来の JST 暦月 `YYYY-MM`** で数える。
 * webhook が遅れて期間が更新されないときは**前の期間キーのまま数え続ける**（勝手にリセットされない）。
 * 実行そのものの停止は期限切れ判定（`isSubscriptionPeriodStale`・T-M8-235）が担う。
 *
 * 列名は歴史的に `month` のまま（`usage_events.month` / `usage_counters.month`）。
 */

/** 期間キーのSQL式。`periodStartColumn` は timestamptz 列（例 `p.current_period_start`）。 */
export function usagePeriodKeyExpr(periodStartColumn: string): string {
  return `coalesce(to_char((${periodStartColumn} at time zone 'Asia/Tokyo'), 'YYYY-MM-DD'), to_char((now() at time zone 'Asia/Tokyo'), 'YYYY-MM'))`;
}

/** 利用者IDのパラメータ（例 `$1`）から期間キーを引くサブクエリ。 */
export function usagePeriodKeySql(userIdParam: string): string {
  return `(select ${usagePeriodKeyExpr("p.current_period_start")} from profiles p where p.id = ${userIdParam})`;
}

/** 期間キーを1回だけ読み、以後はパラメータで渡す（同一transaction内の複数SQLで同じ値を使うため）。 */
export async function currentUsagePeriodKey(db: Queryable, userId: string): Promise<string> {
  const { rows } = await db.query<{ key: string }>(`select ${usagePeriodKeySql("$1")} as key`, [userId]);
  const key = rows[0]?.key;
  if (!key) throw new Error(`usage period key unavailable for user ${userId}`);
  return key;
}
