import { getPool, withTransaction } from "../db/pool";
import {
  recoverQueuedEmails,
  type RecoverQueuedEmailsDeps,
  type RecoverQueuedEmailsResult,
} from "../email/recover-queued";
import type { Queryable } from "../x/token-refresh";
import { cleanupOldData, type CleanupResult } from "./schedule-cleanup";
import { dispatchJob, type DispatchResult } from "./dispatch";
import { enqueueDueSlots, type EnqueueResult } from "./schedule-enqueue";
import { recoverSchedule, type ScheduleRecoveryResult } from "./schedule-recovery";
import { recoverStaleJobs, type StaleRecoveryResult } from "./stale";

const pooledDb: Queryable = {
  query: <T = unknown>(sql: string, params?: unknown[]) =>
    getPool().query(sql, params) as unknown as Promise<{
      rows: T[];
      rowCount: number | null;
    }>,
};

/**
 * 定時トリガー（cron）の共通部分（要件04 §6, 運用メモ §2, ADR-0002, ADR-0003）。
 * 各分野の本処理（news取得・slot enqueue・metrics収集・follower保存）は各機能
 * マイルストーンで実装し、ここでは時間窓の受付（window claim）と scheduler_tick の回収骨格のみ。
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

export interface CronClaimResult<T> {
  /** 時間窓の受付（claim）を確保して本処理を実行したら true。重複受付/再試行なら false。 */
  ran: boolean;
  result?: T;
}

/**
 * `job名 + 時間窓` の受付（window claim）を確保してから `fn` を実行する（要件04 §6, ADR-0003）。
 * `cron_runs` の `(job_name, window_key)` unique 制約に対する `insert ... on conflict do nothing`
 * で「同一時間窓の受付は高々一度」を保証する重複受付防止（dedup marker）。確保できなければ
 * （並行起動でも、完了後の HTTP 再試行・重複 Cron 起動でも）本処理を実行せず ran:false を返す
 * ＝呼び出し元は処理済み相当の 2xx を返せる。
 *
 * cron_runs は「受付済みか否か」だけを持ち、本処理の成否・完了は持たない。この行だけで本体成功を
 * 判断してはならない。完了状態の正本は、永続ジョブは `generation_jobs.status`/`finished_at`、
 * 状態ベースcron（tick/metrics/follower）は対象業務データの現在状態とする。
 *
 * 実行保証: Cronトリガーは (job_name, window_key) 単位で at-most-once。実処理の再試行付き
 * at-least-once 相当は永続ジョブ（generation_jobs）側が担い、状態ベースcronは次窓で現在状態を
 * 再走査して catch-up する（exactly-once は保証しない）。
 *
 * Supavisor transaction mode プーラ上でも安全: 接続を保持せず、claim は単一 transaction 内で
 * 完結し、`fn` は自前で（`withTransaction` 等で）都度接続を取得する（要件01 §3.2/§6）。
 * セッションscope advisory lock は checkout 間で保持されないため使わない。
 *
 * NOTE(M4): 受付とその他の DB 書き込みを同一 transaction で行いたい cron（例: scheduler_tick の
 * enqueue を受付と原子的にしたい場合）向けに、`withTransaction` 内で呼べる汎用プリミティブ
 * `tryClaimCronWindow(client, jobName, windowKey)` を M4 で追加できる。news_fetch は案I（各回が
 * 直近3時間分を重ねて取得）を採用し `generation_jobs` を使わないため本プリミティブに依存しない
 * （要件04 §2・ADR-0003）。
 */
export async function withCronWindowClaim<T>(
  jobName: string,
  windowKey: string,
  fn: () => Promise<T>,
): Promise<CronClaimResult<T>> {
  const claimed = await withTransaction(async (client) => {
    const res = await client.query(
      `insert into cron_runs (job_name, window_key)
       values ($1, $2)
       on conflict (job_name, window_key) do nothing`,
      [jobName, windowKey],
    );
    return (res.rowCount ?? 0) > 0;
  });
  if (!claimed) return { ran: false };

  const result = await fn();
  return { ran: true, result };
}

export interface SchedulerTickResult {
  scheduleRecovered: ScheduleRecoveryResult;
  enqueued: EnqueueResult;
  dispatched: number;
  recovered: StaleRecoveryResult;
  emailsRecovered: RecoverQueuedEmailsResult;
  cleaned: CleanupResult;
}

/**
 * scheduler_tick の本処理（要件04 §1/§6）。処理順は cancel→enqueue→dispatch→回収→cleanup:
 * (1) 期限切れschedule jobのcancel＋schedule_missed通知＋P-5(flag off)のcancel、
 * (2) due slotのenqueue、(3) queuedジョブを scheduled_for昇順→created_at昇順で最大50件 dispatch、
 * (4) stale ジョブの回収、(5) 40日超データ・未参照Storage画像の保持cleanup。
 * dispatch関数・Storage削除・cleanup失敗記録は注入可能（テスト用）。
 */
export async function runSchedulerTick(
  dispatch: (jobId: string) => Promise<DispatchResult> = dispatchJob,
  opts: {
    dailyLimit?: number;
    quotePostEnabled?: boolean;
    removeStorageObjects?: (paths: string[]) => Promise<void>;
    imageBucket?: string;
    onCleanupError?: (scope: string, err: unknown) => void;
    sendEmail?: RecoverQueuedEmailsDeps["send"];
    onEmailStaleWarning?: (oldestAgeMs: number) => void;
  } = {},
): Promise<SchedulerTickResult> {
  // (1) 期限切れschedule jobのcancel＋schedule_missed通知＋P-5(flag off)のcancel（要件04 §1/§7.2, T-M4-07）
  const scheduleRecovered = await recoverSchedule({
    db: pooledDb,
    quotePostEnabled: opts.quotePostEnabled ?? false,
  });

  // (2) due slotのenqueue（§7.1条件・schedule_run_keyで冪等・1起動500件, T-M4-06）。
  // env はここで読まず route から dailyLimit を渡す（cron.ts が env に依存すると test の module 読込で
  // env 検証が走るため。既定は X_DAILY_POST_LIMIT の既定値 50）。
  const enqueued = await enqueueDueSlots({
    db: pooledDb,
    runInTx: (fn) => withTransaction((client) => fn(client as unknown as Queryable)),
    dailyLimit: opts.dailyLimit ?? 50,
  });

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

  // (4') queuedメール回収（100件/10並列。要件04 §6/§14, T-M4-17）。sendEmail 未注入なら skip。
  const emailsRecovered = opts.sendEmail
    ? await recoverQueuedEmails({
        db: pooledDb,
        send: opts.sendEmail,
        onStaleWarning: opts.onEmailStaleWarning,
      })
    : { processed: 0, sent: 0, requeued: 0, failed: 0 };

  // (5) 保持cleanup（40日超データ・24時間超の未参照Storage画像。要件04 §14）。
  // 失敗しても他段・tick本体を止めない（cleanupOldData 内で段ごとに握り潰し onError へ記録）。
  const cleaned = await cleanupOldData({
    db: pooledDb,
    removeStorageObjects: opts.removeStorageObjects,
    imageBucket: opts.imageBucket,
    onError: opts.onCleanupError,
  });

  return { scheduleRecovered, enqueued, dispatched, recovered, emailsRecovered, cleaned };
}
