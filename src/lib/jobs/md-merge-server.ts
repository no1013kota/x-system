import "server-only";

import { resolveTextProvider } from "../ai/resolve-provider-server";
import { getPool, withTransaction } from "../db/pool";
import { PLANS, type PlanId } from "../plans";
import { reserveUsage } from "../usage/generation-reserve";
import type { Queryable } from "../x/token-refresh";
import { createDeadline, type Deadline } from "./deadline";
import { executeMdMerge } from "./md-merge";
import { MAX_ATTEMPTS, backoffMs } from "./retry";
import { finalizeFailedJob } from "./terminal";
import type { JobContext } from "./handlers";

/**
 * 単独 md_merge ハンドラ（学習ソース削除フロー, 要件04 §12, T-M5-05）。premium は開始時に生成枠を +1
 * reserve（削除も1消費・要件03 §7.1）、対象ソースを merge から除外して該当セクションを再構築し removed 確定
 * （executeMdMerge の removedSourceId 経路）。最終失敗は共通終端 finalizeFailedJob（生成枠refund＋source
 * removing→analyzed＋削除未完了通知）へ集約。retryable（version競合枯渇・時間不足）は attempt<3 で queued
 * 自己終端して scheduler_tick に委ね、reserve を保持する。
 */

const pooledDb: Queryable = {
  query: <T = unknown>(sql: string, params?: unknown[]) =>
    getPool().query(sql, params) as unknown as Promise<{ rows: T[]; rowCount: number | null }>,
};

const runInTx = <T>(fn: (tx: Queryable) => Promise<T>): Promise<T> =>
  withTransaction((c) => fn(c as unknown as Queryable));

function resolveProvider(input: { plan: string; userId: string; deadline: Deadline }) {
  return resolveTextProvider({ plan: input.plan as PlanId, userId: input.userId }, { deadline: input.deadline });
}

export async function mdMergeHandler(ctx: JobContext): Promise<void> {
  const meta = (
    await pooledDb.query<{
      x_account_id: string;
      user_id: string;
      plan: string;
      learning_source_id: string | null;
    }>(
      `select gj.x_account_id, xa.user_id, p.plan, gj.learning_source_id
         from generation_jobs gj
         join x_accounts xa on xa.id = gj.x_account_id
         join profiles p on p.id = xa.user_id
        where gj.id = $1`,
      [ctx.jobId],
    )
  ).rows[0];
  if (!meta?.learning_source_id) return; // 対象ソース無し → no-op

  const isPremium = meta.plan === "premium";
  // 削除mergeも生成枠を1消費（premium・要件04 §12）。冪等keyで再実行安全。
  if (isPremium) {
    await runInTx((tx) =>
      reserveUsage(tx, {
        userId: meta.user_id,
        xAccountId: meta.x_account_id,
        jobId: ctx.jobId,
        type: "generation",
        limit: PLANS.premium.usageLimits?.generations,
      }),
    );
  }

  const deadline = createDeadline();
  try {
    await executeMdMerge(
      { db: pooledDb, jobId: ctx.jobId, runInTx, resolveProvider, makeDeadline: () => deadline },
      { removedSourceId: meta.learning_source_id },
    );
  } catch (error) {
    // retryable は attempt<3 で queued 自己終端（runJob の failed 化を空振り）・reserve 保持。
    if ((error as { retryable?: boolean } | null)?.retryable === true) {
      const attempt =
        (await pooledDb.query<{ attempt: number }>(`select attempt from generation_jobs where id = $1`, [ctx.jobId]))
          .rows[0]?.attempt ?? MAX_ATTEMPTS;
      if (attempt < MAX_ATTEMPTS) {
        await runInTx((tx) =>
          tx.query(
            `update generation_jobs
                set status = 'queued', locked_at = null, locked_by = null, progress_stage = null,
                    available_at = now() + ($2 || ' milliseconds')::interval
              where id = $1 and status = 'running'`,
            [ctx.jobId, backoffMs(attempt)],
          ),
        );
        throw error;
      }
    }
    // 最終失敗: 生成枠refund＋source removing→analyzed＋削除未完了通知（stale経路と同じ終端を再利用）。
    await withTransaction((c) => finalizeFailedJob(c, ctx.jobId, "md_merge"));
    throw error;
  }
}
