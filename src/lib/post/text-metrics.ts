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
export const MAX_CASHTAGS = 1;

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
export function measurePostText(text: string): PostTextMetrics {
  const weighted = parseTweet(text).weightedLength;
  const cashtagCount = extractCashtags(text).length;
  return {
    weightedLength: weighted,
    withinLimit: weighted <= MAX_WEIGHTED_LENGTH,
    cashtagCount,
    cashtagOk: cashtagCount <= MAX_CASHTAGS,
    empty: text.trim().length === 0,
  };
}
