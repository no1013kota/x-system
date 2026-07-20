import { extractCashtags, parseTweet } from "twitter-text";

/**
 * X (Twitter) weighted-length utilities (PRD §8.1, 要件05 §12, プロンプト設計書 §7,
 * 要件02 §4.7). Wraps the official `twitter-text` so weighted-length rules —
 * URLs as t.co fixed length, CJK/emoji weighting — stay consistent across
 * draft.thread validation and the PT-FIX (280 超過) check.
 */

/** Default per-post weighted-length limit. */
export const MAX_WEIGHTED_LENGTH = 280;

/** Weighted length of a single post (URLs counted as t.co fixed length). */
export function weightedLength(text: string): number {
  return parseTweet(text).weightedLength;
}

/** True when the post exceeds the weighted-length limit (empty is within). */
export function exceedsWeightedLimit(
  text: string,
  limit: number = MAX_WEIGHTED_LENGTH,
): boolean {
  return weightedLength(text) > limit;
}

/** True when the post is non-empty and within the weighted-length limit. */
export function isWithinWeightedLimit(
  text: string,
  limit: number = MAX_WEIGHTED_LENGTH,
): boolean {
  const len = weightedLength(text);
  return len > 0 && len <= limit;
}

/** Number of cashtags ($TICKER) in the post (要件02: 自動投稿は cashtag 1件まで). */
export function countCashtags(text: string): number {
  return extractCashtags(text).length;
}
