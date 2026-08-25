/**
 * 招待リンクのXシェア文（T-M8-276・運営者の指示 2026-08-23「もっと魅力的かつバズりやすく、
 * 本プロダクトの価値が伝わるものに」）。
 *
 * 書き方の方針:
 * - **宣伝文句ではなく「やめたこと」から入る**。読み手が自分の手間に重ねられる書き出しにする。
 * - **できることを3つだけ**（学習・生成・予約と分析）。並べすぎると読み飛ばされる。
 * - **数字の誇張をしない**（「フォロワーが増える」「必ず」は書かない）。実測していない効果は書けない。
 * - 最後に無料で試せることとリンク。招待の見返りは受け取る側に関係しないので書かない。
 *
 * Xの文字数は**日本語1文字＝2**で数え、URLは長さに関係なく23として扱われる（X公式の重み付け）。
 * 上限280に収まることは `share-text.test.ts` が固定する。
 */

/** Xがリンクを数える固定長（実際のURL長に関わらずこの値）。 */
const URL_WEIGHT = 23;

/** Xの重み付き文字数（日本語などの全角は2、ASCIIは1）。 */
export function weightedLength(text: string): number {
  let total = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    // X の weighted range: U+0000–U+10FF などは 1、それ以外（日本語・絵文字）は 2。
    total += code <= 0x10ff || (code >= 0x2000 && code <= 0x200d) ? 1 : 2;
  }
  return total;
}

/** 招待リンク付きのシェア文。URLは末尾に置く（Xがカードを出す位置）。 */
export function inviteShareText(inviteUrl: string): string {
  return [
    "X運用で毎日ネタを考えるのをやめました。",
    "",
    "Exos AI は",
    "・自分の投稿から伸びる型を学習",
    "・ネタ集めから下書き作成まで自動",
    "・予約投稿と分析までこれ1つ",
    "",
    "使うほどプロンプトが育っていくのが面白い。",
    "7日間無料で試せます👇",
    inviteUrl,
  ].join("\n");
}

/** X の上限（280）に収まるか。URLは23として数える。 */
export function fitsInPost(text: string, urlCount = 1): boolean {
  const withoutUrls = text.replace(/https?:\/\/\S+/g, "");
  return weightedLength(withoutUrls) + URL_WEIGHT * urlCount <= 280;
}
