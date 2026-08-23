import { EXECUTABLE_SUBSCRIPTION_STATUSES } from "@/lib/auth/subscription-access";
import { z } from "zod";

import { isXAuthError, type XTweetMetrics } from "../x/client";
import type { Queryable } from "../x/token-refresh";

/**
 * metrics_collector 定時トリガーの中核（K-1, 要件04 §6/§13, 要件02 §4.9, T-M5-12/T-M5-13）。DB・X読取・時刻・
 * deadline を注入し純粋に保つ。dueなdraft（posted全tweet_id＋failedのremaining、rollback削除IDは除外）の
 * 未取得checkpoint（1/7/30日）をuser token別・最大100件/バッチで読み、`drafts.tweet_metrics` の
 * tweet_id配下 checkpoint へ保存（取得不能fieldはnull・0と区別）、`next_metrics_at` を次dueへ前進する。
 * T-M5-13: 30日checkpointは投稿後29〜30日未満で取得（non-public取得期限）、期限超過はprivate=nullで確定。
 * 成功読取で不在（削除/取得不能確定）のtweet_idは unavailable_at を立て以後の対象から外す。対象tweet_idが
 * すべて30日取得済みまたはunavailableなら metrics_completed_at を設定して回収対象から外す。
 */

export const METRICS_ACCOUNT_LIMIT = 50;
export const METRICS_TWEET_ID_LIMIT = 500;
export const METRICS_BATCH_SIZE = 100;
export const METRICS_MAX_PARALLEL = 10;
export const CHECKPOINT_DAYS = [1, 7, 30] as const;
/** 30日checkpointの収集開始日（投稿後29日〜30日未満の窓で non-public metrics を取得する・要件04 §13）。 */
export const CHECKPOINT_30_DUE_DAYS = 29;
/** non-public metrics（profile_clicks）の取得期限（投稿後30日）。超過後は private を null で確定する。 */
export const NONPUBLIC_DEADLINE_DAYS = 30;
const DAY_MS = 86_400_000;

export type CheckpointDay = (typeof CHECKPOINT_DAYS)[number];

/** 1つのcheckpoint値（取得不能fieldはnull・要件02 §4.9）。 */
export const checkpointMetricsSchema = z.object({
  impressions: z.number().int().nullable(),
  likes: z.number().int().nullable(),
  reposts: z.number().int().nullable(),
  profile_clicks: z.number().int().nullable(),
  collected_at: z.string(),
});
export type CheckpointMetrics = z.infer<typeof checkpointMetricsSchema>;

/** tweet_id 配下の構造（checkpoints は "1"/"7"/"30" のみ）。 */
export interface TweetMetricEntry {
  checkpoints: Partial<Record<string, CheckpointMetrics>>;
  latest_checkpoint_days: number | null;
  unavailable_at: string | null;
}
export type TweetMetricsMap = Record<string, TweetMetricEntry>;

interface DueDraftRow {
  id: string;
  x_account_id: string;
  user_id: string;
  status: string;
  posted_at: string | null;
  next_metrics_at: string | null;
  tweet_ids: string[];
  last_post_error: { remaining_tweet_ids?: string[]; deleted_tweet_ids?: string[] } | null;
  tweet_metrics: TweetMetricsMap;
}

export interface DueDraft {
  draftId: string;
  xAccountId: string;
  userId: string;
  postedAt: Date;
  nextMetricsAt: Date;
  targetDays: CheckpointDay;
  /** targetDays のcheckpoint未取得の対象tweet_id（最大 METRICS_BATCH_SIZE 件）。 */
  tweetIds: string[];
  /** この draft の全対象tweet_id（完了判定用。posted全＋failed remaining−rollback削除）。 */
  allTargetIds: string[];
}

/** posted全tweet_id＋failedのremaining、rollback削除確認済み（deleted_tweet_ids）は除外。 */
export function targetTweetIds(row: {
  status: string;
  tweet_ids: string[];
  last_post_error: { remaining_tweet_ids?: string[]; deleted_tweet_ids?: string[] } | null;
}): string[] {
  const posted = row.status === "posted" ? row.tweet_ids ?? [] : [];
  const remaining = row.status === "failed" ? row.last_post_error?.remaining_tweet_ids ?? [] : [];
  const deleted = new Set(row.last_post_error?.deleted_tweet_ids ?? []);
  return [...new Set([...posted, ...remaining])].filter((id) => id && !deleted.has(id));
}

/** next_metrics_at と posted_at の差から現在の対象checkpoint日数（1/7/30へスナップ）。 */
export function targetCheckpointDays(postedAt: Date, nextMetricsAt: Date): CheckpointDay {
  const elapsedDays = Math.round((nextMetricsAt.getTime() - postedAt.getTime()) / DAY_MS);
  return CHECKPOINT_DAYS.find((d) => elapsedDays <= d) ?? 30;
}

/** targetDays 収集後の次 next_metrics_at。7日後は 29日dueへ（29〜30日窓で30日checkpointを取る）。30日は完了。 */
export function nextDueAfter(targetDays: CheckpointDay, postedAt: Date): Date | null {
  if (targetDays === 1) return new Date(postedAt.getTime() + 7 * DAY_MS);
  if (targetDays === 7) return new Date(postedAt.getTime() + CHECKPOINT_30_DUE_DAYS * DAY_MS);
  return null;
}

function pick(
  pub: Record<string, number> | null,
  nonPub: Record<string, number> | null,
  keys: string[],
): number | null {
  for (const k of keys) {
    const v = pub?.[k] ?? nonPub?.[k];
    if (typeof v === "number") return v;
  }
  return null;
}

/**
 * XTweetMetrics → checkpoint値（取得不能は null・要件02 §4.9・§13 public+non_public）。
 * privateAvailable=false（投稿後30日の non-public 取得期限超過）なら profile_clicks を null で確定する。
 */
export function toCheckpointMetrics(
  tweet: XTweetMetrics,
  collectedAt: string,
  privateAvailable = true,
): CheckpointMetrics {
  const pub = tweet.publicMetrics;
  const nonPub = tweet.nonPublicMetrics;
  return {
    impressions: pick(pub, nonPub, ["impression_count"]),
    likes: pick(pub, nonPub, ["like_count"]),
    reposts: pick(pub, nonPub, ["retweet_count"]),
    profile_clicks: privateAvailable ? pick(pub, nonPub, ["user_profile_clicks"]) : null,
    collected_at: collectedAt,
  };
}

/** tweet_id を unavailable 確定にする（削除/取得不能。以後の due 対象から外す・要件04 §13）。checkpointsは保持。 */
export function applyUnavailable(
  current: TweetMetricsMap,
  tweetId: string,
  at: string,
): TweetMetricsMap {
  const entry = current[tweetId] ?? { checkpoints: {}, latest_checkpoint_days: null, unavailable_at: null };
  if (entry.unavailable_at) return current;
  return { ...current, [tweetId]: { ...entry, unavailable_at: at } };
}

/**
 * 既存 tweet_metrics へ 1件のcheckpointを反映する（純粋・不変更新）。同じcheckpointは値と collected_at を
 * 上書きし、他checkpointは削除しない。latest_checkpoint_days は max で前進のみ（過去へ戻さない）。
 */
export function applyCheckpoint(
  current: TweetMetricsMap,
  tweetId: string,
  days: CheckpointDay,
  metrics: CheckpointMetrics,
): TweetMetricsMap {
  const entry = current[tweetId] ?? { checkpoints: {}, latest_checkpoint_days: null, unavailable_at: null };
  const checkpoints = { ...entry.checkpoints, [String(days)]: metrics };
  const latest = Math.max(entry.latest_checkpoint_days ?? 0, days);
  return {
    ...current,
    [tweetId]: { ...entry, checkpoints, latest_checkpoint_days: latest },
  };
}

export interface MetricsCollectorDeps {
  db: Queryable;
  /** 読み書きを1 transactionで束ねる（select ... for update + update を原子的に）。 */
  runInTx: <T>(fn: (tx: Queryable) => Promise<T>) => Promise<T>;
  /** 対象アカウントの有効access token（token復号/refresh）。取得不能なら null でそのアカウントをスキップ。 */
  getAccessToken: (xAccountId: string) => Promise<string | null>;
  /** user token別に tweet_id を読む（≤100件/呼び出し。呼び出し側で原価台帳へ記録）。 */
  readTweetMetrics: (input: {
    xAccountId: string;
    userId: string;
    accessToken: string;
    tweetIds: string[];
    keyBase: string;
  }) => Promise<XTweetMetrics[]>;
  now: Date;
  /** Function deadline 超過なら true（未開始分を次回毎時起動へ委ねる）。 */
  isPastDeadline: () => boolean;
  /** account/draft単位の失敗を隔離記録する（run全体を落とさない）。 */
  onError?: (scope: { xAccountId: string; draftId?: string }, err: unknown) => void;
  limits?: { accounts?: number; tweetIds?: number; batch?: number; parallel?: number };
}

export interface MetricsCollectorResult {
  accountsProcessed: number;
  draftsProcessed: number;
  tweetIdsRead: number;
  /** 上限またはdeadlineで未処理を次回へ残したか。 */
  deferred: boolean;
  /**
   * 読み取り／保存に失敗した件数（T-M8-239）。**0件と「全部失敗して0件」を区別する**ため、
   * 結果に数として載せる（CLAUDE.md 原則1）。以前は握って `console.error` に流すだけで、
   * cronの応答にも doctor にも現れなかった。
   */
  failed: number;
}

/**
 * due な draft を最大 accounts/tweetIds 件選び、user token別・最大 batch 件/リクエストで読取→checkpoint保存→
 * next_metrics_at 前進。account はユニーク単位で最大 parallel 並列。deadline 超過分は deferred で次回へ委ねる。
 */
export async function executeMetricsCollection(
  deps: MetricsCollectorDeps,
): Promise<MetricsCollectorResult> {
  const accountLimit = deps.limits?.accounts ?? METRICS_ACCOUNT_LIMIT;
  const tweetIdLimit = deps.limits?.tweetIds ?? METRICS_TWEET_ID_LIMIT;
  const batch = deps.limits?.batch ?? METRICS_BATCH_SIZE;
  const parallel = deps.limits?.parallel ?? METRICS_MAX_PARALLEL;

  const { dueByAccount, advanceOnly, deferred: selectionDeferred } = await selectDue(deps.db, {
    now: deps.now,
    accountLimit,
    tweetIdLimit,
  });

  const accounts = [...dueByAccount.keys()];
  let accountsProcessed = 0;
  let draftsProcessed = 0;
  let tweetIdsRead = 0;
  let deferred = selectionDeferred;
  // 失敗件数（T-M8-239）。握って握りつぶすと「0件」と「全部失敗」が同じ見え方になる。
  let failed = 0;

  // 収集対象IDが無い due draft（例: 全ID取得済み、ambiguous_delete のみ）は token/読取不要で
  // next_metrics_at だけ前進させ due 窓から外す（永久ループ防止）。
  for (const draft of advanceOnly) {
    if (deps.isPastDeadline()) {
      deferred = true;
      break;
    }
    try {
      await saveDraftCheckpoints(deps, draft, []);
      draftsProcessed += 1;
    } catch (err) {
      failed += 1;
      deps.onError?.({ xAccountId: draft.xAccountId, draftId: draft.draftId }, err);
    }
  }

  const runAccount = async (xAccountId: string): Promise<void> => {
    if (deps.isPastDeadline()) {
      deferred = true;
      return;
    }
    const drafts = dueByAccount.get(xAccountId) ?? [];
    let token: string | null;
    try {
      token = await deps.getAccessToken(xAccountId);
    } catch (err) {
      failed += 1;
      deps.onError?.({ xAccountId }, err);
      return;
    }
    if (!token) return; // token取得不能はスキップ（次窓で再走査）
    accountsProcessed += 1;
    for (const draft of drafts) {
      if (deps.isPastDeadline()) {
        deferred = true;
        return;
      }
      try {
        const read = await readInBatches(deps, xAccountId, token, draft, batch);
        tweetIdsRead += read.length;
        await saveDraftCheckpoints(deps, draft, read);
        draftsProcessed += 1;
      } catch (err) {
        // 読取/保存失敗は run 全体を落とさず隔離。next_metrics_at は据え置きで次窓が再走査する。
        failed += 1;
        deps.onError?.({ xAccountId, draftId: draft.draftId }, err);
        if (isXAuthError(err)) return; // 失効はアカウント単位でスキップ（getAccessToken null 相当）
        deferred = true; // 一時失敗（429/5xx枯渇等）は次窓へ
      }
    }
  };

  // account をユニーク単位で最大 parallel 並列に処理する（user token を混在させない）。
  let cursor = 0;
  const workers = Array.from({ length: Math.min(parallel, accounts.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= accounts.length) return;
      await runAccount(accounts[i]);
    }
  });
  await Promise.all(workers);

  return { accountsProcessed, draftsProcessed, tweetIdsRead, deferred, failed };
}

async function selectDue(
  db: Queryable,
  opts: { now: Date; accountLimit: number; tweetIdLimit: number },
): Promise<{ dueByAccount: Map<string, DueDraft[]>; advanceOnly: DueDraft[]; deferred: boolean }> {
  const { rows } = await db.query<DueDraftRow>(
    `select d.id, d.x_account_id, xa.user_id, d.status, d.posted_at, d.next_metrics_at,
            d.tweet_ids, d.last_post_error, d.tweet_metrics
       from drafts d
       join x_accounts xa on xa.id = d.x_account_id
       join profiles p on p.id = xa.user_id
      where d.next_metrics_at is not null
        and d.next_metrics_at <= $1
        and d.metrics_completed_at is null
        and xa.status = 'active'
        -- 契約が有効な利用者だけ（T-M8-267）。解約後もX読取（$0.005/件）が最大30日続いていた。
        -- follower_snapshot（T-M8-257）と同じゲートで、こちらだけ抜けていた。
        and p.subscription_status::text = any($2)
      order by d.next_metrics_at asc, d.id asc
      limit 2000`,
    [opts.now.toISOString(), EXECUTABLE_SUBSCRIPTION_STATUSES],
  );

  const dueByAccount = new Map<string, DueDraft[]>();
  const advanceOnly: DueDraft[] = [];
  let tweetIdCount = 0;
  let deferred = false;

  for (const row of rows) {
    // posted_at は checkpoint schedule のアンカー（成功=投稿時刻、部分失敗=残存確定時刻。post-publish が両経路で
    // 設定する）。アンカー欠落行（旧データ等）は誤アンカー（epoch）を避けてスキップする。
    if (!row.posted_at || !row.next_metrics_at) continue;
    const postedAt = new Date(row.posted_at);
    const nextMetricsAt = new Date(row.next_metrics_at);
    const targetDays = targetCheckpointDays(postedAt, nextMetricsAt);
    const metricsMap = row.tweet_metrics ?? {};
    const allTargetIds = targetTweetIds(row);
    const base: Omit<DueDraft, "tweetIds"> = {
      draftId: row.id,
      xAccountId: row.x_account_id,
      userId: row.user_id,
      postedAt,
      nextMetricsAt,
      targetDays,
      allTargetIds,
    };
    // targetDays を未取得かつ unavailable でない対象IDに絞る（未取得のIDから最大 batch 件）。
    const pending = allTargetIds.filter((id) => {
      const entry = metricsMap[id];
      return !entry?.checkpoints?.[String(targetDays)] && !entry?.unavailable_at;
    });
    if (pending.length === 0) {
      // 収集対象なし（全ID取得済み・ambiguous_delete のみ等）でも next_metrics_at を前進させ
      // due 窓から外す（永久ループ防止）。token/読取は不要。
      advanceOnly.push({ ...base, tweetIds: [] });
      continue;
    }

    const isNewAccount = !dueByAccount.has(row.x_account_id);
    if (isNewAccount && dueByAccount.size >= opts.accountLimit) {
      deferred = true;
      continue;
    }
    if (tweetIdCount + pending.length > opts.tweetIdLimit) {
      deferred = true;
      continue;
    }
    tweetIdCount += pending.length;
    const list = dueByAccount.get(row.x_account_id) ?? [];
    list.push({ ...base, tweetIds: pending.slice(0, METRICS_BATCH_SIZE) });
    dueByAccount.set(row.x_account_id, list);
  }

  return { dueByAccount, advanceOnly, deferred };
}

async function readInBatches(
  deps: MetricsCollectorDeps,
  xAccountId: string,
  accessToken: string,
  draft: DueDraft,
  batch: number,
): Promise<XTweetMetrics[]> {
  const out: XTweetMetrics[] = [];
  for (let offset = 0; offset < draft.tweetIds.length; offset += batch) {
    const chunk = draft.tweetIds.slice(offset, offset + batch);
    const tweets = await deps.readTweetMetrics({
      xAccountId,
      userId: draft.userId,
      accessToken,
      tweetIds: chunk,
      keyBase: `metrics:${draft.draftId}:d${draft.targetDays}:${offset / batch}`,
    });
    out.push(...tweets);
  }
  return out;
}

/**
 * 読取結果を tweet_metrics へ反映し next_metrics_at を前進する（select ... for update + update を1 txで原子的に）。
 * tweet_metrics は tx 内で再読込してmergeし、他checkpoint・unavailableを保持。
 * - 成功読取に含まれた tweet は targetDays checkpoint を保存（30日超過時は private=null）。
 * - 対象IDが成功読取に不在（削除/取得不能確定）なら unavailable_at を立てる（tweets=[] の advance-only 呼び出しは
 *   実際の読取をしていないため unavailable にはしない）。
 * - 全対象IDが 30日取得済み or unavailable なら metrics_completed_at を確定、そうでなければ targetDays の次dueへ。
 */
async function saveDraftCheckpoints(
  deps: MetricsCollectorDeps,
  draft: DueDraft,
  tweets: XTweetMetrics[],
): Promise<void> {
  const collectedAt = deps.now.toISOString();
  // non-public 取得期限（投稿後30日）超過なら private（profile_clicks）は null で確定する。
  const privateAvailable =
    deps.now.getTime() < draft.postedAt.getTime() + NONPUBLIC_DEADLINE_DAYS * DAY_MS;
  const didRead = draft.tweetIds.length > 0; // advance-only（tweets収集なし）は不在=unavailable にしない

  await deps.runInTx(async (tx) => {
    const fresh = (
      await tx.query<{ tweet_metrics: TweetMetricsMap; metrics_completed_at: string | null }>(
        `select tweet_metrics, metrics_completed_at from drafts where id = $1 for update`,
        [draft.draftId],
      )
    ).rows[0];
    if (!fresh || fresh.metrics_completed_at) return; // 既に完了確定なら触らない

    const byId = new Map(tweets.map((t) => [t.id, t]));
    let map = fresh.tweet_metrics ?? {};
    for (const id of draft.tweetIds) {
      const tweet = byId.get(id);
      if (tweet) {
        map = applyCheckpoint(map, id, draft.targetDays, toCheckpointMetrics(tweet, collectedAt, privateAvailable));
      } else if (didRead) {
        // 成功読取に不在＝削除/取得不能確定。unavailable にして以後の対象から外す（要件04 §13）。
        map = applyUnavailable(map, id, collectedAt);
      }
    }

    // 全対象IDが 30日取得済み or unavailable なら回収完了。そうでなければ targetDays の次dueへ。
    const completed =
      draft.allTargetIds.length > 0 &&
      draft.allTargetIds.every((id) => map[id]?.checkpoints?.["30"] || map[id]?.unavailable_at);
    const next = completed ? null : nextDueAfter(draft.targetDays, draft.postedAt);

    await tx.query(
      `update drafts
          set tweet_metrics = $2::jsonb,
              next_metrics_at = $3::timestamptz,
              metrics_completed_at = case when $3::timestamptz is null then $4::timestamptz else metrics_completed_at end,
              updated_at = now()
        where id = $1 and metrics_completed_at is null`,
      [draft.draftId, JSON.stringify(map), next ? next.toISOString() : null, next ? null : collectedAt],
    );
  });
}
