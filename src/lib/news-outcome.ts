/**
 * ニュース取得結果の**判定の単一の正本**（T-M8-83）。
 *
 * 「取得窓より古いだけの除外」を良性として扱う判定が、以前は
 * `smoke/scenarios.ts` と `ops/diagnostics.ts` に**同じ内容で二重に書かれ**、
 * `ops/daily-summary.ts` の抽出SQLには**入っていなかった**。その結果、
 * まったく同じ状況を doctor は「該当ニュースが無かったテーマ」、
 * 日次サマリは「**全件破棄されたテーマ**」として運営者へ通知していた。
 *
 * 新しい記事が無い日は普通にあるため、この誤報は繰り返し届く。
 * T-M7-44 で「直せない理由で赤くすると、その表示は読まれなくなり本物の異常を隠す」と
 * 決めた当のものを、通知側が壊していた。判定はここだけに置く。
 *
 * このモジュールは**依存を持たない**（DB・env・providerを触らない）。
 * 診断・通知・スモークのどこからでも読めるようにするため。
 */

/** 取得窓より古くて捨てた、を表す除外理由キー。 */
export const REASON_TOO_OLD = "published_at:too_old";

/**
 * 除外理由マップに混ぜる**付随情報**キーの接頭辞。
 *
 * 除外の件数だけでは「境界を1〜2時間越えただけ」なのか「数か月前の記事だった」のかが
 * 区別できず、対策の判断ができなかった（T-M8-83）。`drop_reasons` は jsonb なので
 * 列を増やさずに済むが、理由の数え上げと混ざらないよう接頭辞で分ける。
 */
export const META_PREFIX = "_";

/** 除外理由だけを取り出す（`_` で始まる付随情報を除く）。 */
export function reasonEntries(reasons: Record<string, number>): [string, number][] {
  return Object.entries(reasons).filter(([key]) => !key.startsWith(META_PREFIX));
}

/**
 * 除外理由が「取得窓より古い」だけかどうか（T-M7-44）。
 *
 * `published_at:too_old` は**応答が壊れているのではなく、その時間帯に新しい記事が
 * 無かった**だけ。運営者に直せるものは無い。一方 `title:too_big` のような契約違反は
 * プロンプトか検証条件の不具合なので直す必要がある。
 * **同じ「0件」でも意味が違うので分けて扱う。**
 */
export function onlyOutsideWindow(reasons: Record<string, number>): boolean {
  const keys = reasonEntries(reasons).map(([key]) => key);
  return keys.length > 0 && keys.every((key) => key === REASON_TOO_OLD);
}

/** 除外理由を1行に畳む（ログ・スモーク・通知の表示用）。付随情報は出さない。 */
export function formatDropReasons(reasons: Record<string, number>): string {
  return reasonEntries(reasons)
    .sort((a, b) => b[1] - a[1])
    .map(([key, n]) => `${key}×${n}`)
    .join(", ");
}

/** 捨てた記事が何時間古かったかの範囲（`_` 付きで `drop_reasons` に載る）。 */
export const META_TOO_OLD_MIN_AGE_H = `${META_PREFIX}too_old_min_age_h`;
export const META_TOO_OLD_MAX_AGE_H = `${META_PREFIX}too_old_max_age_h`;

/**
 * 「古すぎる」で捨てた記事の古さを、運営者が読める1行にする。
 * 境界すぐ外（あと数時間広げれば入る）と、そもそも古い記事しか無かった場合を区別するため。
 */
export function formatTooOldAges(reasons: Record<string, number>): string | null {
  const min = reasons[META_TOO_OLD_MIN_AGE_H];
  const max = reasons[META_TOO_OLD_MAX_AGE_H];
  if (typeof min !== "number" || typeof max !== "number") return null;
  const fmt = (h: number) => (h >= 48 ? `${Math.round(h / 24)}日` : `${Math.round(h)}時間`);
  return min === max ? `${fmt(min)}前` : `${fmt(min)}〜${fmt(max)}前`;
}

/**
 * 取得できてはいるが**大半が落ちている**状態か（T-M8-83）。
 *
 * これまで `doctor` は `fetched > 0` の分野を検査せず素通りし、日次サマリの抽出条件も
 * `fetched = 0` だったため、**日に30件から3件へ静かに減っても運営者は気付けなかった**
 * （CLAUDE.md 原則1）。1回の実行で判定するとノイズになるので、
 * 「除外が取得より多い」という粗い条件だけを見る。
 */
export function mostlyDropped(fetched: number, dropped: number): boolean {
  return fetched > 0 && dropped > fetched;
}
