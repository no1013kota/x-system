import type { ThreadItem } from "../ai/gen-output";
import { threadBlocksAutoPost } from "../post/generation-validation";
import type {
  XCreatePostResult,
  XDeletePostResult,
  XUploadMediaResult,
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
  costConfig: XCostConfig;
  /** 1 Xアカウントの JST 日次投稿上限（env X_DAILY_POST_LIMIT）。 */
  dailyLimit: number;
  recordStage?: (stage: string) => Promise<void>;
}

export interface PostPublishResult {
  status: "posted" | "already_done";
  draftId: string;
  tweetIds: string[];
}

async function loadJob(db: Queryable, jobId: string): Promise<PublishJobRow | null> {
  const { rows } = await db.query<PublishJobRow>(
    `select gj.draft_id, gj.input, gj.trigger, gj.x_account_id, xa.user_id, p.plan
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
  params: { userId: string; draftId: string },
): Promise<void> {
  await db.query(
    `insert into notifications
       (user_id, type, dedupe_key, title, body, link, payload,
        in_app_enabled, email_status, email_available_at)
     select $1, 'error', $2, '投稿に失敗しました',
            '投稿の途中で失敗しました。下書きを確認して再度お試しください。',
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
    [params.userId, `draft:${params.draftId}:post_error`, params.draftId],
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
  },
): Promise<void> {
  const { db } = deps;
  const { usageCtx, draftId, tweetIds } = params;
  const deleted: string[] = [];
  const remaining: string[] = [];

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
      await db.query(
        `insert into usage_events
           (user_id, x_account_id, job_id, draft_id, tweet_id, month, counter_type, operation, delta, reason, idempotency_key)
         values ($1, $2, $3, $4, $5, to_char((now() at time zone 'Asia/Tokyo'), 'YYYY-MM'),
                 $6, 'post_delete', 1, 'consume', $7)
         on conflict (idempotency_key) do nothing`,
        [
          usageCtx.userId,
          usageCtx.xAccountId,
          usageCtx.jobId,
          draftId,
          tweetId,
          withUrl ? "post_url" : "post_normal",
          `draft:${draftId}:tweet:${tweetId}:post:delete`,
        ],
      );
    } catch {
      // 削除失敗はX上に残る（追加消費なし）。
      remaining.push(tweetId);
    }
  }

  const errorObj = {
    code: "post_create_failed",
    message: remaining.length
      ? "投稿の途中で失敗し、一部はXに残っています。内容をご確認ください。"
      : "投稿の途中で失敗したため、投稿済みポストを取り消しました。",
    retryable: false,
    stage: "posting",
    failed_post_index: params.failedIndex,
    remaining_tweet_ids: remaining,
    deleted_tweet_ids: deleted,
    ambiguous_create_indices: [],
    ambiguous_delete_tweet_ids: [],
    provider_request_id: null,
  };
  // tweet_ids は監査用に保持（消さない）。残存IDが確定したら next_metrics_at を設定（要件04 §13）。
  await db.query(
    `update drafts
        set status = 'failed', last_post_error = $2::jsonb,
            next_metrics_at = case when $3 then now() + interval '1 day' else next_metrics_at end,
            updated_at = now()
      where id = $1`,
    [draftId, JSON.stringify(errorObj), remaining.length > 0],
  );
  await createPostErrorNotification(db, { userId: usageCtx.userId, draftId });
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

  // --- 検証: 自動投稿を阻害する警告（auto時のみ）---
  if (mode === "auto" && threadBlocksAutoPost(thread)) {
    await setDraftFailed(db, draftId, {
      code: "auto_post_blocked",
      message: "警告があるため自動投稿を停止しました。内容を確認してください。",
    });
    throw new PostPublishError("auto_post_blocked", "warnings block auto posting");
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

  // P-5等: 1ポスト目に quote_url を末尾合成（要件04 §10 step5）。counter_type/URL判定に使う最終text。
  const finalTextAt = (i: number): string =>
    i === 0 && draft.quote_url ? `${thread[i].text}\n${draft.quote_url}` : thread[i].text;

  const tweetIds: string[] = Array.isArray(draft.tweet_ids) ? [...draft.tweet_ids] : [];

  /** index i を投稿し、成功直後に tweet_ids 保存＋post_create consume を確定する。 */
  const postOne = async (i: number): Promise<void> => {
    const text = finalTextAt(i);
    const withUrl = hasUrl(text);
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
    tweetIds.push(result.tweetId);
    await db.query(
      `update drafts set tweet_ids = coalesce(tweet_ids, '[]'::jsonb) || to_jsonb($2::text), updated_at = now()
        where id = $1`,
      [draftId, result.tweetId],
    );
    await db.query(
      `insert into usage_events
         (user_id, x_account_id, job_id, draft_id, tweet_id, month, counter_type, operation, delta, reason, idempotency_key)
       values ($1, $2, $3, $4, $5, to_char((now() at time zone 'Asia/Tokyo'), 'YYYY-MM'),
               $6, 'post_create', 1, 'consume', $7)
       on conflict (idempotency_key) do nothing`,
      [
        userId,
        xAccountId,
        jobId,
        draftId,
        result.tweetId,
        withUrl ? "post_url" : "post_normal",
        `draft:${draftId}:tweet:${result.tweetId}:post:create`,
      ],
    );
  };

  // --- スレッド投稿: tweet_ids.length を再開位置に、途中失敗時は同一job内で1回だけresume（要件04 §11）---
  let resumed = false;
  let failedIndex = -1;
  for (;;) {
    let ok = true;
    for (let i = tweetIds.length; i < thread.length; i++) {
      try {
        await postOne(i);
      } catch {
        ok = false;
        failedIndex = i;
        break;
      }
    }
    if (ok) break; // 全ポスト成功
    if (!resumed) {
      resumed = true; // 失敗位置から1回だけresume
      continue;
    }
    // resume再失敗 → 逆順ロールバック（削除・post_delete consume・残存ID保存・通知）
    await rollbackThread(deps, {
      accessToken,
      usageCtx,
      draftId,
      tweetIds,
      finalTextAt,
      failedIndex,
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
