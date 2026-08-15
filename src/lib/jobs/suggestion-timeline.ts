/**
 * 投稿分析のタイムライン増分取得（T-M8-94）。LLM・DB・X APIを使わない純粋な判定だけを持つ。
 *
 * 方針（運営者の指示・2026-08-15）:
 * - 初回は直近30日をまとめて取得（最大100件＝X読取費用の上限$0.50）
 * - 2回目以降は**追加投稿分だけ**取得する。ただし直近の投稿はメトリクス（表示回数等）が
 *   まだ伸びている途中なので、保存済みの最新投稿から**48時間の重なり**を持って取り直し、
 *   upsertでメトリクスを更新する（重なりが無いと「取得した朝の値」で凍結され、
 *   前日夜の投稿が実際より小さく見え続ける）
 * - 分析は保存済みの**全投稿**を対象にする。ただしLLMへ渡すのは新しい順に
 *   `SUGGEST_ANALYZE_MAX` 件まで（入力が際限なく育つとAI費用と文脈が破綻する）
 */

export const TIMELINE_BACKFILL_DAYS = 30;
/** 1回の取得上限。X読取は1件$0.005課金されるため、これが1回の取得費用の上限を決める。 */
export const TIMELINE_FETCH_MAX = 100;
/** 増分取得の重なり（時間）。この範囲の保存済み投稿はメトリクスを取り直して上書きする。 */
export const TIMELINE_REFRESH_OVERLAP_H = 48;
/** LLMへ渡す投稿数の上限（新しい順）。増やすと分析1回のAI費用が比例して増える。 */
export const SUGGEST_ANALYZE_MAX = 300;
/** 保存する本文の長さ。分析に渡すのは先頭200字（suggestion-input.ts）なので余裕を持って500。 */
export const TIMELINE_TEXT_MAX_CHARS = 500;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * X APIへ渡す `start_time` を決める。
 *
 * - 保存が無い（初回）: now - 30日
 * - 保存がある: 最新の保存済み投稿の時刻 - 48時間（重なり分は取り直してメトリクス更新）。
 *   ただし30日より昔へは遡らない（X APIの non_public_metrics 提供範囲の外）
 */
export function timelineFetchStart(newestStoredPostedAt: string | null, nowMs: number): string {
  const backfill = nowMs - TIMELINE_BACKFILL_DAYS * DAY_MS;
  if (!newestStoredPostedAt) return new Date(backfill).toISOString();
  const newest = Date.parse(newestStoredPostedAt);
  if (Number.isNaN(newest)) return new Date(backfill).toISOString();
  const overlapped = newest - TIMELINE_REFRESH_OVERLAP_H * HOUR_MS;
  return new Date(Math.max(overlapped, backfill)).toISOString();
}

/** codepoint単位で先頭n文字（絵文字のサロゲートペアを割らない）。保存用。 */
export function truncateForStore(text: string): string {
  const chars = [...text];
  return chars.length <= TIMELINE_TEXT_MAX_CHARS
    ? text
    : chars.slice(0, TIMELINE_TEXT_MAX_CHARS).join("");
}
