import { CURRENT_AUTOMATION_CONSENT_VERSION } from "@/lib/legal";

import { PLANS } from "../plans";
import { notifyUsageThresholds } from "../usage/usage-threshold";
import type { ThreadItem } from "../ai/gen-output";
import { threadBlocksAutoPost } from "../post/generation-validation";
import {
  XApiError,
  type XCreatePostResult,
  type XDeletePostResult,
  type XRecentPost,
  type XUploadMediaResult,
} from "../x/client";
import { xUnitCost, type XCostConfig } from "../x/pricing";
import { recordedXCall } from "../x/usage";
import type { Queryable } from "../x/token-refresh";
import { heartbeat } from "./stale";

/**
 * post_publish ジョブの中核（要件04 §10, 要件06 §7, O-5/S-6, T-M3-18）。
 * lock（draft/未着手failed→posting）→検証（thread・X token・自動投稿阻害警告・日次上限）→
 * 画像があればmedia upload→1ポスト目投稿→以降は直前の自分のtweet_idへreply連投→各成功直後に
 * tweet_ids保存＋全プラン post_create consume event→status=posted・root_tweet_id・posted_at・
 * posted_mode・next_metrics_at 更新→posted通知 のハッピーパス。
 *
 * DB は pool（都度コミット）で駆動し、各ポスト成功直後の tweet_ids/consume を確定させる
 * （途中失敗の resume/ロールバックは T-M3-19）。X呼び出し・token取得・画像取得は注入する。
 * 原価台帳（external_api_usage_events）は recordedXCall が記録し、media uploadは台帳除外（要件04 §10）。
 * premium月次counter（usage_counters）加算とロールバック安全残量検証は M6。
 */

const URL_RE = /https?:\/\/\S+/;
function hasUrl(text: string): boolean {
  return URL_RE.test(text);
}

/**
 * premium投稿開始前に必要な通常/URL付き枠を算出する（要件03 §7.4・要件06 §7, T-M6-07）。最終payload列を
 * 通常/URL付きへ分類し、全件成功（各1消費）と、最終投稿失敗時のprefix（先頭〜末尾直前）ロールバック削除
 * （作成+削除=各2消費）の両方を賄える残量＝normal:max(R, 2×R_prefix)、url:max(U, 2×U_prefix) を返す。
 */
export function requiredPostSlots(finalTexts: string[]): { normal: number; url: number } {
  const isUrl = finalTexts.map(hasUrl);
  const total = (urls: boolean[], want: boolean) => urls.filter((u) => u === want).length;
  const prefix = isUrl.slice(0, -1); // 末尾直前まで（最終投稿失敗時に削除される範囲）
  return {
    normal: Math.max(total(isUrl, false), 2 * total(prefix, false)),
    url: Math.max(total(isUrl, true), 2 * total(prefix, true)),
  };
}

const POST_MONTH = `to_char((now() at time zone 'Asia/Tokyo'), 'YYYY-MM')`;

/**
 * 投稿枠を consume する（要件03 §7.1・要件04 §10 step7）。全プランで consume event を記帳し、premium かつ
 * live（dry_runは非加算）のときだけ月次counter（normal/url_posts_count）を **同一transaction** で +1 する。
 * event insert は idempotency_key で冪等（新規挿入時だけcounterを加算＝worker再実行で二重加算しない）。
 */
async function consumePostSlot(
  runInTx: <T>(fn: (tx: Queryable) => Promise<T>) => Promise<T>,
  params: {
    userId: string;
    xAccountId: string;
    jobId: string;
    draftId: string;
    tweetId: string;
    counterType: "post_normal" | "post_url";
    operation: "post_create" | "post_delete";
    idempotencyKey: string;
    premiumLive: boolean;
  },
): Promise<void> {
  await runInTx(async (tx) => {
    const ins = await tx.query(
      `insert into usage_events
         (user_id, x_account_id, job_id, draft_id, tweet_id, month, counter_type, operation, delta, reason, idempotency_key)
       values ($1, $2, $3, $4, $5, ${POST_MONTH}, $6, $7::usage_event_operation, 1, 'consume', $8)
       on conflict (idempotency_key) do nothing`,
      [
        params.userId,
        params.xAccountId,
        params.jobId,
        params.draftId,
        params.tweetId,
        params.counterType,
        params.operation,
        params.idempotencyKey,
      ],
    );
    if ((ins.rowCount ?? 0) !== 1) return; // 既存consume → 冪等no-op
    if (!params.premiumLive) return; // 全プランはevent記帳のみ。premium月次counterはliveのみ加算（§10）
    const col = params.counterType === "post_url" ? "url_posts_count" : "normal_posts_count";
    await tx.query(
      `insert into usage_counters (user_id, month) values ($1, ${POST_MONTH})
       on conflict (user_id, month) do nothing`,
      [params.userId],
    );
    const updated = await tx.query<{ n: number }>(
      `update usage_counters set ${col} = ${col} + 1, updated_at = now()
        where user_id = $1 and month = ${POST_MONTH}
        returning ${col} as n`,
      [params.userId],
    );
    // 80%/100% 到達通知（premium・枠/月/閾値ごとに1件・要件03 §8, T-M6-13）。
    await notifyUsageThresholds(tx, {
      userId: params.userId,
      key: params.counterType === "post_url" ? "url_posts" : "normal_posts",
      newCount: updated.rows[0]?.n ?? 0,
    });
  });
}

/** 照合で「直近」とみなす作成時刻の窓（要件04 §10: 本文・作成時刻・reply先で照合）。 */
const RECONCILE_WINDOW_MS = 15 * 60 * 1000;

/** 作成成否が不明（＝tweetが作られた可能性がある）エラーか。timeout/接続断/5xx のみ。 */
function isAmbiguousError(error: unknown): boolean {
  return error instanceof XApiError && (error.kind === "network" || error.kind === "server");
}

/** 投稿実行の終端エラー（本タスクは happy path。resume/ロールバックは T-M3-19）。 */
export class PostPublishError extends Error {
  readonly retryable: boolean;
  constructor(
    readonly code: string,
    message: string,
    retryable = false,
  ) {
    super(message);
    this.name = "PostPublishError";
    this.retryable = retryable;
  }
}

interface PublishJobRow {
  draft_id: string | null;
  input: { mode?: "manual" | "auto" } | null;
  trigger: string;
  x_account_id: string;
  x_user_id: string;
  user_id: string;
  plan: string;
}

interface PublishDraftRow {
  status: string;
  thread: ThreadItem[];
  images: { status?: string; storage_path?: string; mime_type?: string }[];
  tweet_ids: string[];
  quote_url: string | null;
}

export interface PostPublishDeps {
  db: Queryable;
  jobId: string;
  /** consume event＋premium counterを同一transactionで束ねる（server配線は withTransaction）。 */
  runInTx: <T>(fn: (tx: Queryable) => Promise<T>) => Promise<T>;
  /** x_account の有効 access token（server配線は getValidXAccessToken）。失効時は throw。 */
  getAccessToken: (xAccountId: string) => Promise<string>;
  /** X 投稿（dry_run は client 内で擬似結果）。 */
  createPost: (
    accessToken: string,
    input: { text: string; inReplyToTweetId?: string; mediaIds?: string[] },
  ) => Promise<XCreatePostResult>;
  /** X 投稿削除（ロールバック用。dry_run は client 内で擬似結果）。 */
  deletePost: (accessToken: string, tweetId: string) => Promise<XDeletePostResult>;
  /** X media upload（dry_run は client 内で擬似結果）。 */
  uploadMedia: (
    accessToken: string,
    input: { data: Buffer; mimeType: string },
  ) => Promise<XUploadMediaResult>;
  /** private Storage から画像bytesを取得（server配線は Supabase admin download）。 */
  downloadImage: (storagePath: string) => Promise<{ data: Buffer; mimeType: string }>;
  /** 結果不明時の照合用: 対象アカウントの直近投稿を取得（server配線は getRecentPosts）。 */
  getRecentPosts: (accessToken: string, xUserId: string) => Promise<XRecentPost[]>;
  /** 削除結果不明時の存在確認（true=存在, false=削除済み, null=判定不能。server配線は getTweetMetrics）。 */
  checkTweetExists: (accessToken: string, tweetId: string) => Promise<boolean | null>;
  costConfig: XCostConfig;
  /** 1 Xアカウントの JST 日次投稿上限（env X_DAILY_POST_LIMIT）。 */
  dailyLimit: number;
  /** X_POSTING_MODE=live か（dry_runはpremium月次counterを加算しない・要件04 §10）。 */
  postingLive: boolean;
  now?: () => number;
  recordStage?: (stage: string) => Promise<void>;
}

export interface PostPublishResult {
  status: "posted" | "already_done";
  draftId: string;
  tweetIds: string[];
}

async function loadJob(db: Queryable, jobId: string): Promise<PublishJobRow | null> {
  const { rows } = await db.query<PublishJobRow>(
    `select gj.draft_id, gj.input, gj.trigger, gj.x_account_id, xa.user_id, xa.x_user_id, p.plan
       from generation_jobs gj
       join x_accounts xa on xa.id = gj.x_account_id
       join profiles p on p.id = xa.user_id
      where gj.id = $1`,
    [jobId],
  );
  return rows[0] ?? null;
}

async function loadDraft(db: Queryable, draftId: string): Promise<PublishDraftRow | null> {
  const { rows } = await db.query<PublishDraftRow>(
    `select status, thread, images, tweet_ids, quote_url from drafts where id = $1`,
    [draftId],
  );
  return rows[0] ?? null;
}

/** 当日JST・同一Xアカウントの post_create consume 件数。 */
async function todaysPostCount(db: Queryable, xAccountId: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `select count(*)::int as n from usage_events
      where x_account_id = $1 and operation = 'post_create' and reason = 'consume'
        and (created_at at time zone 'Asia/Tokyo')::date = (now() at time zone 'Asia/Tokyo')::date`,
    [xAccountId],
  );
  return rows[0]?.n ?? 0;
}

async function setDraftFailed(
  db: Queryable,
  draftId: string,
  error: { code: string; message: string },
): Promise<void> {
  await db.query(
    `update drafts set status = 'failed', last_post_error = $2::jsonb, updated_at = now() where id = $1`,
    [draftId, JSON.stringify({ code: error.code, message: error.message })],
  );
}

async function createPostedNotification(
  db: Queryable,
  params: { userId: string; draftId: string },
): Promise<void> {
  await db.query(
    `insert into notifications
       (user_id, type, dedupe_key, title, body, link, payload,
        in_app_enabled, email_status, email_available_at)
     select $1, 'posted', $2, '投稿が完了しました',
            'スレッドをXへ投稿しました。実績は追って集計されます。',
            '/app/posts?tab=history&draftId=' || $3::text, jsonb_build_object('draft_id', $3::text),
            coalesce((p.notification_config->'posted'->>'in_app')::boolean, false),
            case when coalesce((p.notification_config->'posted'->>'email')::boolean, false)
                 then 'queued'::email_delivery_status else 'not_requested'::email_delivery_status end,
            case when coalesce((p.notification_config->'posted'->>'email')::boolean, false)
                 then now() else null end
       from profiles p
      where p.id = $1
        and (coalesce((p.notification_config->'posted'->>'in_app')::boolean, false)
             or coalesce((p.notification_config->'posted'->>'email')::boolean, false))
     on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing`,
    [params.userId, `draft:${params.draftId}:posted`, params.draftId],
  );
}

async function createPostErrorNotification(
  db: Queryable,
  params: { userId: string; draftId: string; title?: string; body?: string; dedupeSuffix?: string },
): Promise<void> {
  const title = params.title ?? "投稿に失敗しました";
  const body = params.body ?? "投稿の途中で失敗しました。下書きを確認して再度お試しください。";
  const dedupeKey = `draft:${params.draftId}:${params.dedupeSuffix ?? "post_error"}`;
  await db.query(
    `insert into notifications
       (user_id, type, dedupe_key, title, body, link, payload,
        in_app_enabled, email_status, email_available_at)
     select $1, 'error', $2, $4, $5,
            '/app/posts?tab=drafts&draftId=' || $3::text, jsonb_build_object('draft_id', $3::text),
            coalesce((p.notification_config->'error'->>'in_app')::boolean, false),
            case when coalesce((p.notification_config->'error'->>'email')::boolean, false)
                 then 'queued'::email_delivery_status else 'not_requested'::email_delivery_status end,
            case when coalesce((p.notification_config->'error'->>'email')::boolean, false)
                 then now() else null end
       from profiles p
      where p.id = $1
        and (coalesce((p.notification_config->'error'->>'in_app')::boolean, false)
             or coalesce((p.notification_config->'error'->>'email')::boolean, false))
     on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing`,
    [params.userId, dedupeKey, params.draftId, title, body],
  );
}

/**
 * resume再失敗時の逆順ロールバック（要件04 §11）。成功済み tweet_ids を末尾から削除し、
 * 削除成功ごとに全プラン post_delete consume event（元post_createと同じcounter_type）を作る。
 * 削除失敗分は remaining へ残す（追加消費なし）。draft を failed にし last_post_error へ
 * deleted/remaining を保存、残存IDがあれば next_metrics_at を設定して error 通知を作る。
 */
async function rollbackThread(
  deps: PostPublishDeps,
  params: {
    accessToken: string;
    usageCtx: { userId: string; xAccountId: string; jobId: string };
    draftId: string;
    tweetIds: string[];
    finalTextAt: (i: number) => string;
    failedIndex: number;
    plan: string;
  },
): Promise<void> {
  const { db } = deps;
  const { usageCtx, draftId, tweetIds } = params;
  const premiumLive = params.plan === "premium" && deps.postingLive;
  const deleted: string[] = [];
  const remaining: string[] = [];
  const ambiguousDelete: string[] = [];

  // rollback削除成功は元post_createと同じcounter_typeで同枠を追加消費（作成+削除=同枠2消費・要件03 §7.1）。
  const recordDeleteConsume = (tweetId: string, withUrl: boolean): Promise<void> =>
    consumePostSlot(deps.runInTx, {
      userId: usageCtx.userId,
      xAccountId: usageCtx.xAccountId,
      jobId: usageCtx.jobId,
      draftId,
      tweetId,
      counterType: withUrl ? "post_url" : "post_normal",
      operation: "post_delete",
      idempotencyKey: `draft:${draftId}:tweet:${tweetId}:post:delete`,
      premiumLive,
    });

  for (let i = tweetIds.length - 1; i >= 0; i--) {
    const tweetId = tweetIds[i];
    const withUrl = hasUrl(params.finalTextAt(i));
    try {
      await recordedXCall(
        db,
        {
          ctx: usageCtx,
          operation: "x_post_delete",
          unitCostUsd: xUnitCost("x_post_delete", deps.costConfig),
          idempotencyKey: `draft:${draftId}:x_post_delete:${i}`,
        },
        () => deps.deletePost(params.accessToken, tweetId),
      );
      deleted.push(tweetId);
      await recordDeleteConsume(tweetId, withUrl);
    } catch {
      // 削除結果不明 → 存在確認（要件04 §11）。削除済みなら成功扱い、判定不能は ambiguous。
      const exists = await deps.checkTweetExists(params.accessToken, tweetId);
      if (exists === false) {
        deleted.push(tweetId);
        await recordDeleteConsume(tweetId, withUrl);
      } else if (exists === true) {
        remaining.push(tweetId); // まだX上に残る（追加消費なし）
      } else {
        ambiguousDelete.push(tweetId); // 判定不能
      }
    }
  }

  const errorObj = {
    code: "post_create_failed",
    message:
      remaining.length || ambiguousDelete.length
        ? "投稿の途中で失敗し、一部がXに残っている可能性があります。内容をご確認ください。"
        : "投稿の途中で失敗したため、投稿済みポストを取り消しました。",
    retryable: false,
    stage: "posting",
    failed_post_index: params.failedIndex,
    remaining_tweet_ids: remaining,
    deleted_tweet_ids: deleted,
    ambiguous_create_indices: [],
    ambiguous_delete_tweet_ids: ambiguousDelete,
    provider_request_id: null,
  };
  // tweet_ids は監査用に保持（消さない）。残存/不明IDがあれば next_metrics_at を設定（要件04 §13）。
  // 部分失敗でも生き残ったポストの実績を回収するため posted_at をメトリクスのアンカーとして設定する
  // （成功時=投稿時刻／部分失敗時=残存確定時刻。metrics_collector は posted_at 基準で checkpoint を刻む）。
  const hasLive = remaining.length > 0 || ambiguousDelete.length > 0;
  await db.query(
    `update drafts
        set status = 'failed', last_post_error = $2::jsonb,
            posted_at = case when $3 then coalesce(posted_at, now()) else posted_at end,
            next_metrics_at = case when $3 then now() + interval '1 day' else next_metrics_at end,
            updated_at = now()
      where id = $1`,
    [draftId, JSON.stringify(errorObj), hasLive],
  );
  await createPostErrorNotification(db, { userId: usageCtx.userId, draftId });
}

/** 作成成否が一意に確定できない post_state_unknown（要件04 §10）。再送・rollbackせず記録し確認を促す。 */
async function failAmbiguousCreate(
  db: Queryable,
  params: { userId: string; draftId: string; failedIndex: number; liveTweetIds: string[] },
): Promise<void> {
  const errorObj = {
    code: "post_state_unknown",
    message: "投稿の作成結果を確認できませんでした。X上で重複がないかご確認ください。",
    retryable: false,
    stage: "posting",
    failed_post_index: params.failedIndex,
    remaining_tweet_ids: params.liveTweetIds,
    deleted_tweet_ids: [],
    ambiguous_create_indices: [params.failedIndex],
    ambiguous_delete_tweet_ids: [],
    provider_request_id: null,
  };
  await db.query(
    `update drafts
        set status = 'failed', last_post_error = $2::jsonb,
            posted_at = case when $3 then coalesce(posted_at, now()) else posted_at end,
            next_metrics_at = case when $3 then now() + interval '1 day' else next_metrics_at end,
            updated_at = now()
      where id = $1`,
    [params.draftId, JSON.stringify(errorObj), params.liveTweetIds.length > 0],
  );
  await createPostErrorNotification(db, { userId: params.userId, draftId: params.draftId });
}

export async function executePostPublish(
  deps: PostPublishDeps,
): Promise<PostPublishResult> {
  const { db, jobId } = deps;
  const recordStage = deps.recordStage ?? (async (s: string) => void (await heartbeat(jobId, s)));

  const job = await loadJob(db, jobId);
  if (!job) throw new PostPublishError("not_found", "job not found");
  if (!job.draft_id) throw new PostPublishError("not_found", "job has no draft");
  const draftId = job.draft_id;
  const { x_account_id: xAccountId, user_id: userId } = job;
  const mode: "manual" | "auto" =
    job.input?.mode ?? (job.trigger === "schedule" ? "auto" : "manual");

  const draft = await loadDraft(db, draftId);
  if (!draft) throw new PostPublishError("not_found", "draft not found");
  // 冪等: 既に投稿済みなら再実行しない（worker再実行安全）。
  if (draft.status === "posted") {
    return { status: "already_done", draftId, tweetIds: draft.tweet_ids ?? [] };
  }

  await recordStage("posting");

  // --- lock: draft または未着手(tweet_ids空)の failed のみ posting へ ---
  const locked = await db.query<{ id: string }>(
    `update drafts set status = 'posting', updated_at = now()
      where id = $1 and status in ('draft', 'failed')
        and jsonb_array_length(coalesce(tweet_ids, '[]'::jsonb)) = 0
      returning id`,
    [draftId],
  );
  if (locked.rowCount === 0) {
    throw new PostPublishError("job_conflict", "draft is not lockable for posting");
  }

  const thread = Array.isArray(draft.thread) ? draft.thread : [];
  if (thread.length === 0) {
    await setDraftFailed(db, draftId, { code: "empty_thread", message: "本文が空です。" });
    throw new PostPublishError("empty_thread", "draft has no posts");
  }

  // P-5等: 1ポスト目に quote_url を末尾合成（要件04 §10 step5）。counter_type/URL判定に使う最終text。
  const finalTextAt = (i: number): string =>
    i === 0 && draft.quote_url ? `${thread[i].text}\n${draft.quote_url}` : thread[i].text;

  // --- 検証: 自動投稿を阻害する警告（auto時のみ）---
  if (mode === "auto" && threadBlocksAutoPost(thread)) {
    await setDraftFailed(db, draftId, {
      code: "auto_post_blocked",
      message: "警告があるため自動投稿を停止しました。内容を確認してください。",
    });
    throw new PostPublishError("auto_post_blocked", "warnings block auto posting");
  }

  // --- 検証: auto起点はX呼び出し直前に自動投稿同意を再確認（要件04 §10 step2・要件05 §7, T-M4-03）---
  // 撤回済み（automation_disabled_at）や旧versionなら、X APIを一切呼ばずdraftを未投稿(draft)へ戻す。
  if (mode === "auto") {
    const consent = await db.query<{ ok: boolean }>(
      `select (automation_consent_version = $2
               and automation_consented_at is not null
               and automation_disabled_at is null) as ok
         from x_accounts where id = $1`,
      [xAccountId, CURRENT_AUTOMATION_CONSENT_VERSION],
    );
    if (consent.rows[0]?.ok !== true) {
      await db.query(`update drafts set status = 'draft', updated_at = now() where id = $1`, [draftId]);
      await db.query(
        `update generation_jobs set status = 'canceled', finished_at = now() where id = $1 and status = 'running'`,
        [jobId],
      );
      throw new PostPublishError("automation_consent_revoked", "auto posting consent revoked or stale");
    }
  }

  // --- 検証: 日次上限（当日JST post_create + 予定ポスト数）---
  const todays = await todaysPostCount(db, xAccountId);
  if (todays + thread.length > deps.dailyLimit) {
    // 実行せず draft へ戻す（明日以降に再試行できる）。
    await db.query(
      `update drafts set status = 'draft', updated_at = now() where id = $1`,
      [draftId],
    );
    throw new PostPublishError(
      "daily_limit_reached",
      `本日の投稿上限（${deps.dailyLimit}件）に達しました。翌日以降に再度お試しください。`,
    );
  }

  // --- 検証: premium月次投稿枠のロールバック安全残量（要件03 §7.4・要件06 §7, T-M6-07）---
  // ロールバック（最終投稿失敗→prefixを作成+削除で各2消費）まで賄える残量を投稿前に確認する。
  // 不足時は X API を一切呼ばず・枠を消費せず失敗させ、通知する（premium かつ live のみ・§10）。
  if (job.plan === "premium" && deps.postingLive) {
    const limits = PLANS.premium.usageLimits;
    if (limits) {
      const required = requiredPostSlots(thread.map((_, i) => finalTextAt(i)));
      const used = await db.query<{ normal_posts_count: number; url_posts_count: number }>(
        `select coalesce(normal_posts_count, 0) as normal_posts_count,
                coalesce(url_posts_count, 0) as url_posts_count
           from usage_counters where user_id = $1 and month = ${POST_MONTH}`,
        [userId],
      );
      const usedNormal = used.rows[0]?.normal_posts_count ?? 0;
      const usedUrl = used.rows[0]?.url_posts_count ?? 0;
      if (
        usedNormal + required.normal > limits.normalPosts ||
        usedUrl + required.url > limits.urlPosts
      ) {
        // X API を呼ぶ前に draft を未投稿へ戻し、枠を消費せず失敗させる。
        await db.query(`update drafts set status = 'draft', updated_at = now() where id = $1`, [
          draftId,
        ]);
        await createPostErrorNotification(db, {
          userId,
          draftId,
          title: "今月の投稿枠が不足しています",
          body: "今月のプレミアム投稿枠が不足しているため投稿できませんでした。翌月まで待つか、内容を調整してください。",
          dedupeSuffix: "usage_limit",
        });
        throw new PostPublishError(
          "usage_limit_exceeded",
          "monthly post quota insufficient for safe posting",
        );
      }
    }
  }

  // --- 検証: X token（失効は再連携が必要）---
  let accessToken: string;
  try {
    accessToken = await deps.getAccessToken(xAccountId);
  } catch {
    await setDraftFailed(db, draftId, {
      code: "x_token_invalid",
      message: "Xの連携が切れています。設定から再連携してください。",
    });
    throw new PostPublishError("x_token_invalid", "x token unavailable");
  }

  const usageCtx = { userId, xAccountId, jobId };

  // --- 画像があれば media upload（失敗時は本文を投稿せず failed・要件06 §6）---
  let mediaIds: string[] | undefined;
  const readyImage = draft.images?.find((img) => img.status === "ready" && img.storage_path);
  if (readyImage?.storage_path) {
    try {
      const file = await deps.downloadImage(readyImage.storage_path);
      const up = await deps.uploadMedia(accessToken, {
        data: file.data,
        mimeType: readyImage.mime_type ?? file.mimeType,
      });
      mediaIds = [up.mediaId];
    } catch {
      await setDraftFailed(db, draftId, {
        code: "media_upload_failed",
        message: "画像のアップロードに失敗しました。時間をおいて再度お試しください。",
      });
      throw new PostPublishError("media_upload_failed", "media upload failed", true);
    }
  }

  const tweetIds: string[] = Array.isArray(draft.tweet_ids) ? [...draft.tweet_ids] : [];

  const now = deps.now ?? Date.now;

  const saveCreatedTweet = async (i: number, tweetId: string): Promise<void> => {
    tweetIds.push(tweetId);
    await db.query(
      `update drafts set tweet_ids = coalesce(tweet_ids, '[]'::jsonb) || to_jsonb($2::text), updated_at = now()
        where id = $1`,
      [draftId, tweetId],
    );
    await consumePostSlot(deps.runInTx, {
      userId,
      xAccountId,
      jobId,
      draftId,
      tweetId,
      counterType: hasUrl(finalTextAt(i)) ? "post_url" : "post_normal",
      operation: "post_create",
      idempotencyKey: `draft:${draftId}:tweet:${tweetId}:post:create`,
      premiumLive: job.plan === "premium" && deps.postingLive,
    });
  };

  // 結果不明時: 同一本文を再送せず、直近投稿から本文/作成時刻/reply先が一致する候補を探す（要件04 §10）。
  const reconcileCreate = async (i: number): Promise<string[]> => {
    const expectedReply = i > 0 ? tweetIds[i - 1] : null;
    const text = finalTextAt(i);
    let posts: XRecentPost[];
    try {
      posts = await deps.getRecentPosts(accessToken, job.x_user_id);
    } catch {
      return []; // 取得不能 → 一意に確定できず
    }
    const cutoff = now() - RECONCILE_WINDOW_MS;
    return posts
      .filter(
        (p) =>
          p.text === text &&
          p.inReplyToId === expectedReply &&
          (p.createdAt == null || Date.parse(p.createdAt) >= cutoff),
      )
      .map((p) => p.id);
  };

  /** index i を投稿。成功/照合確定は tweet_ids 保存＋consume。失敗は "definite" / "ambiguous"。 */
  const postOne = async (
    i: number,
  ): Promise<{ kind: "ok" } | { kind: "definite" } | { kind: "ambiguous" }> => {
    const text = finalTextAt(i);
    const withUrl = hasUrl(text);
    try {
      const result = await recordedXCall(
        db,
        {
          ctx: usageCtx,
          operation: "x_post_create",
          unitCostUsd: xUnitCost("x_post_create", deps.costConfig, { hasUrl: withUrl }),
          idempotencyKey: `draft:${draftId}:x_post_create:${i}`,
        },
        () =>
          deps.createPost(accessToken, {
            text,
            inReplyToTweetId: i === 0 ? undefined : tweetIds[i - 1],
            mediaIds: i === 0 ? mediaIds : undefined,
          }),
      );
      await saveCreatedTweet(i, result.tweetId);
      return { kind: "ok" };
    } catch (error) {
      if (!isAmbiguousError(error)) return { kind: "definite" };
      // 作成成否不明 → 再送せず照合。一意に確定できたら継続、そうでなければ ambiguous。
      const matched = await reconcileCreate(i);
      if (matched.length === 1) {
        await saveCreatedTweet(i, matched[0]);
        return { kind: "ok" };
      }
      return { kind: "ambiguous" };
    }
  };

  // --- スレッド投稿: tweet_ids.length を再開位置に、definite失敗は1回resume、ambiguousは照合（要件04 §10/§11）---
  let resumed = false;
  for (;;) {
    let failure: { index: number; kind: "definite" | "ambiguous" } | null = null;
    for (let i = tweetIds.length; i < thread.length; i++) {
      const outcome = await postOne(i);
      if (outcome.kind !== "ok") {
        failure = { index: i, kind: outcome.kind };
        break;
      }
    }
    if (!failure) break; // 全ポスト成功

    if (failure.kind === "ambiguous") {
      // 一意に確定できない → post_state_unknown。再送・rollbackせず記録して手動確認を促す。
      await failAmbiguousCreate(db, {
        userId,
        draftId,
        failedIndex: failure.index,
        liveTweetIds: [...tweetIds],
      });
      throw new PostPublishError("post_state_unknown", "post create result is ambiguous");
    }
    if (!resumed) {
      resumed = true; // definite失敗は失敗位置から1回だけresume
      continue;
    }
    // resume再失敗 → 逆順ロールバック（削除・post_delete consume・残存ID保存・通知）
    await rollbackThread(deps, {
      accessToken,
      usageCtx,
      draftId,
      tweetIds,
      finalTextAt,
      failedIndex: failure.index,
      plan: job.plan,
    });
    throw new PostPublishError("post_create_failed", "posting failed after resume");
  }

  // --- 完了: posted 確定・root_tweet_id・posted_at・posted_mode・next_metrics_at（1日checkpoint）---
  await db.query(
    `update drafts
        set status = 'posted', root_tweet_id = $2, posted_at = now(), posted_mode = $3,
            next_metrics_at = now() + interval '1 day', last_post_error = null, updated_at = now()
      where id = $1`,
    [draftId, tweetIds[0], mode],
  );
  await createPostedNotification(db, { userId, draftId });

  return { status: "posted", draftId, tweetIds };
}
