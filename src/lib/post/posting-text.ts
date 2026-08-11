/**
 * 投稿するときの**本文の最終形と、そこから決まる課金区分・冪等key**の正本（R24）。
 *
 * 投稿は2つの経路から確定する。通常の投稿job（`jobs/post-publish.ts`）と、結果が不明に
 * 終わった投稿を後から突き合わせる経路（`reconcile-posting.ts`）である。この2つが
 * **同じ3点を別々に定義していた**。
 *
 * 1. URL判定（`/https?:\/\/\S+/`）
 * 2. 引用URLを末尾に合成した「最終text」
 * 3. 利用枠を1回だけ数えるための冪等key
 *
 * 3点はすべて**一致していなければならない**。URL判定がずれれば同じ投稿が経路によって
 * `post_url` と `post_normal` に分かれて**課金区分が変わる**。冪等keyがずれれば
 * **同じ投稿を二重に数える**。最終textがずれれば、突き合わせのときに同じ投稿を
 * 別物と判定して再送しかねない。
 *
 * NOTE: `jobs/suggestion-input.ts` の `hasUrl` は**別物**（分析軸の集計用で、こちらは
 * 課金用）。判定が変わると分析結果が変わるため統合しない。
 */

/** 本文にURLが含まれるか（X APIの課金区分 post_url / post_normal を決める）。 */
const URL_RE = /https?:\/\/\S+/;

export function hasUrl(text: string): boolean {
  return URL_RE.test(text);
}

/**
 * 実際にXへ送る本文。P-5等では1ポスト目の末尾に引用URLを合成する（要件04 §10 step5）。
 * counter_type の判定・長さ検証・突き合わせは、すべてこの最終形に対して行う。
 */
export function finalPostText(
  thread: { text: string }[],
  index: number,
  quoteUrl: string | null | undefined,
): string {
  return index === 0 && quoteUrl ? `${thread[index].text}\n${quoteUrl}` : thread[index].text;
}

/** `finalPostText` を draft に束縛した形（呼び出し側は index だけ渡す）。 */
export function finalTextResolver(
  thread: { text: string }[],
  quoteUrl: string | null | undefined,
): (index: number) => string {
  return (index) => finalPostText(thread, index, quoteUrl);
}

/** 本文から利用枠の種別を決める。 */
export function counterTypeFor(text: string): "post_url" | "post_normal" {
  return hasUrl(text) ? "post_url" : "post_normal";
}

/**
 * 投稿の作成・削除を1回だけ数えるための冪等key。
 * 投稿job と突き合わせ経路の**どちらから確定しても同じ key** になる必要がある。
 */
export function postConsumeKey(
  draftId: string,
  tweetId: string,
  operation: "post_create" | "post_delete",
): string {
  return `draft:${draftId}:tweet:${tweetId}:post:${operation === "post_create" ? "create" : "delete"}`;
}
