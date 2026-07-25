/**
 * Post pattern (p1〜p6) → Japanese label. Single source for the badge labels
 * shown on drafts / history / analytics / confirmation views (and the base of
 * the prompt-template kind labels). Note: the labelled dropdown options in
 * schedule-manager and the description-carrying maps elsewhere are intentionally
 * separate.
 */
export const POST_PATTERN_LABELS: Record<string, string> = {
  p1: "ニュース解説",
  p2: "自分の考え",
  p3: "ノウハウ",
  p4: "トレンド便乗",
  p5: "引用ポスト",
  p6: "週次まとめ",
};
