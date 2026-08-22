// twitter-text の ESM ビルドは default export のみ（名前付きexportなし）。
// Turbopack build と vitest の双方で解決できるよう default import で受ける。
import twitterText from "twitter-text";

const { extractCashtags, parseTweet } = twitterText;

/**
 * 投稿本文の加重文字数・cashtag計測（要件05 §12・プロンプト設計書 §7, PRD §8.1, T-M3-01）。
 * 公式 twitter-text 互換（CJK重み2・URLはt.co固定長23・絵文字ZWJ結合を考慮）。生成検証・下書き
 * 編集・投稿実行の全段で共用する純粋関数。
 */

export const MAX_WEIGHTED_LENGTH = 280;

/**
 * X Premium（verified_type=blue/business）の上限（T-M8-221）。Xの実仕様は「25,000文字」で
 * 加重換算ではないが、加重値で判定すれば常に実上限より短くなる（CJKは半分）ため安全側。
 */
export const PREMIUM_MAX_WEIGHTED_LENGTH = 25_000;

/** アカウントのX Premium加入有無から、そのポストの加重上限を返す。 */
export function maxWeightedLengthFor(premium: boolean): number {
  return premium ? PREMIUM_MAX_WEIGHTED_LENGTH : MAX_WEIGHTED_LENGTH;
}
export const MAX_CASHTAGS = 1;

/**
 * 読みやすさの目標上限（加重240＝日本語で約120字）。**契約ではなく品質目標**（T-M7-41）。
 *
 * 加重280（約140字）まで書けるが、上限まで詰めた投稿は読まれない。プロンプトで「60〜120字」と
 * 指示しても守られないことを実測した（2026-08-01、`smoke:live` で139〜140字）。
 * 「出力形式は指示ではなく仕組みで保証する」（プロンプト設計書 §2 原則5）に従い、超過分は
 * PT-FIXで1回だけ縮める。縮められなくても失敗にはしない（自動投稿も止めない）。
 */
export const TARGET_WEIGHTED_LENGTH = 240;

/**
 * 短縮しすぎの下限（加重100＝日本語で約50字）。PT-FIXが内容を削り過ぎた場合は元の本文を使う。
 * 長いことより、意味が壊れることの方が害が大きい。
 */
export const MIN_SHORTENED_WEIGHTED_LENGTH = 100;

export interface PostTextMetrics {
  weightedLength: number;
  withinLimit: boolean;
  cashtagCount: number;
  cashtagOk: boolean;
  empty: boolean;
}

/** 公式 twitter-text の加重文字数。 */
export function weightedLength(text: string): number {
  return parseTweet(text).weightedLength;
}

/** cashtag（$SYMBOL）の件数。 */
export function countCashtags(text: string): number {
  return extractCashtags(text).length;
}

/**
 * 投稿本文を計測する。`withinLimit`は加重280以下、`cashtagOk`はcashtag1件以下（2件以上は自動投稿
 * ブロック対象, プロンプト設計書 §7）、`empty`は空白のみ（投稿本文は空不可, 要件05 §12）。
 */
export function measurePostText(
  text: string,
  limit: number = MAX_WEIGHTED_LENGTH,
): PostTextMetrics {
  const weighted = parseTweet(text).weightedLength;
  const cashtagCount = extractCashtags(text).length;
  return {
    weightedLength: weighted,
    withinLimit: weighted <= limit,
    cashtagCount,
    cashtagOk: cashtagCount <= MAX_CASHTAGS,
    empty: text.trim().length === 0,
  };
}

/**
 * 投稿直前の長さ再検証（T-M8-39）。上限を超えた**最初の**ポストを返す。
 *
 * **X APIは加重280超過を400で拒否する。** スレッドは1ポストずつ作るので、3本目で拒否されると
 * **1〜2本目はX上に残ったまま**になり、取り返しがつかない（reconcileが必要な状態）。
 * したがって「1本でも超過していたら1本も作らない」を投稿実行の入口で判定する。
 *
 * 保存済みの `weighted_length` や警告ではなく**そのとき投稿する本文**から測り直す。理由は2つ。
 * P-5は引用URLを1本目の末尾へ合成するため保存値より長くなる。また保存値は編集や
 * 検証ロジックの変更で古くなり得るが、Xが見るのは本文そのものである。
 */
export function findOverLengthText(
  texts: readonly string[],
  limit: number = MAX_WEIGHTED_LENGTH,
): { index: number; weightedLength: number } | null {
  for (const [index, text] of texts.entries()) {
    const weighted = weightedLength(text);
    if (weighted > limit) return { index, weightedLength: weighted };
  }
  return null;
}
