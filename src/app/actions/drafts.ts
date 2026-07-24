"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth/session";
import { getPool } from "@/lib/db/pool";
import {
  discardDraft,
  listDraftsForAccount,
  updateDraft,
  type DraftView,
} from "@/lib/drafts";
import { AppError, toUserFacingError } from "@/lib/observability/errors";
import { reconcileDraftPosting } from "@/lib/reconcile-posting";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveActiveXAccountForUser } from "@/lib/x/account-actions-server";
import { getRecentPosts, getTweetMetrics } from "@/lib/x/client";
import { xClientDeps } from "@/lib/x/client-server";
import { getValidXAccessToken } from "@/lib/x/token-refresh-server";
import type { Queryable } from "@/lib/x/token-refresh";

/**
 * 下書きの Server Actions（要件05 §5, T-M3-10）。本人のみ。一覧は active_x_account スコープ、
 * 編集は status=draft・楽観lock・pattern別最大数、破棄は draft/failed のみ（未解決failedは拒否）。
 */

const IMAGE_BUCKET = "generated-images";

const pooledDb: Queryable = {
  query: <T = unknown>(sql: string, params?: unknown[]) =>
    getPool().query(sql, params) as unknown as Promise<{
      rows: T[];
      rowCount: number | null;
    }>,
};

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

interface BaseResult {
  code?: string;
  details?: Record<string, unknown>;
  message: string;
  status: "error" | "success";
}

async function requireUserId(): Promise<
  { ok: true; userId: string } | { ok: false; result: BaseResult }
> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      ok: false,
      result: { ...toUserFacingError(new AppError("unauthorized")), status: "error" },
    };
  }
  return { ok: true, userId: user.id };
}

export async function listDraftsAction(
  input: unknown = {},
): Promise<BaseResult & { drafts?: DraftView[] }> {
  const parsed = listSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { ...toUserFacingError(new AppError("validation_error")), status: "error" };
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
    return { ...toUserFacingError(error), status: "error" };
  }
}

export async function updateDraftAction(
  input: unknown,
): Promise<BaseResult & { updatedAt?: string }> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { ...toUserFacingError(new AppError("validation_error")), status: "error" };
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
    return { ...toUserFacingError(error), status: "error" };
  }
}

export async function reconcileDraftPostingAction(
  input: unknown,
): Promise<BaseResult & { reconcileStatus?: string }> {
  const parsed = reconcileSchema.safeParse(input);
  if (!parsed.success) {
    return { ...toUserFacingError(new AppError("validation_error")), status: "error" };
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
          } catch {
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
    return { ...toUserFacingError(error), status: "error" };
  }
}

export async function discardDraftAction(input: unknown): Promise<BaseResult> {
  const parsed = discardSchema.safeParse(input);
  if (!parsed.success) {
    return { ...toUserFacingError(new AppError("validation_error")), status: "error" };
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
    return { ...toUserFacingError(error), status: "error" };
  }
}
