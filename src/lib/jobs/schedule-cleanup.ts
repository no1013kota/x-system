import { NEWS_MAX_STORED_ITEMS, NEWS_ORDER_BY } from "../news-items";
import type { Queryable } from "../x/token-refresh";

/**
 * scheduler_tick の保持cleanup（要件04 §14, 要件01 §9, 要件02 §3.18, ADR-0003, T-M4-09）。
 * 40日を過ぎた保持データと、24時間を過ぎて未参照のStorage画像を各上限まで削除する。
 * 順序は §14 準拠: (1)news通知 → (2)未参照 news_items（40日超＋新着500件超・T-M8-188） →
 * (3)external_api_usage_events 明細 →
 * (4)cron_runs → (4b)news_fetch_outcomes → (5)未参照 Storage画像。news通知を先に消すことで、それが参照していた news_items が
 * 未参照になり削除対象へ移る。各段は独立の try/catch で、失敗しても他段・tick本体を止めず onError
 * （Sentry想定）へ記録して次回起動へ繰り越す（cleanup失敗は投稿系処理を失敗させない）。
 */

const RETENTION_DAYS = 40;
/**
 * 終わったジョブとStripeイベントの保持期間（T-M8-363・運営者の指示 2026-08-29）。
 *
 * **どちらも削除経路が1つも無く、利用者が使うほど無限に増えていた**（原則4「費用が見える」）。
 * `generation_jobs` は1実行1行で `input` に上書きプロンプト（最大8,000字）まで入るため、
 * 積み上がりが最も速い。成果物（下書き・レポート）は別の表にあるので、
 * 終わったジョブの行を消しても**画面から何かが消えることはない**。
 *
 * **40日ではなく90日**にするのは `request_key` の冪等キーのため。全statusにまたがる恒久uniqueで、
 * 行を消すと同じキーで作り直せるようになる。予約の期限（60分）や日次キーの寿命を大きく超える
 * ところまで待てば、その差が意味を持つ場面が無くなる。
 */
const JOB_RETENTION_DAYS = 90;
/**
 * 分析用データの保持期間（T-M8-364・運営者の決定 2026-08-29「400日で消す」）。
 *
 * `x_timeline_posts`（分析のために読んだ自分の投稿）と `follower_snapshots`（1日1行）は
 * **削除経路が無く、アカウントが生きている限り増え続けていた**。
 * 400日にすると**1年より前**の分析レポートで引用投稿が空欄になり、
 * 1年より前のフォロワー推移が描けなくなる——1年ぶんの振り返りは残る幅として選んだ。
 */
const ANALYTICS_RETENTION_DAYS = 400;
/**
 * 原価台帳（external_api_usage_events）の保持期間（T-M8-373・運営者の決定 2026-08-29
 * 「明細も400日残す」）。以前は40日だったが、**誰が・どの機能で・いくら使ったかの唯一の記録**で、
 * 消えるとプラン別の採算を後から遡れない。/admin の内訳もここを読む。
 */
const COST_RETENTION_DAYS = 400;
const IMAGE_STALE_HOURS = 24;
const BATCH = 500;
const IMAGE_BATCH = 100;

export interface CleanupDeps {
  db: Queryable;
  /** private Storage の object 削除（server配線は admin.storage.remove）。未指定なら画像cleanupをskip。 */
  removeStorageObjects?: (paths: string[]) => Promise<void>;
  /** 画像 bucket（storage.objects.bucket_id）。removeStorageObjects と併せて指定する。 */
  imageBucket?: string;
  /** 段ごとの失敗記録（Sentry想定）。既定 no-op。 */
  onError?: (scope: string, err: unknown) => void;
}

export interface CleanupResult {
  newsNotifications: number;
  /** news以外で保持期間を過ぎた通知（summary など・T-M8-246）。 */
  otherNotifications: number;
  newsItems: number;
  usageEvents: number;
  cronRuns: number;
  newsFetchOutcomes: number;
  /** DB接続の待ちの記録（T-M8-198）。通常は0件のまま。 */
  poolEvents: number;
  /** 終わってから90日を過ぎたジョブ（T-M8-363）。 */
  generationJobs: number;
  /** 90日を過ぎたStripeイベント台帳（T-M8-363）。 */
  stripeEvents: number;
  /** 400日を過ぎた分析用データ（T-M8-364）。 */
  timelinePosts: number;
  followerSnapshots: number;
  /** 400日を過ぎたKPIスナップショット（T-M8-373）。 */
  kpiDaily: number;
  images: number;
}

/** (1) 40日超の news 通知を削除（news_items より先に消す。要件04 §14）。 */
async function deleteOldNewsNotifications(db: Queryable): Promise<number> {
  const { rowCount } = await db.query(
    `delete from notifications
      where id in (
        select id from notifications
         where type = 'news' and created_at < now() - make_interval(days => $1)
         order by created_at
         limit $2)`,
    [RETENTION_DAYS, BATCH],
  );
  return rowCount ?? 0;
}

/**
 * (1b) 保持期間を過ぎた**news以外の通知**を削除（T-M8-246）。
 *
 * 以前は `type='news'` だけを消していたため、毎日1通作られる `summary` などが**永久に積もった**
 * （利用者が増えるほど線形に増え、無料枠のDB容量を静かに食う）。既読を先に消し、
 * 未読は残る側にしておく（読む前に消えると「来たはずの知らせが無い」になる）。
 */
async function deleteOldNotifications(db: Queryable): Promise<number> {
  const { rowCount } = await db.query(
    `delete from notifications
      where id in (
        select id from notifications
         where type <> 'news' and created_at < now() - make_interval(days => $1)
         order by (read_at is null), created_at
         limit $2)`,
    [RETENTION_DAYS, BATCH],
  );
  return rowCount ?? 0;
}

/** (2) 40日超かつ draft・通知payload のどちらからも参照されない news_items を削除。 */
async function deleteUnreferencedNewsItems(db: Queryable): Promise<number> {
  const { rowCount } = await db.query(
    `delete from news_items
      where id in (
        select ni.id from news_items ni
         where ni.fetched_at < now() - make_interval(days => $1)
           and not exists (select 1 from drafts d where d.source_news_item_id = ni.id)
           and not exists (
             select 1 from notifications n
              where jsonb_exists(n.payload->'news_item_ids', ni.id::text))
         order by ni.fetched_at
         limit $2)`,
    [RETENTION_DAYS, BATCH],
  );
  return rowCount ?? 0;
}

/**
 * (2b) 新着順で `NEWS_MAX_STORED_ITEMS`（500件）を超えた news_items を削除する
 * （運営者の指示 2026-08-22・T-M8-188。DBの肥大防止）。一覧の表示上限と同じ並び
 * （`NEWS_ORDER_BY`）で数え、draft・通知payloadから参照される行は40日cleanupと同じ
 * ガードで残す（参照付きの古い行は表示上限の外なので画面には出ない）。
 */
async function trimNewsItemsOverCap(db: Queryable): Promise<number> {
  // 参照ガードは**LIMITより前**（サブクエリ内）に置く。DELETE側に置くと、参照付きの行が
  // バッチ500枠を食い潰して選択窓が先へ進まず、未参照の古い行が永久に残る
  // （敵対的レビューで実DB再現・T-M8-192。rn自体は全行で数え、削除候補の選抜だけを参照除外後に絞る）。
  const { rowCount } = await db.query(
    `delete from news_items
      where id in (
        select ranked.id from (
          select id, row_number() over (order by ${NEWS_ORDER_BY}) as rn
            from news_items) ranked
         where ranked.rn > $1
           and not exists (select 1 from drafts d where d.source_news_item_id = ranked.id)
           and not exists (
             select 1 from notifications n
              where jsonb_exists(n.payload->'news_item_ids', ranked.id::text))
         limit $2)`,
    [NEWS_MAX_STORED_ITEMS, BATCH],
  );
  return rowCount ?? 0;
}

/** (3) 400日超の原価台帳明細を削除（要件02 §3.17/§3.18・T-M8-373で40→400日）。 */
async function deleteOldUsageEvents(db: Queryable): Promise<number> {
  const { rowCount } = await db.query(
    `delete from external_api_usage_events
      where id in (
        select id from external_api_usage_events
         where occurred_at < now() - make_interval(days => $1)
         order by occurred_at
         limit $2)`,
    [COST_RETENTION_DAYS, BATCH],
  );
  return rowCount ?? 0;
}

/** (3b) 400日超のKPIスナップショットを削除（T-M8-373。運営者の指示は「400日分持つ」）。 */
async function deleteOldKpiDaily(db: Queryable): Promise<number> {
  const { rowCount } = await db.query(
    `delete from kpi_daily
      where metric_date < current_date - make_interval(days => $1)`,
    [ANALYTICS_RETENTION_DAYS],
  );
  return rowCount ?? 0;
}

/** (4) claimed_at が40日超の cron_runs（重複受付防止行）を削除（ADR-0003・要件02 §3.18）。 */
async function deleteOldCronRuns(db: Queryable): Promise<number> {
  const { rowCount } = await db.query(
    `delete from cron_runs
      where id in (
        select id from cron_runs
         where claimed_at < now() - make_interval(days => $1)
         order by claimed_at
         limit $2)`,
    [RETENTION_DAYS, BATCH],
  );
  return rowCount ?? 0;
}

/**
 * (4d) 終わってから `JOB_RETENTION_DAYS` を過ぎた `generation_jobs` を削除（T-M8-363）。
 *
 * **終端したものだけ**を消す（queued/running は絶対に消さない——実行中の行が消えると
 * 実行側が「job が無い」で黙って終わる）。子ジョブ（`parent_job_id`）を先に消してから親を消す。
 */
async function deleteOldGenerationJobs(db: Queryable): Promise<number> {
  const { rowCount } = await db.query(
    `delete from generation_jobs
      where id in (
        select id from generation_jobs
         where status in ('succeeded', 'failed', 'canceled')
           and finished_at is not null
           and finished_at < now() - make_interval(days => $1)
           -- 親が残っている子は先に消えるが、親は子が消えるまで残す（FKの向きに合わせる）
           and not exists (
             select 1 from generation_jobs child where child.parent_job_id = generation_jobs.id
           )
         order by finished_at
         limit $2)`,
    [JOB_RETENTION_DAYS, BATCH],
  );
  return rowCount ?? 0;
}

/**
 * (4e) `JOB_RETENTION_DAYS` を過ぎた `stripe_events`（webhookの重複受付を防ぐ台帳）を削除（T-M8-363）。
 *
 * 重複が届くのはStripeの再送窓（数日）の中だけなので、90日を過ぎた行が守るものは無い。
 */
async function deleteOldStripeEvents(db: Queryable): Promise<number> {
  const { rowCount } = await db.query(
    `delete from stripe_events
      where event_id in (
        select event_id from stripe_events
         where event_created_at < now() - make_interval(days => $1)
         order by event_created_at
         limit $2)`,
    [JOB_RETENTION_DAYS, BATCH],
  );
  return rowCount ?? 0;
}

/**
 * (4f) `ANALYTICS_RETENTION_DAYS` を過ぎた分析用データを削除（T-M8-364）。
 *
 * **投稿日時で切る**（取得日ではない）。取り込み直しで `fetched_at` が新しくなっても、
 * 古い投稿は古い投稿のまま扱う。
 */
async function deleteOldTimelinePosts(db: Queryable): Promise<number> {
  const { rowCount } = await db.query(
    `delete from x_timeline_posts
      where id in (
        select id from x_timeline_posts
         where posted_at < now() - make_interval(days => $1)
         order by posted_at
         limit $2)`,
    [ANALYTICS_RETENTION_DAYS, BATCH],
  );
  return rowCount ?? 0;
}

/** (4g) `ANALYTICS_RETENTION_DAYS` を過ぎたフォロワー数の記録を削除（T-M8-364）。 */
async function deleteOldFollowerSnapshots(db: Queryable): Promise<number> {
  const { rowCount } = await db.query(
    `delete from follower_snapshots
      where id in (
        select id from follower_snapshots
         where snapshot_date < (now() - make_interval(days => $1))::date
         order by snapshot_date
         limit $2)`,
    [ANALYTICS_RETENTION_DAYS, BATCH],
  );
  return rowCount ?? 0;
}

/** (4c) occurred_at が40日超の db_pool_events（接続待ちの記録）を削除（T-M8-198）。 */
async function deleteOldPoolEvents(db: Queryable): Promise<number> {
  const { rowCount } = await db.query(
    `delete from db_pool_events
      where id in (
        select id from db_pool_events
         where occurred_at < now() - make_interval(days => $1)
         order by occurred_at
         limit $2)`,
    [RETENTION_DAYS, BATCH],
  );
  return rowCount ?? 0;
}

/** (4b) ran_at が40日超の news_fetch_outcomes（分野ごとの取得結果）を削除（要件02 §3.18・T-M7-40）。 */
async function deleteOldNewsFetchOutcomes(db: Queryable): Promise<number> {
  const { rowCount } = await db.query(
    `delete from news_fetch_outcomes
      where id in (
        select id from news_fetch_outcomes
         where ran_at < now() - make_interval(days => $1)
         order by ran_at
         limit $2)`,
    [RETENTION_DAYS, BATCH],
  );
  return rowCount ?? 0;
}

/** 画像 storage path が現行 draft から参照されているか（drafts.images[].storage_path）。 */
async function isImageReferenced(db: Queryable, path: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `select 1 from drafts d
      where d.images @> jsonb_build_array(jsonb_build_object('storage_path', $1::text))
      limit 1`,
    [path],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * (5) 作成24時間超で未参照の Storage画像を best effort で削除（1起動 IMAGE_BATCH 件）。
 * 候補抽出→削除直前に再度参照確認し、参照が付いた object は削除しない（要件01 §9・要件04 §14）。
 */
async function cleanupUnreferencedImages(deps: {
  db: Queryable;
  imageBucket: string;
  removeStorageObjects: (paths: string[]) => Promise<void>;
}): Promise<number> {
  const { db } = deps;
  const { rows } = await db.query<{ name: string }>(
    `select o.name from storage.objects o
      where o.bucket_id = $1
        and o.created_at < now() - make_interval(hours => $2)
        and not exists (
          select 1 from drafts d
           where d.images @> jsonb_build_array(jsonb_build_object('storage_path', o.name)))
      order by o.created_at
      limit $3`,
    [deps.imageBucket, IMAGE_STALE_HOURS, IMAGE_BATCH],
  );
  const candidates = rows.map((r) => r.name);
  if (candidates.length === 0) return 0;

  // 削除直前の再確認: 抽出後に参照が付いた object は除外する。
  const stillUnref: string[] = [];
  for (const name of candidates) {
    if (!(await isImageReferenced(db, name))) stillUnref.push(name);
  }
  if (stillUnref.length === 0) return 0;
  await deps.removeStorageObjects(stillUnref);
  return stillUnref.length;
}

/**
 * 保持cleanup 一式を順に実行する。各段は独立に try/catch し、失敗は onError へ記録して継続する
 * （cleanup失敗が tick 本体・投稿系処理を失敗させない。要件04 §14）。
 */
export async function cleanupOldData(deps: CleanupDeps): Promise<CleanupResult> {
  const { db } = deps;
  const onError = deps.onError ?? (() => {});
  const result: CleanupResult = {
    newsNotifications: 0,
    otherNotifications: 0,
    newsItems: 0,
    usageEvents: 0,
    cronRuns: 0,
    newsFetchOutcomes: 0,
    poolEvents: 0,
    generationJobs: 0,
    stripeEvents: 0,
    timelinePosts: 0,
    followerSnapshots: 0,
    kpiDaily: 0,
    images: 0,
  };

  const step = async (scope: string, fn: () => Promise<void>): Promise<void> => {
    try {
      await fn();
    } catch (err) {
      onError(scope, err);
    }
  };

  await step("news_notifications", async () => {
    result.newsNotifications = await deleteOldNewsNotifications(db);
  });
  await step("other_notifications", async () => {
    result.otherNotifications = await deleteOldNotifications(db);
  });
  await step("news_items", async () => {
    result.newsItems = await deleteUnreferencedNewsItems(db);
    result.newsItems += await trimNewsItemsOverCap(db);
  });
  await step("usage_events", async () => {
    result.usageEvents = await deleteOldUsageEvents(db);
  });
  await step("cron_runs", async () => {
    result.cronRuns = await deleteOldCronRuns(db);
  });
  await step("news_fetch_outcomes", async () => {
    result.newsFetchOutcomes = await deleteOldNewsFetchOutcomes(db);
  });
  await step("db_pool_events", async () => {
    result.poolEvents = await deleteOldPoolEvents(db);
  });
  await step("generation_jobs", async () => {
    result.generationJobs = await deleteOldGenerationJobs(db);
  });
  await step("stripe_events", async () => {
    result.stripeEvents = await deleteOldStripeEvents(db);
  });
  await step("x_timeline_posts", async () => {
    result.timelinePosts = await deleteOldTimelinePosts(db);
  });
  await step("follower_snapshots", async () => {
    result.followerSnapshots = await deleteOldFollowerSnapshots(db);
  });
  await step("kpi_daily", async () => {
    result.kpiDaily = await deleteOldKpiDaily(db);
  });
  if (deps.removeStorageObjects && deps.imageBucket) {
    const removeStorageObjects = deps.removeStorageObjects;
    const imageBucket = deps.imageBucket;
    await step("images", async () => {
      result.images = await cleanupUnreferencedImages({ db, imageBucket, removeStorageObjects });
    });
  }
  return result;
}
