/**
 * SUGGEST 入力の組み立て（K-2, プロンプト §6.15/§4.2, 要件04 §12, T-M8-91）。
 *
 * 2026-08-15 の刷新で、分析対象を「Exos AIで作った投稿の checkpoint 実績」から
 * **Xタイムラインの直近30日の全投稿**（Exos製かに依らない）へ変えた。固定の分析軸
 * （型×時間帯・長さ・改行・画像・URL）と「3投稿以上・差20%以上」の条件は廃止し、
 * 良かった投稿の特徴づけはLLMの自由分析に任せる（運営者の判断・2026-08-15）。
 *
 * ここはLLMを使わない純粋な整形だけを持つ:
 * - タイムラインの各投稿を `<posts>` 用の1行（本文冒頭・JST日時・実績・画像/URL有無）へ変換する
 * - Exos AIで作った投稿には **型とテーマ** を付ける（drafts の tweet_ids と突合。分からなければ null。
 *   「どの型が伸びたか」をLLMが根拠にできるのはこのタグがある投稿だけ）
 *
 * 取得上限は `SUGGEST_TIMELINE_MAX`（100件）。X読取は応答1件ごとに課金される（$0.005/件）ため、
 * この定数が**1回の分析のX費用の上限**（100×$0.005=$0.50）を決める。変えるときは費用も変わる。
 */

export const SUGGEST_PERIOD_DAYS = 30;
/** タイムライン取得の上限件数 = X読取費用の上限（件数×X_COST_POST_READ_USD）。 */
export const SUGGEST_TIMELINE_MAX = 100;
/** 本文をLLMへ渡す長さ。特徴づけに十分で、100件でも入力が肥大しない値。 */
export const SUGGEST_POST_TEXT_CHARS = 200;

/** タイムラインから来る1投稿（read-client の XRecentPost のうち使う部分）。 */
export interface TimelinePostLike {
  id: string;
  text: string;
  createdAt: string | null;
  impressions?: number | null;
  likes?: number | null;
  reposts?: number | null;
  replies?: number | null;
  hasMedia?: boolean;
  hasUrl?: boolean;
}

/** Exos AIで作った投稿のタグ（drafts から引く）。 */
export interface DraftTag {
  pattern: string | null;
  theme: string | null;
}

/** `<posts>` に載せる1行。LLMが読む形なのでキー名は意味が伝わる英語にする。 */
export interface SuggestionPost {
  id: string;
  text: string;
  posted_at_jst: string | null;
  impressions: number | null;
  likes: number | null;
  reposts: number | null;
  replies: number | null;
  has_image: boolean;
  has_url: boolean;
  /** このアプリで作った投稿の型（p1〜p6）。外部の投稿は null。 */
  pattern: string | null;
  /** このアプリで作った投稿のテーマID。外部の投稿は null。 */
  theme: string | null;
}

export interface SuggestionInput {
  posts: SuggestionPost[];
}

/** codepoint単位で先頭n文字（絵文字のサロゲートペアを割らない）。 */
function truncateChars(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : chars.slice(0, max).join("");
}

/** ISO → `YYYY-MM-DD HH:mm`（JST）。読めない値は null（行ごと捨てない）。 */
export function toJstLabel(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const jst = new Date(ms + 9 * 3600_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${jst.getUTCFullYear()}-${pad(jst.getUTCMonth() + 1)}-${pad(jst.getUTCDate())} ${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}`;
}

/**
 * タイムライン投稿を `<posts>` の形へ整える。
 *
 * - 並びは新しい順のまま（呼び出し側＝X APIの返却順を保つ）
 * - `draftTags` は tweet_id → 型/テーマ。**threadの全tweet_idを同じdraftへ引ける**前提で作る
 *   （先頭ポストしかタイムラインに出ない場合もあるため、どのIDでも引けるのが安全）
 */
export function buildSuggestionInput(
  timeline: readonly TimelinePostLike[],
  draftTags: ReadonlyMap<string, DraftTag>,
): SuggestionInput {
  const posts = timeline.slice(0, SUGGEST_TIMELINE_MAX).map((p) => {
    const tag = draftTags.get(p.id);
    return {
      id: p.id,
      text: truncateChars(p.text.replace(/\s+/g, " ").trim(), SUGGEST_POST_TEXT_CHARS),
      posted_at_jst: toJstLabel(p.createdAt),
      impressions: p.impressions ?? null,
      likes: p.likes ?? null,
      reposts: p.reposts ?? null,
      replies: p.replies ?? null,
      has_image: p.hasMedia ?? false,
      has_url: p.hasUrl ?? false,
      pattern: tag?.pattern ?? null,
      theme: tag?.theme ?? null,
    };
  });
  return { posts };
}

/**
 * drafts の行から tweet_id → 型/テーマ の索引を作る。
 * thread の**全ポストのID**を同じタグへ張る（引用や続きのポストがタイムラインに現れても引けるように）。
 */
export function buildDraftTagIndex(
  rows: readonly { tweet_ids: string[] | null; pattern: string | null; theme: string | null }[],
): Map<string, DraftTag> {
  const index = new Map<string, DraftTag>();
  for (const row of rows) {
    for (const id of row.tweet_ids ?? []) {
      index.set(id, { pattern: row.pattern, theme: row.theme });
    }
  }
  return index;
}
