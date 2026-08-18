import "server-only";

import { pooledQueryable } from "../db/pool";

/**
 * ホーム（SC-05）「直近の実績」の server-only 配線（要件06 §1・§10）。active Xアカウントの投稿済み
 * draft を新しい順に数件だけ読む。集計値はSC-09と同じ `getAnalyticsSummaryForUser` を使い、ここでは
 * 一覧に必要な最小列（本文冒頭・先頭tweet_id・投稿方法）だけを取り出す。
 */

const pooledDb = pooledQueryable();

export interface RecentPostView {
  draftId: string;
  /** 生成時に写したパターン名（**内部IDは出さない**・T-M8-129 U3）。 */
  patternName: string;
  postedAt: string;
  /** `auto`／`manual`。未記録は null。 */
  postedMode: string | null;
  /** スレッド先頭のtweet_id（Xへのpermalink用）。未記録は null。 */
  firstTweetId: string | null;
  excerpt: string;
}

/** 所有者のみ。posted の draft を posted_at 降順で最大 limit 件返す。 */
export async function loadRecentPosts(
  userId: string,
  xAccountId: string,
  limit = 3,
): Promise<RecentPostView[]> {
  const { rows } = await pooledDb.query<{
    id: string;
    pattern_name: string;
    posted_at: string;
    posted_mode: string | null;
    first_tweet_id: string | null;
    excerpt: string | null;
  }>(
    `select d.id, d.pattern_name, d.posted_at::text as posted_at, d.posted_mode::text as posted_mode,
            d.tweet_ids->>0 as first_tweet_id,
            d.thread->0->>'text' as excerpt
       from drafts d
       join x_accounts xa on xa.id = d.x_account_id
      where d.x_account_id = $1 and xa.user_id = $2
        and d.status = 'posted' and d.posted_at is not null
      order by d.posted_at desc, d.id desc
      limit $3`,
    [xAccountId, userId, limit],
  );
  return rows.map((r) => ({
    draftId: r.id,
    patternName: r.pattern_name,
    postedAt: r.posted_at,
    postedMode: r.posted_mode,
    firstTweetId: r.first_tweet_id,
    excerpt: r.excerpt ?? "",
  }));
}
