import { POST_PATTERN_OPTIONS, QUOTE_PATTERN_OPTION } from "./post-patterns";

/**
 * パターン（p1〜p6）→ 日本語ラベル。下書き・履歴・分析・投稿確認のバッジと、
 * プロンプトテンプレートの種別ラベルの土台に使う。
 *
 * **選択肢の定義（`post-patterns.ts`）から引く**（T-M8-29）。以前はここに短縮版
 * （「自分の考え」「ノウハウ」）を別に持っていて、**選ぶ画面と表示する画面でラベルが違っていた**。
 * 選んだものと違う名前が出ると、利用者は別のものだと思う。
 */
export const POST_PATTERN_LABELS: Record<string, string> = Object.fromEntries(
  [...POST_PATTERN_OPTIONS, QUOTE_PATTERN_OPTION].map((p) => [p.id, p.label]),
);
