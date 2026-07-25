import type { Citation } from "./types";

/**
 * URL をキーに Web 検索の引用元を重複排除して集める共通コレクタ（要件02 §4.6 citations）。
 * anthropic / openai / gemini 各アダプタの引用抽出で共有する。最初に現れた URL の title を
 * 採用し（同一 URL の後続 add は無視）、title が無ければ url のみの Citation を作る。
 */
export function createCitationCollector() {
  const byUrl = new Map<string, Citation>();
  return {
    add(url: string | null | undefined, title?: string | null): void {
      if (!url || byUrl.has(url)) return;
      byUrl.set(url, title ? { url, title } : { url });
    },
    values(): Citation[] {
      return [...byUrl.values()];
    },
  };
}
