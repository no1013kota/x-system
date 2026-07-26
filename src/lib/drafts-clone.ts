import { randomUUID } from "node:crypto";

import { AppError } from "@/lib/observability/errors";

import type { ThreadItem } from "./ai/gen-output";
import type { DraftImage } from "./drafts";
import type { Queryable } from "./x/token-refresh";

/**
 * cloneFailedDraftForRetry の中核（要件05 §5・要件04 §11・要件06 §7, T-M3-24）。
 * 投稿ID作成履歴があり、曖昧状態・残存IDが解消済みの failed draft だけを対象に、本文・pattern・
 * source/quote情報を複製した `parent_draft_id` 付き新draftを作る（AI・生成枠・画像枠を消費しない）。
 * 画像は Storage object を新draft用pathへ copy し、全copy成功後に新画像参照を保存する。途中失敗は
 * copy済みobjectを best effort 削除して新draftを作らない。新draftは本文を initial_thread にも設定し、
 * source_job_id / tweet_ids / 投稿日時 / 実績 / 投稿error は空にする。元draftは変更しない。
 */

interface CloneSourceRow {
  status: string;
  pattern: string;
  thread: ThreadItem[];
  images: DraftImage[];
  quote_url: string | null;
  quote_tweet_id: string | null;
  source_news_item_id: string | null;
  tweet_ids: string[];
  last_post_error: {
    remaining_tweet_ids?: string[];
    ambiguous_create_indices?: number[];
    ambiguous_delete_tweet_ids?: string[];
  } | null;
  x_account_id: string;
  user_id: string;
}

export interface CloneDraftDeps {
  db: Queryable;
  /** Storage object を from→to へ複製（server配線は Supabase admin storage.copy）。 */
  copyImage: (from: string, to: string) => Promise<void>;
  /** copy済みobjectの best effort 削除（server配線は Supabase admin storage.remove）。 */
  deleteImages: (paths: string[]) => Promise<void>;
  newId?: () => string;
}

export interface CloneResult {
  draftId: string;
  deduped: boolean;
}

function extOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot >= 0 ? path.slice(dot + 1) : "bin";
}

export async function cloneFailedDraftForRetry(
  userId: string,
  input: { request_key: string; draft_id: string },
  deps: CloneDraftDeps,
): Promise<CloneResult> {
  const { db } = deps;
  const newId = deps.newId ?? randomUUID;

  const src = (
    await db.query<CloneSourceRow>(
      `select d.status, d.pattern, d.thread, d.images, d.quote_url, d.quote_tweet_id,
              d.source_news_item_id, d.tweet_ids, d.last_post_error, d.x_account_id, xa.user_id
         from drafts d join x_accounts xa on xa.id = d.x_account_id
        where d.id = $1 and xa.user_id = $2`,
      [input.draft_id, userId],
    )
  ).rows[0];
  if (!src) throw new AppError("not_found");
  if (src.status !== "failed") {
    throw new AppError("job_conflict", { details: { reason: `not_clonable:${src.status}` } });
  }
  // 作成履歴なしの failed は clone対象外（再生成/再投稿で扱う）。
  if (!Array.isArray(src.tweet_ids) || src.tweet_ids.length === 0) {
    throw new AppError("job_conflict", { details: { reason: "no_creation_history" } });
  }
  // 曖昧状態・残存IDが未解決なら先に reconcile が必要。
  const lpe = src.last_post_error;
  const unresolved =
    (lpe?.remaining_tweet_ids?.length ?? 0) > 0 ||
    (lpe?.ambiguous_create_indices?.length ?? 0) > 0 ||
    (lpe?.ambiguous_delete_tweet_ids?.length ?? 0) > 0;
  if (unresolved) {
    throw new AppError("job_conflict", { details: { reason: "unresolved_posting" } });
  }

  // 冪等: 同一元draftのAI無し複製（未投稿）が既にあれば返す（二重clone防止）。
  const existing = (
    await db.query<{ id: string }>(
      `select id from drafts
        where parent_draft_id = $1 and source_job_id is null and status = 'draft'
        order by created_at desc limit 1`,
      [input.draft_id],
    )
  ).rows[0];
  if (existing) return { draftId: existing.id, deduped: true };

  // 画像を新draft用pathへcopy（全成功後に参照保存。途中失敗はcopy済みを削除しdraftを作らない）。
  const newDraftId = newId();
  const readyImages = (src.images ?? []).filter((img) => img.status === "ready" && img.storage_path);
  const newImages: DraftImage[] = [];
  const copied: string[] = [];
  try {
    for (const img of readyImages) {
      const localId = newId();
      const toPath = `${src.user_id}/${src.x_account_id}/${newDraftId}/${localId}.${extOf(img.storage_path)}`;
      await deps.copyImage(img.storage_path, toPath);
      copied.push(toPath);
      newImages.push({
        local_id: localId,
        post_local_id: img.post_local_id,
        storage_path: toPath,
        provider: img.provider,
        mime_type: img.mime_type,
        size_bytes: img.size_bytes,
        status: "ready",
      });
    }
  } catch (error) {
    await deps.deleteImages(copied).catch(() => {});
    throw new AppError("internal_error", {
      cause: error,
      details: { reason: "image_copy_failed" },
    });
  }

  const threadJson = JSON.stringify(src.thread);
  await db.query(
    `insert into drafts
       (id, x_account_id, pattern, thread, initial_thread, images, status,
        source_job_id, parent_draft_id, source_news_item_id, quote_url, quote_tweet_id)
     values ($1, $2, $3, $4::jsonb, $4::jsonb, $5::jsonb, 'draft',
             null, $6, $7, $8, $9)`,
    [
      newDraftId,
      src.x_account_id,
      src.pattern,
      threadJson,
      JSON.stringify(newImages),
      input.draft_id,
      src.source_news_item_id,
      src.quote_url,
      src.quote_tweet_id,
    ],
  );

  return { draftId: newDraftId, deduped: false };
}
