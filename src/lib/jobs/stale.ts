import type { PoolClient } from "pg";

import { withTransaction } from "../db/pool";
import type { JobKind } from "./handlers";
import { MAX_ATTEMPTS, backoffMs } from "./retry";
import {
  STALE_TIMEOUT_CODE,
  STALE_TIMEOUT_MESSAGE,
  finalizeFailedJob,
} from "./terminal";

/**
 * heartbeat と stale ジョブの回収（要件04 §4）。実行中は locked_at を定期更新し、
 * locked_at が10分を超えた running ジョブを stale とみなして、attempt<3 は backoff付きで
 * queued へ戻し、attempt>=3 は failed へ確定する（§4.10形式のerror）。
 *
 * stale→failed 確定時の kind別終端処理（reserveのrefund・kind別のdraft/source後始末・error通知）は
 * `finalizeFailedJob`（terminal.ts, T-M4-08）が failed 更新と同一 transaction で担う。
 */

export const STALE_AFTER_MINUTES = 10;

/**
 * 実行中ジョブの liveness 更新。locked_at=now()、任意で progress_stage を更新する。
 * status='running' の行だけ更新し、更新できたら true。呼び出し側が30秒ごと／stage変更時に呼ぶ。
 */
export async function heartbeat(
  jobId: string,
  stage?: string,
): Promise<boolean> {
  return withTransaction(async (c) => {
    const res = await c.query(
      `update generation_jobs
          set locked_at = now(),
              progress_stage = coalesce($2, progress_stage)
        where id = $1 and status = 'running'`,
      [jobId, stage ?? null],
    );
    return (res.rowCount ?? 0) > 0;
  });
}

/** progress stage 記録関数の型（各 handler が任意で注入。既定は heartbeat 更新）。 */
export type RecordStage = (stage: string) => Promise<void>;

/**
 * heartbeat による既定の stage 記録関数。各 job handler の `deps.recordStage` 未指定時に使う。
 * running 行の locked_at と progress_stage を更新する（独自 tx）。テストは deps で no-op 化する。
 */
export function defaultRecordStage(jobId: string): RecordStage {
  return async (stage) => void (await heartbeat(jobId, stage));
}

/** stale→failed 確定時の kind別終端処理フック（既定は `finalizeFailedJob`）。 */
export type TerminalHandler = (
  client: PoolClient,
  jobId: string,
  kind: JobKind,
) => Promise<void>;

export interface StaleRecoveryResult {
  requeued: number;
  failed: number;
}

export interface RecoverStaleJobsOptions {
  /** 1回の回収で処理する上限件数。 */
  limit?: number;
  /** stale→failed 確定時の kind別終端処理（既定 `finalizeFailedJob`）。テストで spy を注入する。 */
  terminalHandler?: TerminalHandler;
}

/**
 * stale な running ジョブを回収する。scheduler_tick（M4）から呼ぶ想定。
 * attempt<3: lock解除しqueuedへ（available_at=now()+backoff）。
 * attempt>=3: failed確定＋§4.10形式のerror＋kind別終端処理。
 * 終端処理は `opts.terminalHandler`（既定 `finalizeFailedJob`）で差し替え可能。
 */
export async function recoverStaleJobs(
  opts: RecoverStaleJobsOptions = {},
): Promise<StaleRecoveryResult> {
  const limit = opts.limit ?? 100;
  const terminalHandler = opts.terminalHandler ?? finalizeFailedJob;
  return withTransaction(async (c) => {
    const stale = await c.query<{ id: string; attempt: number; kind: JobKind }>(
      `select id, attempt, kind
         from generation_jobs
        where status = 'running'
          and locked_at < now() - ($1 || ' minutes')::interval
        order by locked_at asc
        limit $2
        for update skip locked`,
      [STALE_AFTER_MINUTES, limit],
    );

    let requeued = 0;
    let failed = 0;
    for (const job of stale.rows) {
      if (job.attempt < MAX_ATTEMPTS) {
        await c.query(
          `update generation_jobs
              set status = 'queued', locked_at = null, locked_by = null,
                  progress_stage = null,
                  available_at = now() + ($2 || ' milliseconds')::interval
            where id = $1`,
          [job.id, backoffMs(job.attempt)],
        );
        requeued += 1;
      } else {
        const error = {
          code: STALE_TIMEOUT_CODE,
          message: STALE_TIMEOUT_MESSAGE,
          retryable: false,
          stage: null,
        };
        await c.query(
          `update generation_jobs
              set status = 'failed', finished_at = now(), locked_at = null,
                  error = $2::jsonb
            where id = $1`,
          [job.id, JSON.stringify(error)],
        );
        await terminalHandler(c, job.id, job.kind);
        failed += 1;
      }
    }
    return { requeued, failed };
  });
}
