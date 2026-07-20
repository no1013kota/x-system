import type { ZodType } from "zod";

/**
 * 生成結果のJSON検証（プロンプト設計書 §7.1）。応答をzodスキーマでパースし、失敗時は
 * コードフェンス（```json ... ```）除去→再パースまでを1回の検証で試みる。ここで失敗したら
 * 呼び出し側（pipeline）が修復指示付きprovider callを1回だけ追加する。
 */

export type ParseResult<T> = { ok: true; value: T } | { ok: false };

/** 先頭・末尾のコードフェンスを取り除く（```json / ``` のどちらも）。 */
export function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const m = trimmed.match(/^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```$/);
  return m ? m[1].trim() : trimmed;
}

/**
 * 生テキスト→（失敗時）フェンス除去テキストの順にJSON.parse＋zod検証する。
 * どちらかが通れば ok、両方失敗なら ok:false。
 */
export function parseAndValidate<T>(
  text: string,
  schema: ZodType<T>,
): ParseResult<T> {
  const candidates = [text, stripCodeFence(text)];
  for (const candidate of candidates) {
    let json: unknown;
    try {
      json = JSON.parse(candidate);
    } catch {
      continue;
    }
    const result = schema.safeParse(json);
    if (result.success) return { ok: true, value: result.data };
  }
  return { ok: false };
}
