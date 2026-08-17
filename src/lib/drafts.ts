import { AppError } from "@/lib/observability/errors";
import type { ThreadItem } from "@/lib/ai/gen-output";
import { revalidateEditedThread } from "@/lib/post/generation-validation";

import type { Queryable } from "./x/token-refresh";
import { recordUnexpectedError } from "./observability/sentry";

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
  /** 表示専用の短時間署名URL（DBへ永続化しない・要件02 §4.8）。表示層で付与する。 */
  signed_url?: string;
}

export interface DraftView {
  id: string;
  pattern: string;
  /** 生成時に写したパターン名。画面のバッジはこれを出す（T-M8-129 U3）。 */
  pattern_name: string;
  /** 生成時に写した編集上限。 */
  max_posts_edit: number;
  status: string;
  thread: ThreadItem[];
  images: DraftImage[];
  parent_draft_id: string | null;
  root_tweet_id: string | null;
  /** 投稿済み tweet_id（投稿順）。履歴タブで X 上ポストへのリンクに使う。 */
  tweet_ids: string[];
  /** 投稿方法（auto/manual）。履歴の自動/手動表示に使う。 */
  posted_mode: string | null;
  /** 投稿失敗の詳細（§4.10）。復旧UIが未解決状態（残存/曖昧）の判定に使う。 */
  last_post_error: {
    code?: string;
    /**
     * 利用者向けの失敗理由（T-M8-51）。**画面に出す**。
     *
     * これを通していなかったため、投稿実行が保存した丁寧な文言（「2本目の本文が長すぎます…
     * Xへの投稿は1件も行っていません」）が**どこにも表示されず**、利用者には汎用の失敗文しか
     * 届いていなかった。「Xへ出ていない」と伝わらないと、Xを見に行くまで確認できない。
     */
    message?: string;
    remaining_tweet_ids?: string[];
    ambiguous_create_indices?: number[];
    ambiguous_delete_tweet_ids?: string[];
  } | null;
  posted_at: string | null;
  created_at: string;
  updated_at: string;
}

// updated_at は楽観lockのversionトークン。timestamptzはマイクロ秒精度でJS Date（ミリ秒）往復では
// 末尾が欠落するため、::text で完全精度の文字列として返し、更新時も text 一致で照合する。
const DRAFT_COLUMNS = `id, pattern, pattern_name, max_posts_edit, status, thread, images, parent_draft_id, root_tweet_id,
  tweet_ids, posted_mode, last_post_error,
  posted_at::text as posted_at, created_at::text as created_at, updated_at::text as updated_at`;

/**
 * active_x_account の下書き（draft/failed）または履歴（posted）を新しい順で返す。
 *
 * `limit` はT-M8-67で追加: LIMITなしだと履歴が数百件に育ったとき、thread/images のJSONを
 * 全件転送し、画像の署名URL発行も件数分走る。呼び出し側は件数が上限に達したら
 * 「直近N件を表示」と明示する（黙って切り捨てない）。
 */
export async function listDraftsForAccount(
  db: Queryable,
  xAccountId: string,
  tab: DraftTab,
  options: { limit?: number } = {},
): Promise<DraftView[]> {
  const statuses = tab === "history" ? ["posted"] : ["draft", "failed"];
  const params: unknown[] = [xAccountId, statuses];
  let limitClause = "";
  if (options.limit) {
    params.push(options.limit);
    limitClause = ` limit $${params.length}`;
  }
  const { rows } = await db.query<DraftView>(
    `select ${DRAFT_COLUMNS} from drafts
      where x_account_id = $1 and status = any($2)
      order by coalesce(posted_at, updated_at) desc, created_at desc${limitClause}`,
    params,
  );
  return rows;
}

/**
 * ホームの確認待ちキュー（T-M8-67）: status=draft のみを新しい順に limit 件と、
 * KPI用の総数を返す。以前は全下書き（thread/images込み）を取得してから
 * アプリ側でフィルタしており、下書きが溜まるほどホームが際限なく重くなった。
 */
export async function listPendingDraftsForHome(
  db: Queryable,
  xAccountId: string,
  limit: number,
): Promise<{ drafts: DraftView[]; total: number }> {
  const [list, count] = await Promise.all([
    db.query<DraftView>(
      `select ${DRAFT_COLUMNS} from drafts
        where x_account_id = $1 and status = 'draft'
        order by updated_at desc, created_at desc limit $2`,
      [xAccountId, limit],
    ),
    db.query<{ n: number }>(
      `select count(*)::int as n from drafts where x_account_id = $1 and status = 'draft'`,
      [xAccountId],
    ),
  ]);
  return { drafts: list.rows, total: count.rows[0]?.n ?? 0 };
}

interface OwnedDraftRow {
  status: string;
  pattern: string;
  /** 生成時に写したパターン名。画面と通知に出す（内部IDは出さない）。 */
  pattern_name: string;
  /** 生成時に写した編集上限。 */
  max_posts_edit: number;
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
      `select d.status, d.pattern, d.pattern_name, d.max_posts_edit, d.images, d.tweet_ids,
              d.last_post_error, xa.settings
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
  // 編集で許すポスト数は**生成時に写した値**を使う（T-M8-129 U3）。
  // パターンを後から編集・削除しても、過去の下書きの編集可能範囲が変わらない。
  const max = draft.max_posts_edit;
  if (params.posts.length < 1 || params.posts.length > max) {
    throw new AppError("validation_error", {
      details: { reason: "post_count", min: 1, max },
    });
  }
  // 投稿本文は空不可（要件05 §12）。
  if (params.posts.some((p) => p.text.trim().length === 0)) {
    throw new AppError("validation_error", { details: { reason: "empty_post" } });
  }

  // 既存画像のみ参照可（他draft/未所有の画像は不可）。
  const existingIds = new Set(draft.images.map((img) => img.local_id));
  let images = draft.images;
  if (params.imageLocalIds) {
    const imageLocalIds = params.imageLocalIds;
    if (!imageLocalIds.every((id) => existingIds.has(id))) {
      throw new AppError("validation_error", { details: { reason: "unknown_image" } });
    }
    images = draft.images.filter((img) => imageLocalIds.includes(img.local_id));
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
    } catch (error) {
      // 下書き破棄はStorage削除の失敗では止めない。ただし未参照画像が静かに残るため記録する。
      recordUnexpectedError(error, { at: "drafts:delete-images" });
    }
  }
  return { status: "discarded" };
}
