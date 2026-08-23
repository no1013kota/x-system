import type { Queryable } from "../db/queryable";

/**
 * 利用枠の「期間キー」（T-M8-258）。
 *
 * 利用枠（AIクレジット・通常投稿・URL付き投稿）は**契約期間＝請求期間**ごとに数える。キーは
 * 期間の開始日の **JST 日付 `YYYY-MM-DD`**。更新日に新しい期間キーの行が 0 から始まるので、
 * 月初リセットのjobは要らない（要件03 §7.2）。
 *
 * **トライアルは最初の有料期間と1つの枠を共有する**（運営者の指示 2026-08-23・要決定D-36）。
 * Stripe はトライアルを独立した期間（`current_period_end = trial_end`）として扱い、有料化の日に
 * `current_period_start = trial_end` の新しい期間を始めるが、そのまま期間キーにすると
 * 7日間のトライアルで満額を使い、有料化の日にもう一度満額へ戻る。そこで
 * 「トライアル中」または「トライアル終了日から始まった期間」のあいだは、期間の開始を
 * `trial_used_at`（トライアル開始）に読み替える。2回目以降の有料期間は通常どおり。
 *
 * **未同期（`current_period_start` が null）のあいだは従来の JST 暦月 `YYYY-MM`** で数える。
 * webhook が遅れて期間が更新されないときは**前の期間キーのまま数え続ける**（勝手にリセットされない）。
 * 実行そのものの停止は期限切れ判定（`isSubscriptionPeriodStale`・T-M8-235）が担う。
 *
 * 列名は歴史的に `month` のまま（`usage_events.month` / `usage_counters.month`）。
 */

/** 利用枠の期間の開始（timestamptz 式）。`p` は profiles の別名。 */
export function usagePeriodStartExpr(p: string): string {
  return `(case
      when ${p}.trial_ends_at is not null and ${p}.trial_used_at is not null
           and (${p}.current_period_end = ${p}.trial_ends_at or ${p}.current_period_start = ${p}.trial_ends_at)
        then ${p}.trial_used_at
      else ${p}.current_period_start
    end)`;
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
 * 枠がリセットされる日時（timestamptz 式）。期間が未同期なら null。**トライアル中も null**——
 * リセットはトライアル終了ではなく最初の有料期間の終わりで、その日時は有料化まで Stripe から分からない
 * （画面は日付を作らず「次回の更新日」と書く）。
 */
export function usageResetsAtExpr(p: string): string {
  return `(case
      when ${p}.current_period_start is null then null
      when ${p}.trial_ends_at is not null and ${p}.current_period_end = ${p}.trial_ends_at then null
      else ${p}.current_period_end
    end)`;
}

/** 期間キーを1回だけ読み、以後はパラメータで渡す（同一transaction内の複数SQLで同じ値を使うため）。 */
export async function currentUsagePeriodKey(db: Queryable, userId: string): Promise<string> {
  const { rows } = await db.query<{ key: string }>(`select ${usagePeriodKeySql("$1")} as key`, [userId]);
  const key = rows[0]?.key;
  if (!key) throw new Error(`usage period key unavailable for user ${userId}`);
  return key;
}
