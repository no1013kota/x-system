import { withTransaction } from "../db/pool";
import { dispatchJob, type DispatchResult } from "./dispatch";
import { recoverStaleJobs, type StaleRecoveryResult } from "./stale";

/**
 * 定時トリガー（cron）の共通部分（要件04 §6, 運用メモ §2, ADR-0002, ADR-0003）。
 * 各分野の本処理（news取得・slot enqueue・metrics収集・follower保存）は各機能
 * マイルストーンで実装し、ここでは時間窓 lease と scheduler_tick の回収骨格のみ。
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
  /** lease行を確保して本処理を実行したら true。二重起動/再試行で確保できなければ false。 */
  ran: boolean;
  result?: T;
}

/**
 * `job名 + 時間窓` の lease行（`cron_runs`）を確保してから `fn` を実行する
 * （要件04 §6, ADR-0003）。`(job_name, window_key)` の unique 制約に対する
 * `insert ... on conflict do nothing` で「同一時間窓を高々一度だけ実行」を保証する。
 * 確保できなければ（並行起動でも、完了後の HTTP 再試行・重複 Cron 起動でも）本処理を
 * 実行せず ran:false を返す＝呼び出し元は処理済み相当の 2xx を返せる。
 *
 * Supavisor transaction mode プーラ上でも安全: 接続を保持せず、claim は単一 transaction
 * 内で完結し、`fn` は自前で（`withTransaction` 等で）都度接続を取得する
 * （要件01 §3.2/§6）。セッションscope advisory lock は checkout 間で保持されないため使わない。
 */
export async function withCronWindowLock<T>(
  jobName: string,
  windowKey: string,
  fn: () => Promise<T>,
): Promise<CronLockResult<T>> {
  const claimedId = await withTransaction(async (client) => {
    const res = await client.query<{ id: string }>(
      `insert into cron_runs (job_name, window_key)
       values ($1, $2)
       on conflict (job_name, window_key) do nothing
       returning id`,
      [jobName, windowKey],
    );
    return res.rows[0]?.id;
  });
  if (!claimedId) return { ran: false };

  const result = await fn();

  // 正常完了を記録する（起動の可観測性・将来の保持cleanup用）。失敗時は finished_at を
  // 残さず例外を伝播する（lease行は残るので同一窓は再実行されない＝二重実行を防ぐ）。
  await withTransaction((client) =>
    client.query(`update cron_runs set finished_at = now() where id = $1`, [
      claimedId,
    ]),
  );
  return { ran: true, result };
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
