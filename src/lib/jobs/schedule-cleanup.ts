import type { Queryable } from "../x/token-refresh";

/**
 * scheduler_tick の保持cleanup（要件04 §14, 要件01 §9, 要件02 §3.18, ADR-0003, T-M4-09）。
 * 40日を過ぎた保持データと、24時間を過ぎて未参照のStorage画像を各上限まで削除する。
 * 順序は §14 準拠: (1)news通知 → (2)未参照 news_items → (3)external_api_usage_events 明細 →
 * (4)cron_runs → (4b)news_fetch_outcomes → (5)未参照 Storage画像。news通知を先に消すことで、それが参照していた news_items が
 * 未参照になり削除対象へ移る。各段は独立の try/catch で、失敗しても他段・tick本体を止めず onError
 * （Sentry想定）へ記録して次回起動へ繰り越す（cleanup失敗は投稿系処理を失敗させない）。
 */

const RETENTION_DAYS = 40;
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
  newsItems: number;
  usageEvents: number;
  cronRuns: number;
  newsFetchOutcomes: number;
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

/** (3) 40日超の原価台帳明細を削除（要件02 §3.17/§3.18）。 */
async function deleteOldUsageEvents(db: Queryable): Promise<number> {
  const { rowCount } = await db.query(
    `delete from external_api_usage_events
      where id in (
        select id from external_api_usage_events
         where occurred_at < now() - make_interval(days => $1)
         order by occurred_at
         limit $2)`,
    [RETENTION_DAYS, BATCH],
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
    newsItems: 0,
    usageEvents: 0,
    cronRuns: 0,
    newsFetchOutcomes: 0,
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
  await step("news_items", async () => {
    result.newsItems = await deleteUnreferencedNewsItems(db);
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
  if (deps.removeStorageObjects && deps.imageBucket) {
    const removeStorageObjects = deps.removeStorageObjects;
    const imageBucket = deps.imageBucket;
    await step("images", async () => {
      result.images = await cleanupUnreferencedImages({ db, imageBucket, removeStorageObjects });
    });
  }
  return result;
}
