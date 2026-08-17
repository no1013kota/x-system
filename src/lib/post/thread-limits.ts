/**
 * パターン別の**生成時**ポスト数上限（T-M7-41）。
 *
 * プロンプト（プロンプト設計書 §6）でスレッドの長さを指示しているが**守られない**
 * （2026-08-01 実測: P-6は「3〜5ポスト」の指示に対し6ポスト）。日本のXでは長いスレッドの
 * 離脱が大きいため、指示ではなくコードで上限を担保する（§2 原則5）。
 *
 * 上限は各プロンプトの分量指示の上端に合わせる。超過分は落とすが、**スレッドの締めは残す**
 * （締めが消えると読み手が宙ぶらりんになる）。落としたことは警告で運営者へ知らせる。
 */

/**
 * `PATTERN_MAX_POSTS`（要件06 §4.3）とは役割が違う。
 * - `PATTERN_MAX_POSTS` = **編集で許す上限**と**日次枠の見積り**。既存の下書きを無効にしないため広く保つ。
 * - `GENERATION_MAX_POSTS` = **生成時に収める上限**。伸びやすさのために短くする。常に前者以下。
 */
export const GENERATION_MAX_POSTS: Readonly<Record<string, number>> = {
  p1: 4, // ニュース解説（2〜4）
  p2: 1, // 自分の考え（単発）
  p3: 6, // ノウハウ（4〜6）
  p4: 2, // トレンド便乗（1〜2）
  p5: 3, // 引用ポスト（1〜3）
  p6: 5, // 週次まとめ（3〜5）
};

/** 未知パターンの既定上限（既存の挙動を壊さない広さ）。 */
export const DEFAULT_MAX_POSTS = 8;

export function maxPostsFor(pattern: string): number {
  return GENERATION_MAX_POSTS[pattern] ?? DEFAULT_MAX_POSTS;
}

export interface CapPostCountResult {
  posts: string[];
  /** 落としたポスト数（0なら上限内）。 */
  dropped: number;
}

/**
 * ポスト数を上限へ収める。**先頭 max-1 件＋最後の1件**を残す（締めを保つ）。
 * 上限が1なら先頭1件だけを残す。
 *
 * 上限は**パターンの設定から渡す**（T-M8-129 U2）。以前はパターンID（`p1`）で
 * 引いていたが、利用者が作ったパターンはIDを持たないため値で受ける。
 */
export function capPostCount(maxPosts: number, posts: readonly string[]): CapPostCountResult {
  const max = maxPosts >= 1 ? maxPosts : DEFAULT_MAX_POSTS;
  if (posts.length <= max) return { posts: [...posts], dropped: 0 };
  const kept = max === 1 ? [posts[0]] : [...posts.slice(0, max - 1), posts[posts.length - 1]];
  return { posts: kept, dropped: posts.length - kept.length };
}
