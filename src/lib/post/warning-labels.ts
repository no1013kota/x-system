import type { WarningCode } from "./warning-codes";

/**
 * 生成物に付く警告の**画面表示**（F1）。
 *
 * 以前は `app/app/posts/drafts-list.tsx` の中に手書きされていた。`.tsx` は単体テストの網
 * （environment: node・include `src/**\/*.test.ts`）に入らないため、**正本の `WARNING` に
 * コードを足してここへ足し忘れても、どのゲートも落ちない**。実際に `length_over_target` と
 * `post_count_trimmed` が抜けており、その警告が付いた下書きでは**バッジに生の英語コードが
 * そのまま出ていた**。
 *
 * 再発しない形にするため、下の `satisfies` を通す。`WARNING` にコードを足して
 * ここへ足し忘れると `npm run typecheck` が止まる。
 */

/** バッジに出す短い名前。`image_failed` は画面固有（検証の警告ではなく画像生成の結果）。 */
const LABELS = {
  length_exceeded: "文字数超過",
  cashtag_multiple: "$タグ2件以上",
  ng_word: "NGワード",
  source_missing: "出典なし",
  injection_suspected: "要確認",
  length_over_target: "長め",
  post_count_trimmed: "ポスト数を調整",
  image_failed: "画像なし（生成失敗）",
} satisfies Record<WarningCode | "image_failed", string>;

/** 投稿前の確認で「何が起きるか」を伝える説明文（バッジだけでは分からないため）。 */
const DETAILS = {
  length_exceeded: "280字を超えています",
  cashtag_multiple: "$タグが2件以上あります",
  ng_word: "NG設定の語が含まれています",
  source_missing: "出典URLがありません",
  injection_suspected: "不審な指示が混じっている可能性があります",
  length_over_target: "読みやすさの目安（約120字）より長めです",
  post_count_trimmed: "長すぎたため途中のポストを省いています",
} satisfies Partial<Record<WarningCode | "image_failed", string>>;

// 索引は `Record<string, string>` で公開する（未知コードは呼び出し側が `?? code` で素通しする）。
export const WARNING_LABEL: Record<string, string> = LABELS;
export const WARNING_DETAIL: Record<string, string> = DETAILS;

/** 「2ポスト目にNGワード」のような要約を作る。 */
export function warningSummary(thread: { warnings: string[] }[]): string[] {
  const lines: string[] = [];
  thread.forEach((post, index) => {
    for (const code of post.warnings) {
      lines.push(`${index + 1}ポスト目: ${WARNING_DETAIL[code] ?? WARNING_LABEL[code] ?? code}`);
    }
  });
  return lines;
}
