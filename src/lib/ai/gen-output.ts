import { z } from "zod";

import { weightedLength } from "@/lib/text/weighted-length";

/**
 * SYS-GEN の出力契約（プロンプト設計書 §6.1/§7.1）と draft.thread への変換（要件02 §4.7, T-M3-05）。
 * 出力は {posts: string[], sources: string[], error: string|null}。生成不可時は error に理由が入る。
 */

export const genOutputSchema = z.object({
  posts: z.array(z.string()),
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
