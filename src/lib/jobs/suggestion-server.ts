import "server-only";

import { pooledQueryable, runInPooledTx } from "../db/pool";
import type { PlanId } from "../plans";
import type { Deadline } from "./deadline";
import type { JobContext } from "./handlers";
import { executeSuggestion } from "./suggestion";
import type { SuggestionInputDraft } from "./suggestion-input";

/**
 * suggestion ハンドラの server-only 配線（K-2, T-M5-18）。pool・provider解決（BYOK=ユーザー／premium=運営）・
 * 集計対象draftの読取を束ねて中核へ渡す。base_md/X読取はしない（集計は保存済み tweet_metrics のみ）。
 */

const pooledDb = pooledQueryable();

const runInTx = runInPooledTx;

async function resolveProvider(input: { plan: string; userId: string; deadline: Deadline }) {
  // provider解決はenv検証に触れるため、実際にLLMを呼ぶ時点（比較グループ十分時）まで遅延ロードする。
  const { resolveTextProvider } = await import("../ai/resolve-provider-server");
  return resolveTextProvider({ plan: input.plan as PlanId, userId: input.userId }, { deadline: input.deadline });
}

interface DraftRow {
  pattern: string;
  posted_at: string | null;
  thread: { text?: string }[] | null;
  tweet_ids: string[] | null;
  status: string;
  last_post_error: { remaining_tweet_ids?: string[]; deleted_tweet_ids?: string[] } | null;
  tweet_metrics: SuggestionInputDraft["tweet_metrics"];
}

/** 集計対象: 直近30日の posted と remaining を持つ failed（thread/tweet_metrics 付き）。 */
async function fetchDrafts(xAccountId: string): Promise<SuggestionInputDraft[]> {
  const { rows } = await pooledDb.query<DraftRow>(
    `select d.pattern, d.posted_at::text as posted_at, d.thread, d.tweet_ids, d.status,
            d.last_post_error, d.tweet_metrics
       from drafts d
      where d.x_account_id = $1
        and d.posted_at is not null
        and d.posted_at >= now() - interval '30 days'
        and (d.status = 'posted'
             or (d.status = 'failed'
                 and jsonb_array_length(coalesce(d.last_post_error->'remaining_tweet_ids', '[]'::jsonb)) > 0))
      order by d.posted_at desc`,
    [xAccountId],
  );
  return rows.map((r) => ({
    pattern: r.pattern,
    postedAt: r.posted_at,
    thread: (r.thread ?? []).map((t) => ({ text: t.text })),
    tweet_ids: r.tweet_ids ?? [],
    status: r.status,
    last_post_error: r.last_post_error,
    tweet_metrics: r.tweet_metrics,
  }));
}

export async function suggestionHandler(ctx: JobContext): Promise<void> {
  await executeSuggestion({
    db: pooledDb,
    jobId: ctx.jobId,
    runInTx,
    resolveProvider,
    fetchDrafts,
  });
}
