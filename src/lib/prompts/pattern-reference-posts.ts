import { normalizeLearningUrl } from "@/lib/learning-sources";

/**
 * 「参考投稿からAIで作る」の材料を本文へ揃える（T-M8-399・運営者の報告 2026-09-01）。
 *
 * 記入欄には**本文の貼り付け**と**X投稿のURL**のどちらも入る。URLをそのままAIへ渡すと
 * 「参考投稿がURLのみで本文内容を取得できず」と断られる（実際に起きた）。ここでURLを
 * X APIで本文へ引き直し、AIには本文だけを渡す。
 *
 * - 純粋層: X読取は `fetchTweets` として注入する（token・台帳・HTTPは呼び出し側の配線）。
 * - **読めなかったURLは黙って落とさない**（原則1）。どのURLがなぜ読めなかったかを理由に載せ、
 *   読めた分だけで生成しない——欠けた材料で作った型は利用者の意図とずれる。
 */

export type ReferenceEntry =
  | { kind: "text"; text: string }
  | { kind: "url"; raw: string; url: string; tweetId: string }
  | { kind: "invalid_url"; raw: string };

/** 記入欄の内容が「URLだけ」かどうか（本文の中にリンクが混ざっているものは本文扱い）。 */
const URL_ONLY_RE = /^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:x|twitter)\.com\/\S+$/i;
const GENERIC_URL_RE = /^https?:\/\/\S+$/i;

/** 1件の記入内容を「本文」「X投稿のURL」「読めないURL」へ分類する。 */
export function classifyReferenceEntry(raw: string): ReferenceEntry {
  const value = raw.trim();
  if (URL_ONLY_RE.test(value)) {
    const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    const url = normalizeLearningUrl("ref_post", withScheme);
    if (!url) return { kind: "invalid_url", raw: value };
    const tweetId = url.slice(url.lastIndexOf("/") + 1);
    return { kind: "url", raw: value, url, tweetId };
  }
  // X以外のURLだけの行は本文にならない（ブログ等の本文は取りに行かない）。
  if (GENERIC_URL_RE.test(value)) return { kind: "invalid_url", raw: value };
  return { kind: "text", text: value };
}

export type ResolvedReferencePosts =
  | { ok: true; posts: string[]; tweetIds: string[] }
  | { ok: false; reason: string; tweetIds: string[] };

/**
 * 記入欄の内容を本文の配列へ揃える。URLは `fetchTweets` で本文へ引き直す
 * （id → 本文。返らなかった・空のものは読めなかった扱い）。順序は記入どおり。
 */
export async function resolveReferencePosts(
  entries: string[],
  fetchTweets: (tweetIds: string[]) => Promise<Map<string, string | null>>,
): Promise<ResolvedReferencePosts> {
  const classified = entries.map(classifyReferenceEntry);
  const invalid = classified.filter((e): e is Extract<ReferenceEntry, { kind: "invalid_url" }> => e.kind === "invalid_url");
  if (invalid.length > 0) {
    return {
      ok: false,
      tweetIds: [],
      reason:
        `読めるURLはX投稿のURL（https://x.com/ユーザー名/status/番号）だけです。` +
        `本文を貼り付けるか、投稿のURLを入れてください: ${invalid.map((e) => e.raw).join(" ")}`,
    };
  }
  const urls = classified.filter((e): e is Extract<ReferenceEntry, { kind: "url" }> => e.kind === "url");
  const tweetIds = [...new Set(urls.map((e) => e.tweetId))];
  const texts = tweetIds.length > 0 ? await fetchTweets(tweetIds) : new Map<string, string | null>();

  const unreadable: string[] = [];
  const posts: string[] = [];
  for (const entry of classified) {
    if (entry.kind === "text") {
      posts.push(entry.text);
      continue;
    }
    if (entry.kind !== "url") continue; // invalid は上で返している
    const text = texts.get(entry.tweetId)?.trim();
    if (!text) {
      unreadable.push(entry.url);
      continue;
    }
    posts.push(text);
  }
  if (unreadable.length > 0) {
    return {
      ok: false,
      tweetIds,
      reason:
        `次の投稿を読み取れませんでした（非公開・削除済み・または連携中のXアカウントで閲覧できない投稿）。` +
        `本文を貼り付けるか、別の投稿にしてください: ${unreadable.join(" ")}`,
    };
  }
  return { ok: true, posts, tweetIds };
}
