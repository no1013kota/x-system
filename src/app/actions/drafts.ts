"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { type BaseResult, errorResult, requireUserId, validationErrorResult } from "./_helpers";
import { parseUserInput } from "@/lib/validation/user-input";
import { pooledQueryable } from "@/lib/db/pool";
import { cloneFailedDraftForRetry } from "@/lib/drafts-clone";
import { env } from "@/lib/env";
import {
  discardDraft,
  listDraftsForAccount,
  updateDraft,
  type DraftView,
} from "@/lib/drafts";
import { reconcileDraftPosting } from "@/lib/reconcile-posting";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveActiveXAccountForUser } from "@/lib/x/account-actions-server";
import { getRecentPosts, getTweetMetrics } from "@/lib/x/client";
import { xClientDeps } from "@/lib/x/client-server";
import { getValidXAccessToken } from "@/lib/x/token-refresh-server";
import { recordUnexpectedError } from "@/lib/observability/sentry";

/**
 * 下書きの Server Actions（要件05 §5, T-M3-10）。本人のみ。一覧は active_x_account スコープ、
 * 編集は status=draft・楽観lock・pattern別最大数、破棄は draft/failed のみ（未解決failedは拒否）。
 */

// バケット名は env が正本（他5箇所は既に env 経由）。ここだけ直書きだったため、
// バケットを変えても削除だけ旧バケットを掃除し続ける状態になっていた（R26）。
const IMAGE_BUCKET = env.SUPABASE_STORAGE_BUCKET_IMAGES;

const pooledDb = pooledQueryable();

const listSchema = z.object({ tab: z.enum(["drafts", "history"]).default("drafts") });
const updateSchema = z.object({
  draft_id: z.string().uuid(),
  expected_updated_at: z.string().min(1),
  posts: z
    .array(z.object({ local_id: z.string().optional(), text: z.string().max(10000) }))
    .min(1),
  image_local_ids: z.array(z.string()).optional(),
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
