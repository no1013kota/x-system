import type { PoolClient } from "pg";

import {
  advisoryUnlock,
  cronWindowLockKey,
  tryAdvisoryLock,
} from "../db/locks";
import { getPool, withTransaction } from "../db/pool";
import { dispatchJob, type DispatchResult } from "./dispatch";
import { recoverStaleJobs, type StaleRecoveryResult } from "./stale";

/**
 * 定時トリガー（cron）の共通部分（要件04 §6, 運用メモ §2, ADR-0002）。
 * 各分野の本処理（news取得・slot enqueue・metrics収集・follower保存）は各機能
 * マイルストーンで実装し、ここでは時間窓ロックと scheduler_tick の回収骨格のみ。
 */

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** UTCの時（`YYYY-MM-DDTHH`）の窓key。毎時起動のcron用。 */
export function hourWindowKey(now: Date): string {
  return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(
    now.getUTCDate(),
  )}T${pad(now.getUTCHours())}`;
}

/** UTCの5分バケット（`YYYY-MM-DDTHH:MM`）の窓key。scheduler_tick用。 */
export function fiveMinWindowKey(now: Date): string {
  const m = Math.floor(now.getUTCMinutes() / 5) * 5;
  return `${hourWindowKey(now)}:${pad(m)}`;
}

export interface CronLockResult<T> {
  /** ロックを取得して本処理を実行したら true。二重起動で取得できなければ false。 */
  ran: boolean;
  result?: T;
}

/**
 * 同一 job名+時間窓 のセッションadvisory lockを取得してから `fn` を実行する。
 * 取得できなければ（同一窓が既に走行中なら）本処理を実行せず ran:false を返す
 * ＝呼び出し元は処理済み相当の2xxを返せる。lockは終了時に必ず解放する。
 */
export async function withCronWindowLock<T>(
  jobName: string,
  windowKey: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<CronLockResult<T>> {
  const key = cronWindowLockKey(jobName, windowKey);
  const client = await getPool().connect();
  try {
    const locked = await tryAdvisoryLock(client, key);
    if (!locked) return { ran: false };
    try {
      const result = await fn(client);
      return { ran: true, result };
    } finally {
      await advisoryUnlock(client, key);
    }
  } finally {
    client.release();
  }
}

export interface SchedulerTickResult {
  dispatched: number;
  recovered: StaleRecoveryResult;
}

/**
 * scheduler_tick の回収骨格（要件04 §1/§6）。処理順は cancel→enqueue→dispatch→回収だが、
 * 期限切れcancel・due slotのenqueueは M4 で実装する（ここではフックのみ）。M0では:
 * (3) dispatchされず queued のまま残ったジョブを scheduled_for昇順→created_at昇順で
 * 最大50件 dispatch し、(4) stale ジョブを回収する。dispatch関数は注入可能（テスト用）。
 */
export async function runSchedulerTick(
  dispatch: (jobId: string) => Promise<DispatchResult> = dispatchJob,
): Promise<SchedulerTickResult> {
  // TODO(M4): (1) 期限切れschedule jobのcancel＋schedule_missed通知
  // TODO(M4): (2) due slotのenqueue（schedule_run_keyで冪等）

  // (3) 未dispatchのqueuedジョブを再dispatch
  const rows = await withTransaction((c) =>
    c.query<{ id: string }>(
      `select id from generation_jobs
        where status = 'queued' and available_at <= now()
        order by scheduled_for asc nulls last, created_at asc
        limit 50`,
    ),
  );
  let dispatched = 0;
  for (const row of rows.rows) {
    const res = await dispatch(row.id);
    if (res.ok) dispatched += 1;
  }

  // (4) stale回収
  const recovered = await recoverStaleJobs();

  return { dispatched, recovered };
}
