import "server-only";

import {
  buildDraftAnalytics,
  summarize,
  type AnalyticsDraftRow,
  type AnalyticsSummary,
  type DraftAnalytics,
  type FollowerPoint,
} from "./analytics";
import { pooledQueryable } from "./db/pool";
import { listSuggestions } from "./jobs/suggestion-jobs";

/**
 * 投稿実績の server-only 配線（SC-09, T-M5-15）。active Xアカウントの posted / 部分失敗(failed)で残存ID
 * を持つ draft を期間で読み、実績表示用に整形する。集計は表示時に行い別カラムへ保存しない（要件06 §8）。
 */

const pooledDb = pooledQueryable();

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

export interface SuggestionEvidencePost {
  tweetId: string;
  body: string;
  url: string;
}
export interface SuggestionDisplay {
  content: string;
  metric: string;
  checkpointDays: number | null;
  diffPct: number | null;
  summary: string;
  posts: SuggestionEvidencePost[];
  createdAt: string;
}
export interface SuggestionsSection {
  suggestions: SuggestionDisplay[];
  /** queued/running な suggestion job があるか（「生成中」表示用）。 */
  generating: boolean;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function numOrNull(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}

/** 最新の成功 suggestion job の提案を、evidence.tweet_id の本文冒頭・Xリンク付きで返す（所有者のみ）。 */
export async function loadSuggestionsForUser(
  userId: string,
  xAccountId: string,
): Promise<SuggestionsSection> {
  const [rows, meta, drafts] = await Promise.all([
    listSuggestions(pooledDb, userId, xAccountId),
    pooledDb.query<{ handle: string; generating: boolean }>(
      `select xa.handle,
              exists (
                select 1 from generation_jobs gj
                 where gj.x_account_id = xa.id and gj.kind = 'suggestion'
                   and gj.status in ('queued', 'running')
              ) as generating
         from x_accounts xa where xa.id = $1 and xa.user_id = $2`,
      [xAccountId, userId],
    ),
    pooledDb.query<{ tweet_ids: string[]; thread: { text?: string }[] }>(
      `select tweet_ids, thread from drafts where x_account_id = $1 and posted_at is not null`,
      [xAccountId],
    ),
  ]);

  const handle = meta.rows[0]?.handle ?? "i";
  const generating = meta.rows[0]?.generating ?? false;
  // tweet_id → 本文冒頭（tweet_ids↔thread 同順対応）。
  const bodyByTweet = new Map<string, string>();
  for (const d of drafts.rows) {
    (d.tweet_ids ?? []).forEach((id, i) => {
      if (id && !bodyByTweet.has(id)) bodyByTweet.set(id, (d.thread?.[i]?.text ?? "").slice(0, 100));
    });
  }

  const suggestions: SuggestionDisplay[] = rows.map((r) => {
    const ev = r.evidence ?? {};
    const tweetIds = Array.isArray(ev.tweet_ids) ? (ev.tweet_ids as unknown[]).filter((x): x is string => typeof x === "string") : [];
    return {
      content: r.content,
      metric: str(ev.metric) || "impressions",
      checkpointDays: numOrNull(ev.checkpoint_days),
      diffPct: numOrNull(ev.diff_pct),
      summary: str(ev.summary),
      posts: tweetIds.map((id) => ({
        tweetId: id,
        body: bodyByTweet.get(id) ?? "",
        url: `https://x.com/${handle}/status/${id}`,
      })),
      createdAt: r.createdAt,
    };
  });
  return { suggestions, generating };
}

/** 所有者のみ。直近 days 日のフォロワー日次snapshotを日付昇順で返す（欠損日は点を作らない）。 */
export async function loadFollowerSnapshotsForUser(
  userId: string,
  xAccountId: string,
  days: number,
): Promise<FollowerPoint[]> {
  const { rows } = await pooledDb.query<{ date: string; count: number }>(
    `select fs.snapshot_date::text as date, fs.followers_count as count
       from follower_snapshots fs
       join x_accounts xa on xa.id = fs.x_account_id
      where fs.x_account_id = $1 and xa.user_id = $2
        and fs.snapshot_date >= (now() at time zone 'Asia/Tokyo')::date - ($3 || ' days')::interval
      order by fs.snapshot_date asc`,
    [xAccountId, userId, String(days)],
  );
  return rows.map((r) => ({ date: r.date, count: Number(r.count) }));
}
