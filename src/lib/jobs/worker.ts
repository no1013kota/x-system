import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";

import { acquireXactLock, postPublishLockKey, xAccountLockKey } from "../db/locks";
import { withTransaction } from "../db/pool";
import { dispatchJob } from "./dispatch";
import { getJobHandler, type JobKind } from "./handlers";
import { decideJobOutcome } from "./job-error";
import { fallbackJobError } from "./terminal";

/**
 * Worker for a single job (要件04 §1/§4, ADR-0002). `leaseJob` performs the
 * lease transaction; `runJob` wraps it, runs the kind handler, and finalizes.
 * Heartbeat / stale recovery / retry are T-M0-13.
 */

export type LeaseOutcome =
  | "leased"
  | "not_found"
  | "skipped_locked" // row locked by another worker (FOR UPDATE SKIP LOCKED)
  | "skipped_conflict" // same-account/user running job (concurrency guard)
  | "not_queued" // not queued or not yet due
  | "canceled_missed"; // schedule-origin job past scheduled_for + 10min

export interface LeasedJob {
  id: string;
  kind: JobKind;
  attempt: number;
  lockedBy: string;
}

export interface LeaseResult {
  outcome: LeaseOutcome;
  job?: LeasedJob;
}

/**
 * Lease step (要件04 §4). Must run inside a transaction (the advisory locks are
 * transaction-scoped and auto-release on commit/rollback).
 */
export async function leaseJob(
  client: PoolClient,
  jobId: string,
  workerId: string,
): Promise<LeaseResult> {
  // 1. read job + owning user to derive lock keys
  const meta = await client.query<{
    x_account_id: string;
    kind: JobKind;
    user_id: string;
  }>(
    `select gj.x_account_id, gj.kind, xa.user_id
       from generation_jobs gj
       join x_accounts xa on xa.id = gj.x_account_id
      where gj.id = $1`,
    [jobId],
  );
  if (meta.rowCount === 0) return { outcome: "not_found" };
  const { x_account_id, kind, user_id } = meta.rows[0];

  // 2. advisory locks serialize per-account (and per-user for post_publish),
  //    preventing write-skew where two workers both see "no running job".
  await acquireXactLock(client, xAccountLockKey(x_account_id));
  if (kind === "post_publish") {
    await acquireXactLock(client, postPublishLockKey(user_id));
  }

  // 3. take the row with FOR UPDATE SKIP LOCKED
  const locked = await client.query<{
    status: string;
    trigger: string;
    attempt: number;
    available_now: boolean;
    schedule_expired: boolean;
  }>(
    `select status, trigger, attempt,
            (available_at <= now()) as available_now,
            (scheduled_for is not null
               and now() > scheduled_for + interval '10 minutes') as schedule_expired
       from generation_jobs
      where id = $1
      for update skip locked`,
    [jobId],
  );
  if (locked.rowCount === 0) return { outcome: "skipped_locked" };
  const row = locked.rows[0];

  // schedule-origin post_generation past its window → cancel (要件04 §7.2)。
  // schedule_missed 通知の作成は scheduler_tick（M4）が担う。
  if (
    kind === "post_generation" &&
    row.trigger === "schedule" &&
    row.status === "queued" &&
    row.schedule_expired
  ) {
    await client.query(
      `update generation_jobs set status = 'canceled', finished_at = now() where id = $1`,
      [jobId],
    );
    return { outcome: "canceled_missed" };
  }

  if (row.status !== "queued" || !row.available_now) {
    return { outcome: "not_queued" };
  }

  // 4. concurrency guard: another running job on this account?
  const acctRunning = await client.query(
    `select 1 from generation_jobs
      where x_account_id = $1 and status = 'running' and id <> $2 limit 1`,
    [x_account_id, jobId],
  );
  if ((acctRunning.rowCount ?? 0) > 0) return { outcome: "skipped_conflict" };
  if (kind === "post_publish") {
    const userPublishing = await client.query(
      `select 1 from generation_jobs gj
         join x_accounts xa on xa.id = gj.x_account_id
        where xa.user_id = $1 and gj.kind = 'post_publish'
          and gj.status = 'running' and gj.id <> $2 limit 1`,
      [user_id, jobId],
    );
    if ((userPublishing.rowCount ?? 0) > 0) return { outcome: "skipped_conflict" };
  }

  // 5. lease
  const leased = await client.query<{
    id: string;
    kind: JobKind;
    attempt: number;
    locked_by: string;
  }>(
    // error を消してから走らせる。coalesce による「今回のattemptでhandlerが保存したか」判定を
    // 前回attemptの残骸で誤らせないため（要件04 §4）。
    `update generation_jobs
        set status = 'running', locked_at = now(), locked_by = $2,
            attempt = attempt + 1, started_at = coalesce(started_at, now()),
            error = null
      where id = $1
      returning id, kind, attempt, locked_by`,
    [jobId, workerId],
  );
  const j = leased.rows[0];
  return {
    outcome: "leased",
    job: { id: j.id, kind: j.kind, attempt: j.attempt, lockedBy: j.locked_by },
  };
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface RunResult extends LeaseResult {
  /** set only when a job was leased and its handler ran。`retry` は queued へ差し戻した場合 */
  result?: "succeeded" | "failed" | "retry";
}

/**
 * retryable な失敗を backoff 付きで queued へ戻す（要件04 §5）。`status='running'` の間だけ
 * 更新するため、handlerが自己終端した場合は触らない。前attemptの `error` は残さない
 * （まだ失敗が確定していないため、画面に失敗理由を見せない）。
 */
export async function requeueJob(jobId: string, delayMs: number): Promise<void> {
  await withTransaction((c) =>
    c.query(
      `update generation_jobs
          set status = 'queued', locked_at = null, locked_by = null,
              progress_stage = null, error = null,
              available_at = now() + ($2 || ' milliseconds')::interval
        where id = $1 and status = 'running'`,
      [jobId, delayMs],
    ),
  );
}

/**
 * 失敗を確定する（要件04 §4）。`status='running'` の間だけ更新するため、handlerが自己終端
 * （canceled・queuedへの差し戻し）した場合は上書きしない。`error` は `coalesce` で補完するので、
 * handlerが既に理由を保存していればそれを尊重し、未保存のときだけ汎用の理由を残す
 * （理由が無いと画面が「時間をおいて再試行」しか出せないため）。例外の生メッセージは保存しない。
 */
export async function failJob(
  jobId: string,
  kind: JobKind,
  error: unknown,
): Promise<void> {
  const fallback = fallbackJobError(kind, error);
  await withTransaction((c) =>
    c.query(
      `update generation_jobs
          set status = 'failed', finished_at = now(),
              error = coalesce(error, jsonb_build_object(
                'code', $2::text,
                'message', $3::text,
                'retryable', false,
                'stage', progress_stage::text
              ))
        where id = $1 and status = 'running'`,
      [jobId, fallback.code, fallback.message],
    ),
  );
}

/**
 * Leases the job, runs its handler outside the lease transaction, then marks
 * it succeeded or failed. Returns the lease outcome (and handler result when
 * leased). Never throws for normal outcomes.
 */
export async function runJob(
  jobId: string,
  workerId: string = `worker-${randomUUID()}`,
  deps: { sleep?: (ms: number) => Promise<void> } = {},
): Promise<RunResult> {
  const lease = await withTransaction((c) => leaseJob(c, jobId, workerId));
  if (lease.outcome !== "leased" || !lease.job) return lease;

  const job = lease.job;
  try {
    await withTransaction((c) =>
      getJobHandler(job.kind)({ jobId, kind: job.kind, workerId }, c),
    );
    await withTransaction((c) =>
      c.query(
        `update generation_jobs
            set status = 'succeeded', finished_at = now(), progress_stage = null
          where id = $1 and status = 'running'`,
        [jobId],
      ),
    );
  } catch (error) {
    // 中央finalizer（要件04 §5・D-5）: retryable(429/5xx/network) は上限まで backoff 付きで
    // queued へ戻し、それ以外と上限到達は failed で確定する。
    const outcome = decideJobOutcome(error, job.attempt);
    if (outcome.action === "retry") {
      await requeueJob(jobId, outcome.delayMs);
      // backoff は数秒なので、その場で待って再dispatchする（次の scheduler_tick を待つと
      // 最大5分の空白になるため）。dispatch失敗時も queued のまま tick が回収する。
      await (deps.sleep ?? defaultSleep)(outcome.delayMs);
      await dispatchJob(jobId).catch(() => undefined);
      return { ...lease, result: "retry" };
    }
    await failJob(jobId, job.kind, error);
    return { ...lease, result: "failed" };
  }
  // 連鎖dispatch: 親succeeded確定後にqueuedの子job（画像生成・投稿実行）を起動する
  // （ADR-0002/要件04 §1）。親がrunningの間はacctRunningガードでleaseできないため成功確定後に行う。
  // 成功はすでに確定済みなので、dispatch段の失敗で結果を failed へ落とさない（scheduler_tickが回収）。
  await dispatchChildJobs(jobId);
  return { ...lease, result: "succeeded" };
}

/**
 * 親jobのsucceeded確定後に、queuedの子job（parent_job_id一致・available）を連鎖dispatchする。
 * dispatchJob は 202受領で返り例外を投げない（transport失敗時はqueuedのまま scheduler_tick が回収）。
 */
async function dispatchChildJobs(parentJobId: string): Promise<void> {
  try {
    const { rows } = await withTransaction((c) =>
      c.query<{ id: string }>(
        `select id from generation_jobs
          where parent_job_id = $1 and status = 'queued' and available_at <= now()`,
        [parentJobId],
      ),
    );
    for (const row of rows) {
      await dispatchJob(row.id);
    }
  } catch {
    // best-effort。ここで失敗しても親は succeeded 済みで、queuedの子は scheduler_tick が回収する。
  }
}
