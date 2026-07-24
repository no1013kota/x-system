/**
 * NGワードのコード文字列照合（要件05 §12・プロンプト設計書 §7/§1, L-7, T-M3-01）。
 * LLMを使わずコードで部分一致（大文字小文字を無視）する。検出時は自動投稿をブロックし警告付きで
 * 下書き化する判断に用いる純粋関数。
 */

/** text に含まれる NG ワードを（入力順・重複排除して）返す。 */
export function matchNgWords(text: string, ngWords: readonly string[]): string[] {
  const haystack = text.toLowerCase();
  const matched: string[] = [];
  const seen = new Set<string>();
  for (const raw of ngWords) {
    const word = raw.trim();
    if (word.length === 0 || seen.has(word)) continue;
    seen.add(word);
    if (haystack.includes(word.toLowerCase())) matched.push(word);
  }
  return matched;
}

export function hasNgWord(text: string, ngWords: readonly string[]): boolean {
  return matchNgWords(text, ngWords).length > 0;
}
