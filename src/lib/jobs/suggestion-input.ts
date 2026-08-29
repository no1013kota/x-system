/**
 * SUGGEST 入力の組み立て（K-2, プロンプト §6.15/§4.2, 要件04 §12, T-M8-91/94）。
 *
 * 2026-08-15 の刷新で、分析対象を「Exos AIで作った投稿の checkpoint 実績」から
 * **Xタイムラインの全投稿**（Exos製かに依らない）へ変えた。固定の分析軸と
 * 「3投稿以上・差20%以上」の条件は廃止し、特徴づけはLLMの自由分析に任せる。
 * T-M8-94 でさらに自動化し、取得は増分（`suggestion-timeline.ts`）・保存は
 * `x_timeline_posts`・**分析は保存済みの全投稿（新しい順に最大 SUGGEST_ANALYZE_MAX 件）**になった。
 *
 * ここはLLMを使わない純粋な整形だけを持つ:
 * - タイムライン/保存行の各投稿を `<posts>` 用の1行へ変換する
 * - Exos AIで作った投稿には **型とテーマ** を付ける（drafts の tweet_ids と突合。分からなければ null）
 */

/**
 * `<posts>` へ渡す投稿の件数（T-M8-335・運営者の指示 2026-08-27。100→50）。
 *
 * **入力の大きさがこのレポートの費用をほぼ決める**（1件300字なので50件で約1.5万字）。
 * 傾向を読むには直近50件で足り、古い投稿ほど今の書き方との関係が薄い。
 * 取得・保存の上限（`TIMELINE_FETCH_MAX` / `SUGGEST_ANALYZE_MAX`）は変えない——
 * 画面の実績表示や次回以降の分析はそのまま保存済みデータを使う。
 */
export const SUGGEST_TIMELINE_MAX = 50;
/** 本文をLLMへ渡す長さ。書き出し・構成の観察に足る長さ（200→300へ・T-M8-98。保存は500字）。 */
export const SUGGEST_POST_TEXT_CHARS = 300;

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
  /** パターンの**名前**（T-M8-129 U5。内部IDは持たない）。 */
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
  /** このアプリで作った投稿の**パターン名**。外部の投稿は null（T-M8-129 U3/U5）。 */
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

/** `x_timeline_posts` の保存行（読み出し形）。 */
export interface StoredTimelinePost {
  tweet_id: string;
  text: string;
  posted_at: string | null;
  impressions: number | null;
  likes: number | null;
  reposts: number | null;
  replies: number | null;
  has_image: boolean;
  has_url: boolean;
  /** パターンの名前（T-M8-129 U5）。外部の投稿は null。 */
  pattern_name: string | null;
  theme: string | null;
}

/** 保存済みの投稿（新しい順で渡す）を `<posts>` の形へ整える（T-M8-94）。 */
export function buildInputFromStored(rows: readonly StoredTimelinePost[]): SuggestionInput {
  return {
    posts: rows.map((r) => ({
      id: r.tweet_id,
      text: truncateChars(r.text.replace(/\s+/g, " ").trim(), SUGGEST_POST_TEXT_CHARS),
      posted_at_jst: toJstLabel(r.posted_at),
      impressions: r.impressions,
      likes: r.likes,
      reposts: r.reposts,
      replies: r.replies,
      has_image: r.has_image,
      has_url: r.has_url,
      pattern: r.pattern_name,
      theme: r.theme,
    })),
  };
}

/**
 * drafts の行から tweet_id → 型/テーマ の索引を作る。
 * thread の**全ポストのID**を同じタグへ張る（引用や続きのポストがタイムラインに現れても引けるように）。
 */
export function buildDraftTagIndex(
  rows: readonly { tweet_ids: string[] | null; pattern_name: string | null; theme: string | null }[],
): Map<string, DraftTag> {
  const index = new Map<string, DraftTag>();
  for (const row of rows) {
    for (const id of row.tweet_ids ?? []) {
      index.set(id, { pattern: row.pattern_name, theme: row.theme });
    }
  }
  return index;
}
