import type { Queryable } from "../db/queryable";

/**
 * 利用枠の「期間キー」（T-M8-258）。
 *
 * 利用枠（AIクレジット・通常投稿・URL付き投稿）は**契約期間＝請求期間**ごとに数える。キーは
 * 期間の開始日の **JST 日付 `YYYY-MM-DD`**。更新日に新しい期間キーの行が 0 から始まるので、
 * 月初リセットのjobは要らない（要件03 §7.2）。
 *
 * **トライアルは独立した期間**として数え、**有料化の日に枠がもう一度満額へ戻る**
 * （運営者の指示 2026-08-23・要決定D-38 再決定）。Stripe がトライアルを独立した期間
 * （`current_period_end = trial_end`）として扱い、有料化の日に `current_period_start = trial_end` の
 * 新しい期間を始めるので、その区切りをそのまま利用枠の区切りにする。
 * 「試して気に入ったら払う」人が、払った初日から満額を使えるほうが説明も体験も素直だという判断
 * （費用は最大でトライアル1周ぶん増える）。
 *
 * **未同期（`current_period_start` が null）のあいだは従来の JST 暦月 `YYYY-MM`** で数える。
 * webhook が遅れて期間が更新されないときは**前の期間キーのまま数え続ける**（勝手にリセットされない）。
 * 実行そのものの停止は期限切れ判定（`isSubscriptionPeriodStale`・T-M8-235）が担う。
 *
 * 列名は歴史的に `month` のまま（`usage_events.month` / `usage_counters.month`）。
 */

/** 利用枠の期間の開始（timestamptz 式）。`p` は profiles の別名。 */
export function usagePeriodStartExpr(p: string): string {
  return `${p}.current_period_start`;
}

/** 期間キーのSQL式。`p` は profiles の別名（例 `p`）。 */
export function usagePeriodKeyExpr(p: string): string {
  return `coalesce(to_char((${usagePeriodStartExpr(p)} at time zone 'Asia/Tokyo'), 'YYYY-MM-DD'), to_char((now() at time zone 'Asia/Tokyo'), 'YYYY-MM'))`;
}

/** 利用者IDのパラメータ（例 `$1`）から期間キーを引くサブクエリ。 */
export function usagePeriodKeySql(userIdParam: string): string {
  return `(select ${usagePeriodKeyExpr("p")} from profiles p where p.id = ${userIdParam})`;
}

/**
 * 枠がリセットされる日時（timestamptz 式）。期間が未同期なら null（画面は日付を作らず
 * 「次回の更新日」と書く）。トライアル中は**トライアル終了日**＝そこで枠が戻る（D-38 再決定）。
 */
export function usageResetsAtExpr(p: string): string {
  return `(case when ${p}.current_period_start is null then null else ${p}.current_period_end end)`;
}

/** 期間キーを1回だけ読み、以後はパラメータで渡す（同一transaction内の複数SQLで同じ値を使うため）。 */
export async function currentUsagePeriodKey(db: Queryable, userId: string): Promise<string> {
  const { rows } = await db.query<{ key: string }>(`select ${usagePeriodKeySql("$1")} as key`, [userId]);
  const key = rows[0]?.key;
  if (!key) throw new Error(`usage period key unavailable for user ${userId}`);
  return key;
}
