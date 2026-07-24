import "server-only";

import {
  buildDraftAnalytics,
  summarize,
  type AnalyticsDraftRow,
  type AnalyticsSummary,
  type DraftAnalytics,
} from "./analytics";
import { getPool } from "./db/pool";
import type { Queryable } from "./x/token-refresh";

/**
 * 投稿実績の server-only 配線（SC-09, T-M5-15）。active Xアカウントの posted / 部分失敗(failed)で残存ID
 * を持つ draft を期間で読み、実績表示用に整形する。集計は表示時に行い別カラムへ保存しない（要件06 §8）。
 */

const pooledDb: Queryable = {
  query: <T = unknown>(sql: string, params?: unknown[]) =>
    getPool().query(sql, params) as unknown as Promise<{ rows: T[]; rowCount: number | null }>,
};

/** 所有者のみ。posted と、remaining を持つ failed を posted_at 期間で新しい順に返す。 */
export async function loadAnalyticsForUser(
  userId: string,
  xAccountId: string,
  periodDays: number,
): Promise<DraftAnalytics[]> {
  const { rows } = await pooledDb.query<AnalyticsDraftRow>(
    `select d.id, d.pattern, d.status, d.tweet_ids, d.last_post_error,
            d.posted_at::text as posted_at, d.metrics_completed_at::text as metrics_completed_at,
            d.tweet_metrics
       from drafts d
       join x_accounts xa on xa.id = d.x_account_id
      where d.x_account_id = $1 and xa.user_id = $2
        and d.posted_at is not null
        and d.posted_at >= now() - ($3 || ' days')::interval
        and (d.status = 'posted'
             or (d.status = 'failed'
                 and jsonb_array_length(coalesce(d.last_post_error->'remaining_tweet_ids', '[]'::jsonb)) > 0))
      order by d.posted_at desc, d.id desc`,
    [xAccountId, userId, String(periodDays)],
  );
  return rows.map(buildDraftAnalytics);
}

export async function getAnalyticsSummaryForUser(
  userId: string,
  xAccountId: string,
  periodDays: number,
): Promise<AnalyticsSummary> {
  const drafts = await loadAnalyticsForUser(userId, xAccountId, periodDays);
  return summarize(drafts, periodDays);
}
