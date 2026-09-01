"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { type BaseResult, errorResult, requireUserId, validationErrorResult } from "./_helpers";
import { parseUserInput } from "@/lib/validation/user-input";
import { pooledQueryable } from "@/lib/db/pool";
import { cloneFailedDraftForRetry } from "@/lib/drafts-clone";
import { env } from "@/lib/env";
import {
  cancelDraftSchedule,
  discardDraft,
  listDraftsForAccount,
  scheduleDraft,
  updateDraft,
  type DraftView,
} from "@/lib/drafts";
import { assertDraftSchedulable } from "@/lib/draft-schedule";
import { reconcileDraftPosting } from "@/lib/reconcile-posting";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveActiveXAccountForUser } from "@/lib/x/account-actions-server";
import { getRecentPosts, getTweetMetrics } from "@/lib/x/client";
import { xClientDeps } from "@/lib/x/client-server";
import { getValidXAccessToken } from "@/lib/x/token-refresh-server";
import { randomUUID } from "node:crypto";

import { EXT_BY_FORMAT, normalizeForX } from "@/lib/ai/image-normalize";
import { effectiveImagePost, imagePathsForPost, imagesReplacingPost } from "@/lib/post/draft-images";
import {
  assertUploadableImage,
  draftImagePath,
  replacedImagePaths,
} from "@/lib/post/draft-image-upload";
import type { DraftImage } from "@/lib/drafts";
import { AppError } from "@/lib/observability/errors";
import { recordUnexpectedError } from "@/lib/observability/sentry";

/**
 * 下書きの Server Actions（要件05 §5, T-M3-10）。本人のみ。一覧は active_x_account スコープ、
 * 編集は status=draft・楽観lock・pattern別最大数、破棄は draft/failed のみ（未解決failedは拒否）。
 */

// バケット名は env が正本（他5箇所は既に env 経由）。ここだけ直書きだったため、
// バケットを変えても削除だけ旧バケットを掃除し続ける状態になっていた（R26）。
const IMAGE_BUCKET = env.SUPABASE_STORAGE_BUCKET_IMAGES;

const pooledDb = pooledQueryable();

/** 画像アップロードは FormData 経由なので zod を通す前に形を見る（T-M8-353）。 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const listSchema = z.object({ tab: z.enum(["drafts", "history"]).default("drafts") });
const updateSchema = z.object({
  draft_id: z.string().uuid(),
  expected_updated_at: z.string().min(1),
  posts: z
    .array(z.object({ local_id: z.string().optional(), text: z.string().max(10000) }))
    .min(1),
  image_local_ids: z.array(z.string()).optional(),
});
const scheduleSchema = z.object({
  draft_id: z.string().uuid(),
  expected_updated_at: z.string().min(1),
  /** `datetime-local` 由来のJST文字列も ISO も受ける。判定は純粋層が行う。 */
  scheduled_at: z.string().min(1),
});
const cancelScheduleSchema = z.object({
  draft_id: z.string().uuid(),
  expected_updated_at: z.string().min(1),
});
const discardSchema = z.object({
  draft_id: z.string().uuid(),
  expected_updated_at: z.string().min(1),
});
const reconcileSchema = z.object({ draft_id: z.string().uuid() });
const cloneSchema = z.object({
  request_key: z.string().min(1).max(200),
  draft_id: z.string().uuid(),
});

export async function listDraftsAction(
  input: unknown = {},
): Promise<BaseResult & { drafts?: DraftView[] }> {
  const parsed = parseUserInput(listSchema, input ?? {});
  if (!parsed.success) {
    return validationErrorResult(parsed.error);
  }
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const activeId = await resolveActiveXAccountForUser(auth.userId);
    const drafts = activeId
      ? await listDraftsForAccount(pooledDb, activeId, parsed.data.tab)
      : [];
    return { drafts, message: "", status: "success" };
  } catch (error) {
    return errorResult(error);
  }
}

export async function updateDraftAction(
  input: unknown,
): Promise<BaseResult & { updatedAt?: string }> {
  const parsed = parseUserInput(updateSchema, input);
  if (!parsed.success) {
    return validationErrorResult(parsed.error);
  }
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const res = await updateDraft(pooledDb, {
      userId: auth.userId,
      draftId: parsed.data.draft_id,
      expectedUpdatedAt: parsed.data.expected_updated_at,
      posts: parsed.data.posts,
      imageLocalIds: parsed.data.image_local_ids,
    });
    revalidatePath("/app/posts");
    return { message: "下書きを保存しました。", status: "success", updatedAt: res.updatedAt };
  } catch (error) {
    return errorResult(error);
  }
}

export async function reconcileDraftPostingAction(
  input: unknown,
): Promise<BaseResult & { reconcileStatus?: string }> {
  const parsed = parseUserInput(reconcileSchema, input);
  if (!parsed.success) {
    return validationErrorResult(parsed.error);
  }
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const clientDeps = xClientDeps();
    const res = await reconcileDraftPosting(
      {
        db: pooledDb,
        getAccessToken: (xAccountId) => getValidXAccessToken(xAccountId),
        getRecentPosts: async (accessToken, xUserId) => {
          const r = await getRecentPosts(accessToken, { userId: xUserId }, clientDeps);
          return r.posts;
        },
        checkTweetExists: async (accessToken, tweetId) => {
          try {
            const r = await getTweetMetrics(accessToken, [tweetId], clientDeps);
            return r.tweets.length > 0;
          } catch (error) {
            // null は「存在を判定できなかった」を表す戻り値で、reconcile 側が曖昧として扱う。
            // 判定不能が続く原因（権限・token・X側障害）を追えるように記録する。
            recordUnexpectedError(error, { at: "drafts:check-tweet-exists", tweetId });
            return null;
          }
        },
      },
      { userId: auth.userId, draftId: parsed.data.draft_id },
    );
    revalidatePath("/app/posts");
    const message =
      res.status === "posted"
        ? "Xと再照合し、投稿済みとして確定しました。"
        : res.status === "deletes_reconciled"
          ? "削除状況を再照合しました。"
          : "一意に確定できませんでした。X上の状態をご確認ください。";
    return { message, reconcileStatus: res.status, status: "success" };
  } catch (error) {
    return errorResult(error);
  }
}

export async function cloneFailedDraftForRetryAction(
  input: unknown,
): Promise<BaseResult & { draftId?: string }> {
  const parsed = parseUserInput(cloneSchema, input);
  if (!parsed.success) {
    return validationErrorResult(parsed.error);
  }
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const { draftId } = await cloneFailedDraftForRetry(auth.userId, parsed.data, {
      db: pooledDb,
      copyImage: async (from, to) => {
        const { error } = await createSupabaseAdminClient().storage
          .from(IMAGE_BUCKET)
          .copy(from, to);
        if (error) throw new Error(`storage copy failed: ${error.message}`);
      },
      deleteImages: async (paths) => {
        if (paths.length > 0) await createSupabaseAdminClient().storage.from(IMAGE_BUCKET).remove(paths);
      },
    });
    revalidatePath("/app/posts");
    return { draftId, message: "本文と画像を複製した新しい下書きを作成しました。", status: "success" };
  } catch (error) {
    return errorResult(error);
  }
}

export async function discardDraftAction(input: unknown): Promise<BaseResult> {
  const parsed = parseUserInput(discardSchema, input);
  if (!parsed.success) {
    return validationErrorResult(parsed.error);
  }
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    await discardDraft(
      pooledDb,
      {
        userId: auth.userId,
        draftId: parsed.data.draft_id,
        expectedUpdatedAt: parsed.data.expected_updated_at,
      },
      {
        deleteImages: async (paths) => {
          await createSupabaseAdminClient().storage.from(IMAGE_BUCKET).remove(paths);
        },
      },
    );
    revalidatePath("/app/posts");
    return { message: "下書きを破棄しました。", status: "success" };
  } catch (error) {
    return errorResult(error);
  }
}


/**
 * 下書きに投稿予約日時を設定する（要件05 §5・T-M8-157）。
 *
 * **押す前に理由が分かるように**、判定は画面と同じ `checkDraftSchedule` を通す
 * （`assertDraftSchedulable` が日本語の理由付きで止める）。対象アカウントの有効性は
 * 下書きの所有チェックと同じクエリで読む。
 */
export async function scheduleDraftAction(input: unknown): Promise<BaseResult> {
  const parsed = parseUserInput(scheduleSchema, input);
  if (!parsed.success) {
    return validationErrorResult(parsed.error);
  }
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const target = await loadDraftScheduleTarget(auth.userId, parsed.data.draft_id);
    const scheduledAt = assertDraftSchedulable(
      target,
      parsed.data.scheduled_at,
      Date.now(),
    );
    await scheduleDraft(pooledDb, {
      draftId: parsed.data.draft_id,
      expectedUpdatedAt: parsed.data.expected_updated_at,
      scheduledAt,
      userId: auth.userId,
    });
    revalidatePath("/app/posts");
    revalidatePath("/app");
    return { message: "投稿を予約しました。", status: "success" };
  } catch (error) {
    return errorResult(error);
  }
}

/** 予約を解除する（要件05 §5・T-M8-157）。 */
export async function cancelDraftScheduleAction(
  input: unknown,
): Promise<BaseResult> {
  const parsed = parseUserInput(cancelScheduleSchema, input);
  if (!parsed.success) {
    return validationErrorResult(parsed.error);
  }
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    await cancelDraftSchedule(pooledDb, {
      draftId: parsed.data.draft_id,
      expectedUpdatedAt: parsed.data.expected_updated_at,
      userId: auth.userId,
    });
    revalidatePath("/app/posts");
    revalidatePath("/app");
    return { message: "予約を解除しました。", status: "success" };
  } catch (error) {
    return errorResult(error);
  }
}

/** 予約の判定に必要な最小の情報（下書きの状態と対象アカウントの有効性）。 */
async function loadDraftScheduleTarget(
  userId: string,
  draftId: string,
): Promise<{ status: string; xAccountActive: boolean }> {
  const { rows } = await pooledDb.query<{ status: string; x_status: string }>(
    `select d.status, xa.status as x_status
       from drafts d join x_accounts xa on xa.id = d.x_account_id
      where d.id = $1 and xa.user_id = $2`,
    [draftId, userId],
  );
  const row = rows[0];
  if (!row) throw new AppError("not_found");
  return { status: row.status, xAccountActive: row.x_status === "active" };
}

/**
 * 下書きに自分の画像を添える（T-M8-353・運営者の指示 2026-08-28）。
 *
 * **投稿に使われる画像は1枚**（`post-publish` は最初の `ready` 画像を使う）ので、
 * アップロードは**置き換え**にする。2枚目を足せる形にすると、画面には2枚出ているのに
 * 投稿されるのは片方、という説明できない状態になる（原則1）。
 *
 * 中身は `normalizeForX` に通す——申告されたMIMEは信用できず、Xの5MB上限も
 * ここで守らないと**投稿の瞬間に初めて失敗する**（そのときには本文だけがXに残り得る）。
 */
export async function uploadDraftImageAction(formData: FormData): Promise<BaseResult> {
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  const draftId = formData.get("draft_id");
  const file = formData.get("file");
  // 対象ポスト（T-M8-398）。未指定は1ポスト目（従来互換）。
  const requestedPost = formData.get("post_local_id");
  if (typeof draftId !== "string" || !UUID_RE.test(draftId)) {
    return { message: "下書きが見つかりません。", status: "error" };
  }
  if (!(file instanceof File)) {
    return { message: "画像ファイルを選んでください。", status: "error" };
  }
  try {
    assertUploadableImage({ name: file.name, size: file.size, type: file.type });
    const target = await loadDraftImageTarget(auth.userId, draftId);
    if (target.status !== "draft") {
      throw new AppError("job_conflict", {
        message: "この下書きはもう編集できません（投稿済み・処理中）。",
        details: { reason: `not_editable:${target.status}` },
      });
    }
    const postLocalId =
      typeof requestedPost === "string" && requestedPost !== ""
        ? requestedPost
        : (target.firstPostLocalId ?? undefined);
    // 実在しないポストへは付けない（編集でポストが消えた等。黙って1ポスト目に付け替えない）。
    if (postLocalId && !target.postLocalIds.includes(postLocalId)) {
      throw new AppError("not_found", { details: { reason: "post_not_found" } });
    }

    const normalized = await normalizeForX(Buffer.from(await file.arrayBuffer()));
    const localId = randomUUID();
    const path = draftImagePath({
      userId: auth.userId,
      xAccountId: target.xAccountId,
      draftId,
      localId,
      ext: EXT_BY_FORMAT[normalized.format] ?? "bin",
    });
    const admin = createSupabaseAdminClient();
    const uploaded = await admin.storage
      .from(IMAGE_BUCKET)
      .upload(path, normalized.bytes, { contentType: normalized.mime, upsert: true });
    if (uploaded.error) throw new Error(`storage upload failed: ${uploaded.error.message}`);

    const image = {
      local_id: localId,
      post_local_id: postLocalId,
      storage_path: path,
      provider: "upload",
      mime_type: normalized.mime,
      size_bytes: normalized.bytes.length,
      status: "ready",
    };
    // 対象ポストの画像だけ差し替える（他ポストの画像は残す・T-M8-398）。
    await pooledDb.query(`update drafts set images = $2::jsonb, updated_at = now() where id = $1`, [
      draftId,
      JSON.stringify(
        imagesReplacingPost(target.images, target.firstPostLocalId ?? "p1", image),
      ),
    ]);
    /*
      **差し替えた古い画像は消す**（原則4）。DBから外れただけの実体が残ると、
      使われないファイルがStorageの課金対象として増え続ける。
      消せなくても本体の操作は成功しているので、失敗は記録だけして進む。
    */
    const stale = imagePathsForPost(
      target.images,
      target.firstPostLocalId ?? "p1",
      postLocalId ?? target.firstPostLocalId ?? "p1",
    ).filter((p) => p !== path);
    if (stale.length > 0) {
      const removed = await admin.storage.from(IMAGE_BUCKET).remove(stale);
      if (removed.error) {
        recordUnexpectedError(removed.error, { at: "draft-image-upload:remove", draftId });
      }
    }
    revalidatePath("/app/posts");
    return { message: "画像をアップロードしました。", status: "success" };
  } catch (error) {
    return errorResult(error);
  }
}

/** 添えた画像を外す（生成した画像も外せる。外すと画像なしで投稿される）。 */
export async function removeDraftImageAction(input: unknown): Promise<BaseResult> {
  const parsed = parseUserInput(
    z.object({
      draft_id: z.string().uuid(),
      /** 対象ポスト（T-M8-398）。未指定は全ポストの画像を外す（従来互換）。 */
      post_local_id: z.string().min(1).max(20).optional(),
    }),
    input,
  );
  if (!parsed.success) return validationErrorResult(parsed.error);
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const target = await loadDraftImageTarget(auth.userId, parsed.data.draft_id);
    if (target.status !== "draft") {
      throw new AppError("job_conflict", {
        message: "この下書きはもう編集できません（投稿済み・処理中）。",
        details: { reason: `not_editable:${target.status}` },
      });
    }
    const firstId = target.firstPostLocalId ?? "p1";
    const targetPost = parsed.data.post_local_id ?? null;
    const remaining = targetPost
      ? target.images.filter((img) => effectiveImagePost(img, firstId) !== targetPost)
      : [];
    await pooledDb.query(`update drafts set images = $2::jsonb, updated_at = now() where id = $1`, [
      parsed.data.draft_id,
      JSON.stringify(remaining),
    ]);
    const stale = targetPost
      ? imagePathsForPost(target.images, firstId, targetPost)
      : replacedImagePaths(target.images, "");
    if (stale.length > 0) {
      const removed = await createSupabaseAdminClient()
        .storage.from(IMAGE_BUCKET)
        .remove(stale);
      if (removed.error) {
        recordUnexpectedError(removed.error, {
          at: "draft-image-remove",
          draftId: parsed.data.draft_id,
        });
      }
    }
    revalidatePath("/app/posts");
    return { message: "画像を外しました。", status: "success" };
  } catch (error) {
    return errorResult(error);
  }
}

/** 画像を差し替える対象（所有・状態・既存画像・1本目のlocal_id）。 */
async function loadDraftImageTarget(
  userId: string,
  draftId: string,
): Promise<{
  status: string;
  xAccountId: string;
  images: DraftImage[];
  firstPostLocalId: string | null;
  postLocalIds: string[];
}> {
  const { rows } = await pooledDb.query<{
    status: string;
    x_account_id: string;
    images: DraftImage[] | null;
    thread: { local_id?: string }[] | null;
  }>(
    `select d.status, d.x_account_id, d.images, d.thread
       from drafts d join x_accounts xa on xa.id = d.x_account_id
      where d.id = $1 and xa.user_id = $2`,
    [draftId, userId],
  );
  const row = rows[0];
  if (!row) throw new AppError("not_found");
  return {
    status: row.status,
    xAccountId: row.x_account_id,
    images: row.images ?? [],
    firstPostLocalId: row.thread?.[0]?.local_id ?? null,
    postLocalIds: (row.thread ?? [])
      .map((p) => p.local_id)
      .filter((id): id is string => Boolean(id)),
  };
}
