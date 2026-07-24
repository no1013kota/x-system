import { AppError } from "@/lib/observability/errors";
import type { ThreadItem } from "@/lib/ai/gen-output";
import {
  PATTERN_MAX_POSTS,
  revalidateEditedThread,
} from "@/lib/post/generation-validation";

import type { Queryable } from "./x/token-refresh";

/**
 * 下書きの一覧・編集・破棄の中核（要件05 §5・要件06 §4.3・要件02 §3.9/§4.7, T-M3-10）。
 * DB・画像削除は注入し純粋に保つ。編集は status=draft のみ・楽観lock・pattern別最大数を検証し、
 * 保存時に加重文字数/NG警告を再計算する（initial_thread は不変）。破棄は draft/failed のみで
 * 未解決の投稿状態がある failed は拒否し、status=discarded にして物理削除しない。
 */

export type DraftTab = "drafts" | "history";

export interface DraftImage {
  local_id: string;
  post_local_id?: string;
  storage_path: string;
  provider?: string;
  mime_type?: string;
  size_bytes?: number;
  status?: string;
}

export interface DraftView {
  id: string;
  pattern: string;
  status: string;
  thread: ThreadItem[];
  images: DraftImage[];
  root_tweet_id: string | null;
  posted_at: string | null;
  created_at: string;
  updated_at: string;
}

// updated_at は楽観lockのversionトークン。timestamptzはマイクロ秒精度でJS Date（ミリ秒）往復では
// 末尾が欠落するため、::text で完全精度の文字列として返し、更新時も text 一致で照合する。
const DRAFT_COLUMNS = `id, pattern, status, thread, images, root_tweet_id,
  posted_at::text as posted_at, created_at::text as created_at, updated_at::text as updated_at`;

/** active_x_account の下書き（draft/failed）または履歴（posted）を新しい順で返す。 */
export async function listDraftsForAccount(
  db: Queryable,
  xAccountId: string,
  tab: DraftTab,
): Promise<DraftView[]> {
  const statuses = tab === "history" ? ["posted"] : ["draft", "failed"];
  const { rows } = await db.query<DraftView>(
    `select ${DRAFT_COLUMNS} from drafts
      where x_account_id = $1 and status = any($2)
      order by coalesce(posted_at, updated_at) desc, created_at desc`,
    [xAccountId, statuses],
  );
  return rows;
}

interface OwnedDraftRow {
  status: string;
  pattern: string;
  images: DraftImage[];
  settings: { ng?: { words?: string[] } } | null;
  tweet_ids: string[];
  last_post_error: unknown;
}

async function loadOwnedDraft(
  db: Queryable,
  userId: string,
  draftId: string,
): Promise<OwnedDraftRow> {
  const row = (
    await db.query<OwnedDraftRow>(
      `select d.status, d.pattern, d.images, d.tweet_ids, d.last_post_error, xa.settings
         from drafts d join x_accounts xa on xa.id = d.x_account_id
        where d.id = $1 and xa.user_id = $2`,
      [draftId, userId],
    )
  ).rows[0];
  if (!row) throw new AppError("not_found");
  return row;
}

export interface UpdateDraftParams {
  userId: string;
  draftId: string;
  expectedUpdatedAt: string;
  posts: { local_id?: string; text: string; sources?: string[] }[];
  /** 保持する既存画像のlocal_id（所有draftの既存画像のみ）。未指定なら現状維持。 */
  imageLocalIds?: string[];
}

export async function updateDraft(
  db: Queryable,
  params: UpdateDraftParams,
): Promise<{ id: string; updatedAt: string }> {
  const draft = await loadOwnedDraft(db, params.userId, params.draftId);
  if (draft.status !== "draft") {
    throw new AppError("job_conflict", { details: { reason: `not_editable:${draft.status}` } });
  }
  const max = PATTERN_MAX_POSTS[draft.pattern] ?? 1;
  if (params.posts.length < 1 || params.posts.length > max) {
    throw new AppError("validation_error", {
      details: { reason: "post_count", min: 1, max },
    });
  }

  // 既存画像のみ参照可（他draft/未所有の画像は不可）。
  const existingIds = new Set(draft.images.map((img) => img.local_id));
  let images = draft.images;
  if (params.imageLocalIds) {
    if (!params.imageLocalIds.every((id) => existingIds.has(id))) {
      throw new AppError("validation_error", { details: { reason: "unknown_image" } });
    }
    images = draft.images.filter((img) => params.imageLocalIds!.includes(img.local_id));
  }

  const ngWords = draft.settings?.ng?.words ?? [];
  const thread = revalidateEditedThread(params.posts, ngWords);

  const { rows } = await db.query<{ id: string; updated_at: string }>(
    `update drafts
        set thread = $3::jsonb, images = $4::jsonb, updated_at = now()
      where id = $1 and status = 'draft' and updated_at::text = $2
      returning id, updated_at::text as updated_at`,
    [params.draftId, params.expectedUpdatedAt, JSON.stringify(thread), JSON.stringify(images)],
  );
  if (!rows[0]) {
    // 楽観lock不一致 or status変化。最新を再読込するよう促す。
    throw new AppError("job_conflict", { details: { reason: "stale_or_changed" } });
  }
  return { id: rows[0].id, updatedAt: rows[0].updated_at };
}

export interface DiscardDraftDeps {
  /** 生成画像のStorage削除（best effort）。 */
  deleteImages: (storagePaths: string[]) => Promise<void>;
}

export async function discardDraft(
  db: Queryable,
  params: { userId: string; draftId: string; expectedUpdatedAt: string },
  deps: DiscardDraftDeps,
): Promise<{ status: string }> {
  const draft = await loadOwnedDraft(db, params.userId, params.draftId);
  if (draft.status !== "draft" && draft.status !== "failed") {
    throw new AppError("job_conflict", { details: { reason: `not_discardable:${draft.status}` } });
  }
  // 未解決の投稿ID・作成成否がある failed は破棄不可（先に reconcile が必要）。
  if (
    draft.status === "failed" &&
    ((Array.isArray(draft.tweet_ids) && draft.tweet_ids.length > 0) || draft.last_post_error != null)
  ) {
    throw new AppError("job_conflict", { details: { reason: "unresolved_posting" } });
  }

  const { rows } = await db.query<{ id: string }>(
    `update drafts set status = 'discarded', updated_at = now()
      where id = $1 and status = $2 and updated_at::text = $3
      returning id`,
    [params.draftId, draft.status, params.expectedUpdatedAt],
  );
  if (!rows[0]) {
    throw new AppError("job_conflict", { details: { reason: "stale_or_changed" } });
  }

  // draft専用pathの生成画像をbest effortで削除（失敗は破棄を妨げない）。
  const paths = draft.images
    .map((img) => img.storage_path)
    .filter((p): p is string => typeof p === "string" && p.length > 0);
  if (paths.length > 0) {
    try {
      await deps.deleteImages(paths);
    } catch {
      // best effort
    }
  }
  return { status: "discarded" };
}
