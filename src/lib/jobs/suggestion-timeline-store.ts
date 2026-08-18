import type { XRecentPost } from "../x/client";
import type { Queryable } from "../x/token-refresh";
import type { DraftTag, StoredTimelinePost } from "./suggestion-input";
import { SUGGEST_ANALYZE_MAX, truncateForStore } from "./suggestion-timeline";

/**
 * `x_timeline_posts` の読み書き（T-M8-94）。DBは注入しテスト可能に保つ（server配線は suggestion-server）。
 *
 * - upsert: 増分取得の重なり分（直近48時間）はメトリクス・本文を上書きし、型/テーマは
 *   **一度付いたら保持**する（coalesce。draftsの行が後から消えてもタグを失わない）
 * - 読み出し: 新しい順に最大 `SUGGEST_ANALYZE_MAX` 件（分析のAI入力上限）
 */

/**
 * Exos AIで作った投稿のタグ行（tweet_ids・型・テーマ）を読む。
 *
 * **テーマは drafts ではなく生成job（`generation_jobs.input->>'theme'`）にある。**
 * 当初 `d.input` という存在しない列を参照しており、実アカウントでの初回実行で
 * `column d.input does not exist` として発覚した（2026-08-15）。SQLは実DBテストで守る。
 */
export async function loadDraftTagRows(
  db: Queryable,
  xAccountId: string,
): Promise<{ tweet_ids: string[] | null; pattern_name: string | null; theme: string | null }[]> {
  const { rows } = await db.query<{
    tweet_ids: string[] | null;
    pattern_name: string | null;
    theme: string | null;
  }>(
    // パターンは**名前**で持つ（T-M8-129 U5。旧enumは撤去した）。
    `select d.tweet_ids, d.pattern_name, gj.input->>'theme' as theme
       from drafts d
       left join generation_jobs gj on gj.id = d.source_job_id
      where d.x_account_id = $1
        and jsonb_array_length(d.tweet_ids) > 0`,
    [xAccountId],
  );
  return rows;
}

/** このアカウントで保存済みの最新投稿時刻（増分取得の基準）。無ければ null。 */
export async function newestStoredPostedAt(
  db: Queryable,
  xAccountId: string,
): Promise<string | null> {
  const { rows } = await db.query<{ at: string | null }>(
    `select max(posted_at)::text as at from x_timeline_posts where x_account_id = $1`,
    [xAccountId],
  );
  return rows[0]?.at ?? null;
}

/** 取得した投稿を upsert する。返り値は upsert した件数。 */
export async function upsertTimelinePosts(
  db: Queryable,
  xAccountId: string,
  posts: readonly XRecentPost[],
  draftTags: ReadonlyMap<string, DraftTag>,
): Promise<number> {
  for (const p of posts) {
    const tag = draftTags.get(p.id);
    await db.query(
      `insert into x_timeline_posts
         (x_account_id, tweet_id, text, posted_at, impressions, likes, reposts, replies,
          has_image, has_url, pattern_name, theme, metrics_updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
       on conflict (x_account_id, tweet_id) do update set
         text = excluded.text,
         impressions = excluded.impressions,
         likes = excluded.likes,
         reposts = excluded.reposts,
         replies = excluded.replies,
         has_image = excluded.has_image,
         has_url = excluded.has_url,
         pattern_name = coalesce(x_timeline_posts.pattern_name, excluded.pattern_name),
         theme = coalesce(x_timeline_posts.theme, excluded.theme),
         metrics_updated_at = now()`,
      [
        xAccountId,
        p.id,
        truncateForStore(p.text),
        p.createdAt,
        p.impressions ?? null,
        p.likes ?? null,
        p.reposts ?? null,
        p.replies ?? null,
        p.hasMedia ?? false,
        p.hasUrl ?? false,
        tag?.pattern ?? null,
        tag?.theme ?? null,
      ],
    );
  }
  return posts.length;
}

/** 分析対象の読み出し（保存済みの全投稿を新しい順に、AI入力上限まで）。 */
export async function loadStoredTimeline(
  db: Queryable,
  xAccountId: string,
): Promise<StoredTimelinePost[]> {
  const { rows } = await db.query<StoredTimelinePost>(
    `select tweet_id, text, posted_at::text as posted_at, impressions::int as impressions,
            likes, reposts, replies, has_image, has_url, pattern_name, theme
       from x_timeline_posts
      where x_account_id = $1
      order by posted_at desc nulls last
      limit ${SUGGEST_ANALYZE_MAX}`,
    [xAccountId],
  );
  return rows;
}
