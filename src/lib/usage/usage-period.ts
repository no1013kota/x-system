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

/**
 * 期間キーのSQL式。`p` は profiles の別名（例 `p`）。
 *
 * **世代（`usage_epoch`）が付く**（T-M8-299）。トライアル中に下位プランへ切り替えたときのように
 * **期間の途中で枠をリセットする**場合、Stripe は `current_period_start` を動かさない
 * （2026-08-25 実測）ので日付だけでは区切れない。世代を足すと同じ日でも必ず別のキーになる。
 * `0` のあいだは従来と同じ文字列なので、既存の利用者の枠は動かない。
 */
export function usagePeriodKeyExpr(p: string): string {
  const base = `coalesce(to_char((${usagePeriodStartExpr(p)} at time zone 'Asia/Tokyo'), 'YYYY-MM-DD'), to_char((now() at time zone 'Asia/Tokyo'), 'YYYY-MM'))`;
  return `(${base} || case when coalesce(${p}.usage_epoch, 0) > 0 then '#' || ${p}.usage_epoch else '' end)`;
}

/**
 * **枠を今すぐリセットする**（T-M8-299）。世代を1つ進めるだけ——`usage_events` は消さないので
 * 原価の台帳は残り、集計だけが0から数え直しになる。
 */
export function bumpUsageEpochSql(userIdParam: string): string {
  return `update profiles set usage_epoch = usage_epoch + 1 where id = ${userIdParam}`;
}

/**
 * **リセットを巻き戻す**（T-M8-306）。トライアル中に下位へ下げてリセットした人が、
 * そのまま上位へ戻したときに呼ぶ。世代を1つ戻す。
 *
 * これが往復を閉じる仕組み: 世代は 0→1→0→1 と**同じ番号を行き来する**ので、戻った先には
 * その世代の `usage_counters` 行がそのまま残っている。つまり
 * 「上げ直す→下げ直す」を繰り返しても、各世代の消費は積み上がったままで、
 * **プランごとに1回ぶんの枠しか使えない**（上位で使い切ってから下げても、下位の枠は
 * 前回そこで使った分から続きになる）。
 *
 * `greatest(...,0)` は、下げたことが無い利用者が上位へ変えたときに負にしないため
 * （`usage_epoch >= 0` のcheck制約に触れる）。
 */
export function restoreUsageEpochSql(userIdParam: string): string {
  return `update profiles set usage_epoch = greatest(usage_epoch - 1, 0) where id = ${userIdParam}`;
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
