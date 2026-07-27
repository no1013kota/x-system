import { z } from "zod";

import { weightedLength } from "@/lib/text/weighted-length";

/**
 * SYS-GEN の出力契約（プロンプト設計書 §6.1/§7.1）と draft.thread への変換（要件02 §4.7, T-M3-05）。
 * 出力は {posts: string[], sources: string[], error: string|null}。生成不可時は error に理由が入る。
 */

/**
 * providerの引用マークアップを本文から取り除く。
 *
 * Web検索を使う実行では、Anthropicが `<cite index="8-1">…</cite>` を**JSON文字列の中に**
 * 書いて返すことがある（2026-07-27 のP-6実測で4組混入）。そのまま下書きにするとXへタグが
 * そのまま投稿され、`weighted_length` もタグ込みで数えるため文字数判定が狂う。引用元URLは
 * `sources` とcitationsから別途取るので、本文側のタグは落としてよい。
 *
 * 落とすのは引用タグだけに限る（本文に出得る `<` を巻き込まないため）。
 */
export function stripProviderMarkup(text: string): string {
  return text.replace(/<\/?cite\b[^>]*>/gi, "").trim();
}

export const genOutputSchema = z.object({
  // 検証の時点で正規化し、以降（文字数チェック・NG照合・下書き保存）は常に清書済みを見る。
  posts: z.array(z.string().transform(stripProviderMarkup)),
  sources: z.array(z.string()),
  error: z.string().nullable(),
});

export type GenOutput = z.infer<typeof genOutputSchema>;

/** draft.thread / initial_thread の要素（要件02 §4.7）。 */
export interface ThreadItem {
  local_id: string;
  text: string;
  weighted_length: number;
  sources: string[];
  warnings: string[];
}

/**
 * posts[] を thread 要素へ変換する。各ポストの weighted_length を算出し、出典URLは最終ポストへ付ける
 * （プロンプト設計書 §6 「最終ポスト=まとめ＋出典URL」。URLのSSRF検証・付加はT-M3-06が担う）。
 */
export function postsToThread(posts: string[], sources: string[]): ThreadItem[] {
  return posts.map((text, index) => ({
    local_id: `p${index + 1}`,
    text,
    weighted_length: weightedLength(text),
    sources: index === posts.length - 1 ? sources : [],
    warnings: [],
  }));
}
