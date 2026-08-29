import { withTransaction, pooledQueryable, runInPooledTx } from "../db/pool";
import { cleanupOldData, type CleanupResult } from "./schedule-cleanup";
import { dispatchJob, type DispatchResult } from "./dispatch";
import { enqueueDueScheduledDrafts, type EnqueueScheduledDraftsResult } from "./scheduled-drafts";
// **型だけ**を取る（`import type` は消えるので env 検証が module 読込で走らない）。
// 実体は route から注入する——`cron.ts` が env 依存モジュールをimportすると
// テストの module 読込で env 検証が走って落ちる（このファイル冒頭の dailyLimit と同じ理由）。
import type { OperatorAlertResult } from "../ops/operator-alert-server";
import type { AffiliateDb as AffiliateBatchDb } from "../affiliate/db";
import { enqueueDueSlots, type EnqueueResult } from "./schedule-enqueue";
import { recoverSchedule, type ScheduleRecoveryResult } from "./schedule-recovery";
import { recoverStaleJobs, type StaleRecoveryResult } from "./stale";
import { seedSystemPromptTemplates } from "../prompts/prompt-templates";

const pooledDb = pooledQueryable();

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

/**
 * UTCの20分バケット（`YYYY-MM-DDTHH:MM`）の窓key。ニュースBatchの取り込み用（T-M8-338）。
 * 重複起動を同じ窓へ畳むためのもので、間隔そのものは `vercel.json` の cron が決める。
 */
export function twentyMinWindowKey(now: Date): string {
  const m = Math.floor(now.getUTCMinutes() / 20) * 20;
  return `${hourWindowKey(now)}:${pad(m)}`;
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
  cleaned: CleanupResult;
  /** コード定数へ追随させた system default プロンプトの件数（通常は0）。 */
  promptsSynced: number;
  /** 作成した日次サマリ通知の件数（1日1通なので通常は0か1）。 */
  dailySummaries: number;
  /** 期限到来した日時予約の下書きを投稿へ流した結果（T-M8-157）。 */
  scheduledDrafts: EnqueueScheduledDraftsResult;
  /** doctorの判定を運営者へ届けた結果（T-M8-164）。1日1回。 */
  operatorAlert: OperatorAlertResult;
  /** 招待報酬の確定（1日1回）と月次Payout（月1回）の結果（T-M8-174）。 */
  affiliate: { settled: number; payoutsCreated: number };
  /** 契約期間の補完（1日1回・T-M8-258）。未注入・実行済みなら null。 */
  periodBackfill: { checked: number; updated: number; failed: number } | null;
  /** Xトークンの先回り更新（1時間に1回・T-M8-359）。未注入・実行済みなら null。 */
  xTokens: { targeted: number; refreshed: number; failed: number } | null;
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
    /**
     * doctorの判定を運営者へ届ける処理（T-M8-164）。**未注入なら送らない**（テスト・ローカル）。
     * 実体は route が渡す（`cron.ts` を env 非依存に保つため）。
     */
    runOperatorAlert?: (deps: {
      claimDay: (windowKey: string) => Promise<boolean>;
    }) => Promise<OperatorAlertResult>;
    /**
     * 招待報酬の確定と月次Payout（T-M8-174）。**未注入なら動かない**（テスト・ローカル）。
     * 実体は route が渡す（cron.ts を env 非依存に保つ）。
     */
    runAffiliateBatch?: (deps: {
      /**
       * claimと本処理を**同一トランザクション**で実行する（レビュー修正）。
       * claimを先にコミットすると、本処理の一度の失敗でその窓が消費済みになり
       * 月次Payoutが翌月まで作られない。失敗時はclaimごとロールバックされ、次のtickが再試行する。
       * 未claim（他のtickが実行済み）なら null を返す。
       */
      claimTx: <T>(
        windowKey: string,
        work: (db: AffiliateBatchDb) => Promise<T>,
      ) => Promise<T | null>;
    }) => Promise<{ settled: number; payoutsCreated: number }>;
    /**
     * 契約期間（`current_period_start`）が未同期の契約者を Stripe から埋める（T-M8-258 の移行）。
     * **未注入なら動かない**（テスト・ローカル）。実体は route が渡す。1日1回。
     */
    runPeriodBackfill?: (deps: {
      claimDay: (windowKey: string) => Promise<boolean>;
    }) => Promise<{ checked: number; updated: number; failed: number } | null>;
    /**
     * Xの連携を切らさないための先回り更新（T-M8-359）。**未注入なら動かない**（テスト・ローカル）。
     * 実体は route が渡す（cron.ts を env 非依存に保つ）。1時間に1回。
     */
    runXTokenRefresh?: (deps: {
      claimHour: (windowKey: string) => Promise<boolean>;
    }) => Promise<{ targeted: number; refreshed: number; failed: number } | null>;
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
    runInTx: runInPooledTx,
    dailyLimit: opts.dailyLimit ?? 50,
  });

  // (2') 期限到来した「日時予約された下書き」を投稿へ流す（T-M8-157）。
  // スロットのenqueueの直後に置くのは、この後の (3) dispatch で同じtick内に投稿まで進むため。
  const scheduledDrafts = await enqueueDueScheduledDrafts(pooledDb);

  /*
    (3) 未dispatchのqueuedジョブを再dispatch。
    **選抜はユーザー間で公平にする**（T-M8-196・レビュー修正）: 素の
    `order by scheduled_for, created_at limit 50` だと、1ユーザーの滞留（例: 失効中に溜まった
    日時予約）が50枠を独占し、他ユーザーの予約投稿・投稿分析が何時間も選ばれない
    （実DBで再現: 60件滞留で他ユーザーのjobがbatchに一切入らなかった）。
    ユーザーごとに古い順で番号を振り、「各ユーザーの1件目→2件目→…」の順で50件取る。
  */
  const rows = await withTransaction((c) =>
    c.query<{ id: string }>(
      `select id from (
         select j.id,
                row_number() over (
                  partition by xa.user_id
                  order by j.scheduled_for asc nulls last, j.created_at asc
                ) as user_rank,
                j.scheduled_for, j.created_at
           from generation_jobs j
           join x_accounts xa on xa.id = j.x_account_id
          where j.status = 'queued' and j.available_at <= now()
       ) ranked
        order by user_rank asc, scheduled_for asc nulls last, created_at asc
        limit 50`,
    ),
  );
  let dispatched = 0;
  for (const row of rows.rows) {
    const res = await dispatch(row.id);
    if (res.ok) dispatched += 1;
  }

  /*
    (3') doctorの判定を運営者へ1日1回届ける（T-M8-164）。**定時トリガーは増やさない**（原則3）。
    判定は揃っているのに届いておらず、ニュースが1.5日全滅しても運営者へ何も出なかった。
    dispatchの後に置くのは、その回の状態まで含めて見るため。
  */
  const operatorAlert = opts.runOperatorAlert
    ? await opts.runOperatorAlert({
        claimDay: (windowKey) =>
          withTransaction(async (client) => {
            const res = await client.query(
              `insert into cron_runs (job_name, window_key)
               values ('operator_alert', $1)
               on conflict (job_name, window_key) do nothing`,
              [windowKey],
            );
            return (res.rowCount ?? 0) > 0;
          }),
      }).catch((err) => {
        // 運営者への連絡が失敗しても tick は止めない（本体の処理を人への連絡で妨げない）。
        opts.onCleanupError?.("operator_alert", err);
        return { sent: false } as OperatorAlertResult;
      })
    : { sent: false, skipped: "no_recipient" as const };

  /*
    (3''') Xの連携を切らさない（T-M8-359・運営者の指示 2026-08-28）。**定時トリガーは増やさない**
    （原則3）。1時間に1回、期限が近いtokenを先回りで更新する——使わない日が続くと
    refresh tokenが寝たまま古くなり、久しぶりに使ったときに要再連携になる（T-M8-96）。
    利用者から見れば「何もしていないのに切れた」で、最も体験が悪い壊れ方をする。
  */
  const xTokens = opts.runXTokenRefresh
    ? await opts
        .runXTokenRefresh({
          claimHour: (windowKey) =>
            withTransaction(async (client) => {
              const res = await client.query(
                `insert into cron_runs (job_name, window_key)
                 values ('x_token_refresh', $1)
                 on conflict (job_name, window_key) do nothing`,
                [windowKey],
              );
              return (res.rowCount ?? 0) > 0;
            }),
        })
        .catch((err) => {
          // token更新の失敗で tick 全体を止めない（予約投稿の方が優先度が高い）。
          opts.onCleanupError?.("x_token_refresh", err);
          return null;
        })
    : null;

  /*
    (3'') 招待報酬（T-M8-174・invite_cp.md §8/§9）。確認期間を過ぎた報酬の確定（1日1回）と、
    月末締めのPayout作成（月1回）。**定時トリガーは増やさない**（原則3）。冪等キーは cron_runs。
  */
  const affiliate = opts.runAffiliateBatch
    ? await opts
        .runAffiliateBatch({
          claimTx: (windowKey, work) =>
            withTransaction(async (client) => {
              const res = await client.query(
                `insert into cron_runs (job_name, window_key)
                 values ('affiliate_batch', $1)
                 on conflict (job_name, window_key) do nothing`,
                [windowKey],
              );
              if ((res.rowCount ?? 0) === 0) return null;
              // 本処理が失敗したらclaimごとロールバック→次のtickが再試行する。
              return work(client);
            }),
        })
        .catch((err) => {
          opts.onCleanupError?.("affiliate_batch", err);
          return { settled: 0, payoutsCreated: 0 };
        })
    : { settled: 0, payoutsCreated: 0 };

  /*
    (3-d) 契約期間の補完（T-M8-258）。`current_period_start` が null の契約者を Stripe から埋める。
    運営者の再同期コマンドに頼らない（原則3）。1日1回・失敗しても tick は止めない。
  */
  const periodBackfill = opts.runPeriodBackfill
    ? await opts
        .runPeriodBackfill({
          claimDay: (windowKey) =>
            withTransaction(async (client) => {
              const res = await client.query(
                `insert into cron_runs (job_name, window_key)
                 values ('subscription_period_backfill', $1)
                 on conflict (job_name, window_key) do nothing`,
                [windowKey],
              );
              return (res.rowCount ?? 0) > 0;
            }),
        })
        .catch((err) => {
          opts.onCleanupError?.("subscription_period_backfill", err);
          return null;
        })
    : null;

  // (4) stale回収
  const recovered = await recoverStaleJobs();

  // （旧(4') queuedメール回収はT-M8-222で廃止——通知はアプリ内のみ）

  // (5) 保持cleanup（40日超データ・24時間超の未参照Storage画像。要件04 §14）。
  // 失敗しても他段・tick本体を止めない（cleanupOldData 内で段ごとに握り潰し onError へ記録）。
  const cleaned = await cleanupOldData({
    db: pooledDb,
    removeStorageObjects: opts.removeStorageObjects,
    imageBucket: opts.imageBucket,
    onError: opts.onCleanupError,
  });

  // (6) 日次サマリ（T-M7-29）。JST8時以降のtickで、その日の分を1通だけ作る（dedupe keyで冪等）。
  // 静かな劣化（分野が何日も0件など）は「いまの状態」だけでは見えないため、日をまたぐ推移を届ける。
  let dailySummaries = 0;
  try {
    const { deliverDailySummaries } = await import("../ops/daily-summary");
    const delivered = await deliverDailySummaries(pooledDb, new Date(Date.now()).toISOString(), {
      onError: (userId, err) => opts.onCleanupError?.(`daily_summary:${userId}`, err),
    });
    dailySummaries = delivered.created;
    /*
      **積み残しは黙って捨てない**（T-M8-291）。1回のtickで作れる人数には上限があり、
      残りは次のtick（5分後）が拾うが、**それが常態化していること自体は異常**なので
      運営者の気付ける経路へ載せる（毎朝のメール・doctorが読む `onCleanupError`）。
      「届いていない人がいる」を数字で言わないと、増えているのか一時的なのかが分からない。
    */
    if (delivered.remaining > 0) {
      opts.onCleanupError?.(
        "daily_summary",
        new Error(`日次サマリの積み残し ${delivered.remaining}人（次のtickで続きを作ります）`),
      );
    }
  } catch (err) {
    opts.onCleanupError?.("daily_summary", err);
  }

  // （旧(6.5) 毎朝の投稿分析の一括起票はT-M8-255で廃止——起票は画面の「分析を開始」ボタンだけが行う。
  //  dispatch漏れ分の回収は従来どおり上の dispatch フェーズが担う）

  // (7) プロンプトのsystem default行をコード定数へ追随させる（T-M7-37）。
  // 解決順は「account上書き → system default行 → コード定数」で、DB行が古いままだと
  // プロンプトを直しても反映されない。内容が同じときは何も書かないので通常は0件。
  // 失敗しても tick 本体を止めない（cleanupと同じ扱い）。
  let promptsSynced = 0;
  try {
    promptsSynced = await seedSystemPromptTemplates(pooledDb);
  } catch (err) {
    opts.onCleanupError?.("prompt_templates", err);
  }

  return {
    operatorAlert,
    affiliate,
    periodBackfill,
    xTokens,
    scheduledDrafts,
    scheduleRecovered,
    enqueued,
    dispatched,
    recovered,
    cleaned,
    promptsSynced,
    dailySummaries,
  };
}
