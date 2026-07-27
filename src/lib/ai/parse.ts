import type { ZodType } from "zod";

/**
 * 生成結果のJSON検証（プロンプト設計書 §7.1）。応答からJSON部分を取り出してzodで検証する。
 *
 * Web検索（server tool）を併用する実行では、プロンプトで「JSONのみ」と指示してもproviderは
 * 前後に説明文を付ける。2026-07-27 のP-6実測では
 *   1回目: 「news_digestが空のため、Web検索で…」＋ ```json {...} ```
 *   2回目（修復指示付き）: 「Web検索で直近7日間の…調査します。」＋ 素の {...}
 * のように、**JSON自体は正しいのに前置きがあるだけ**で検証に落ちていた。修復指示の追加callでも
 * 消えないため、指示ではなくコード側の抽出で吸収する（§2 原則5「出力形式は仕組みで保証する」）。
 */

export type ParseResult<T> = { ok: true; value: T } | { ok: false };

/** 先頭・末尾のコードフェンスを取り除く（```json / ``` のどちらも）。 */
export function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const m = trimmed.match(/^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```$/);
  return m ? m[1].trim() : trimmed;
}

/** テキスト中のコードフェンスブロックを出現順に返す（文字列全体を包んでいなくてよい）。 */
function fencedBlocks(text: string): string[] {
  const blocks: string[] = [];
  const re = /```[a-zA-Z]*\s*\n?([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) blocks.push(m[1].trim());
  return blocks;
}

/**
 * `open` から対応する閉じ括弧までを、文字列リテラルとエスケープを考慮して切り出す。
 * ポスト本文に `{` `}` や `"` が含まれても壊れないよう、深さは文字列の外だけで数える。
 */
function balancedSlice(text: string, open: "{" | "["): string | null {
  const close = open === "{" ? "}" : "]";
  const start = text.indexOf(open);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** 検証にかける候補を、確実なものから順に並べる。 */
function candidates(text: string): string[] {
  const fenced = fencedBlocks(text);
  const found = [text, stripCodeFence(text), ...fenced];
  // 前置き付きの素のJSON。フェンス内が前置きを含む場合もあるので両方を走査する。
  for (const source of [text, ...fenced]) {
    for (const open of ["{", "["] as const) {
      const sliced = balancedSlice(source, open);
      if (sliced) found.push(sliced);
    }
  }
  // 空文字と重複を落とす（同じ候補を何度もzodへ通さない）。
  return [...new Set(found.map((c) => c.trim()).filter(Boolean))];
}

/**
 * 応答テキストからJSONを取り出してzod検証する。生テキスト → フェンス除去 → テキスト中の
 * フェンスブロック → 釣り合った括弧の切り出し、の順に試し、最初に検証を通ったものを返す。
 * どれも通らなければ ok:false（呼び出し側が修復call・終端エラーを判断する）。
 */
export function parseAndValidate<T>(
  text: string,
  schema: ZodType<T>,
): ParseResult<T> {
  for (const candidate of candidates(text)) {
    let json: unknown;
    try {
      json = JSON.parse(candidate);
    // eslint-disable-next-line no-restricted-syntax -- 候補を順に試す走査。parse失敗は次候補へ進む正常系
    } catch {
      continue;
    }
    const result = schema.safeParse(json);
    if (result.success) return { ok: true, value: result.data };
  }
  return { ok: false };
}
