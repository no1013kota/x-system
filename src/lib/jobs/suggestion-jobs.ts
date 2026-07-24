import { z } from "zod";

import { AppError } from "@/lib/observability/errors";

import type { Queryable } from "../x/token-refresh";
import { requestKey } from "./keys";

/**
 * refreshSuggestions / listSuggestions の中核（SUGGEST, K-2, 要件05 §9/§12, 要件04 §12, T-M5-18）。
 * DBは注入し純粋に保つ。refreshSuggestions は request_key 冪等・active一致・active suggestion job なし・
 * 同一JST日の成功なし・前回job以降の新metrics・queued/running 5件上限を検証して `suggestion` job を作る。
 * listSuggestions は最新の成功 suggestion job の improvement_suggestions を返す。提案は表示専用。
 */

export const MAX_ACTIVE_JOBS = 5;

export const refreshSuggestionsSchema = z.object({
  request_key: z.string().min(1).max(200),
});
export type RefreshSuggestionsInput = z.infer<typeof refreshSuggestionsSchema>;

export type RunInTx = <T>(fn: (tx: Queryable) => Promise<T>) => Promise<T>;

export interface SuggestionJobDeps {
  runInTx: RunInTx;
}

export interface CreateJobResult {
  jobId: string;
  deduped: boolean;
}

async function assertActiveAccount(tx: Queryable, userId: string, xAccountId: string): Promise<void> {
  const row = (
    await tx.query<{ status: string; active_x_account_id: string | null }>(
      `select xa.status, p.active_x_account_id
         from x_accounts xa join profiles p on p.id = xa.user_id
        where xa.id = $1 and xa.user_id = $2`,
      [xAccountId, userId],
    )
  ).rows[0];
  if (!row) throw new AppError("not_found");
  if (row.active_x_account_id !== xAccountId) {
    throw new AppError("job_conflict", { details: { reason: "x_account_mismatch" } });
  }
}

async function assertNoActiveSuggestion(tx: Queryable, xAccountId: string): Promise<void> {
  const active = await tx.query(
    `select 1 from generation_jobs
      where x_account_id = $1 and kind = 'suggestion' and status in ('queued', 'running') limit 1`,
    [xAccountId],
  );
  if (active.rowCount) {
    throw new AppError("job_conflict", { details: { reason: "active_suggestion_exists" } });
  }
}

async function assertNotAlreadyToday(tx: Queryable, xAccountId: string): Promise<void> {
  // 同一JST日に成功済みなら拒否（1日1回・失敗ジョブは再試行を許す）。
  const today = await tx.query(
    `select 1 from generation_jobs
      where x_account_id = $1 and kind = 'suggestion' and status = 'succeeded'
        and (created_at at time zone 'Asia/Tokyo')::date = (now() at time zone 'Asia/Tokyo')::date
      limit 1`,
    [xAccountId],
  );
  if (today.rowCount) {
    throw new AppError("job_conflict", { details: { reason: "already_today" } });
  }
}

async function assertNewMetricsSinceLastJob(tx: Queryable, xAccountId: string): Promise<void> {
  // 前回の suggestion job（成否問わず）以降に新しい metrics 取得があるか。初回（前回job無し）は許可。
  const lastJobAt = (
    await tx.query<{ at: string | null }>(
      `select max(created_at)::text as at from generation_jobs
        where x_account_id = $1 and kind = 'suggestion'`,
      [xAccountId],
    )
  ).rows[0]?.at;
  if (!lastJobAt) return; // 初回

  const latestMetricsAt = (
    await tx.query<{ at: string | null }>(
      `select max((cp.value->>'collected_at')::timestamptz)::text as at
         from drafts d
         cross join lateral jsonb_each(d.tweet_metrics) tm
         cross join lateral jsonb_each(tm.value->'checkpoints') cp
        where d.x_account_id = $1`,
      [xAccountId],
    )
  ).rows[0]?.at;
  if (!latestMetricsAt || new Date(latestMetricsAt).getTime() <= new Date(lastJobAt).getTime()) {
    throw new AppError("job_conflict", { details: { reason: "no_new_metrics" } });
  }
}

async function assertJobBudget(tx: Queryable, userId: string): Promise<void> {
  const active = (
    await tx.query<{ n: number }>(
      `select count(*)::int as n from generation_jobs gj
         join x_accounts xa on xa.id = gj.x_account_id
        where xa.user_id = $1 and gj.status in ('queued', 'running')`,
      [userId],
    )
  ).rows[0].n;
  if (active >= MAX_ACTIVE_JOBS) {
    throw new AppError("job_conflict", { details: { reason: "too_many_active_jobs" } });
  }
}

/** `suggestion` job を冪等作成する。違反ガードは job_conflict（details.reason）で拒否する。 */
export async function refreshSuggestions(
  userId: string,
  xAccountId: string,
  input: RefreshSuggestionsInput,
  deps: SuggestionJobDeps,
): Promise<CreateJobResult> {
  const key = requestKey(userId, input.request_key);
  return deps.runInTx(async (tx) => {
    const existing = (
      await tx.query<{ id: string }>(`select id from generation_jobs where request_key = $1`, [key])
    ).rows[0];
    if (existing) return { jobId: existing.id, deduped: true };

    await assertActiveAccount(tx, userId, xAccountId);
    await assertNoActiveSuggestion(tx, xAccountId);
    await assertNotAlreadyToday(tx, xAccountId);
    await assertNewMetricsSinceLastJob(tx, xAccountId);
    await assertJobBudget(tx, userId);

    // arbiter を限定しない on conflict do nothing で request_key と suggestion active partial-unique の
    // 両方を吸収する（同一アカウントへ別トークンの並行呼び出しが来ても 23505 を送出させない）。
    const inserted = (
      await tx.query<{ id: string }>(
        `insert into generation_jobs (x_account_id, kind, trigger, request_key, status)
         values ($1, 'suggestion', 'manual', $2, 'queued')
         on conflict do nothing
         returning id`,
        [xAccountId, key],
      )
    ).rows[0];
    if (inserted) return { jobId: inserted.id, deduped: false };

    // 同一 request_key の競合なら既存jobへ冪等デデュープ。
    const raced = (
      await tx.query<{ id: string }>(`select id from generation_jobs where request_key = $1`, [key])
    ).rows[0];
    if (raced) return { jobId: raced.id, deduped: true };
    // 別トークンの並行呼び出しが active suggestion を先に作った（partial-unique競合）→ friendly job_conflict。
    throw new AppError("job_conflict", { details: { reason: "active_suggestion_exists" } });
  });
}

export interface SuggestionView {
  content: string;
  evidence: Record<string, unknown>;
  createdAt: string;
}

/** 最新の成功 suggestion job 実行分の提案を返す（所有者のみ・新しい順）。 */
export async function listSuggestions(
  db: Queryable,
  userId: string,
  xAccountId: string,
): Promise<SuggestionView[]> {
  const { rows } = await db.query<{ content: string; evidence: Record<string, unknown>; created_at: string }>(
    `select s.content, s.evidence, s.created_at::text as created_at
       from improvement_suggestions s
       join x_accounts xa on xa.id = s.x_account_id
      where s.x_account_id = $1 and xa.user_id = $2
        and s.source_job_id = (
          select gj.id from generation_jobs gj
           where gj.x_account_id = $1 and gj.kind = 'suggestion' and gj.status = 'succeeded'
           order by coalesce(gj.finished_at, gj.created_at) desc, gj.created_at desc
           limit 1
        )
      order by s.created_at asc`,
    [xAccountId, userId],
  );
  return rows.map((r) => ({ content: r.content, evidence: r.evidence, createdAt: r.created_at }));
}
