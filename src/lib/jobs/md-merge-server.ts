import "server-only";

import { resolveTextProvider } from "../ai/resolve-provider-server";
import { withTransaction, pooledQueryable, runInPooledTx } from "../db/pool";
import type { PlanId } from "../plans";
import { reserveIfPremium } from "../usage/reserve-if-premium";
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

const pooledDb = pooledQueryable();

const runInTx = runInPooledTx;

function resolveProvider(input: { plan: string; userId: string; deadline: Deadline }) {
  /*
    アカウント.mdのセクション1〜4を、参考ソースの分析を踏まえて洗練する（T-M8-336）。
    **書き直しではなく判断が要る仕事**（どの具体を足すか・設定由来の値を守るか）なので、
    学習分析と同じ中間クラスで固定する（運営者の指示 2026-08-27）。
  */
  return resolveTextProvider(
    { plan: input.plan as PlanId, userId: input.userId },
    { deadline: input.deadline, purpose: "analysis" },
  );
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
  if (!meta) return; // job が消えている → no-op
  /*
    `learning_source_id` の有無で**何のためのmergeか**が決まる（T-M8-344）。
    - 有り: 学習ソースの**削除**に伴う作り直し（その1件を除いて再構成する）
    - 無し: 利用者が「学習ソースからアカウント設定を作る」を押した反映
      （登録済みの分析をすべて使う。アカウント設定が未保存でも作れる）
  */
  const removedSourceId = meta.learning_source_id ?? undefined;
  /*
    反映merge（`learning_source_id` 無し）は**保存前の提案**として置く（T-M8-349）。
    削除mergeは知見を取り除く処理なので、これまでどおりその場で確定させる——
    「消したのにまだ効いている」状態を残さないため。
  */
  const proposalOnly = removedSourceId === undefined;

  // 削除mergeも生成枠を1消費（premium・要件04 §12）。冪等keyで再実行安全。
  await reserveIfPremium(runInTx, {
    plan: meta.plan,
    userId: meta.user_id,
    xAccountId: meta.x_account_id,
    jobId: ctx.jobId,
    type: "generation",
  });

  const deadline = createDeadline();
  try {
    await executeMdMerge(
      { db: pooledDb, jobId: ctx.jobId, runInTx, runInTxForSettle: runInTx, resolveProvider, makeDeadline: () => deadline },
      removedSourceId ? { removedSourceId } : { proposalOnly },
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
