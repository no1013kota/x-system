import { AppError } from "@/lib/observability/errors";
import { usagePeriodKeySql } from "@/lib/usage/usage-period";

import type { ThreadItem } from "./ai/gen-output";
import { counterTypeFor, finalTextResolver, postConsumeKey } from "./post/posting-text";
import type { Queryable } from "./x/token-refresh";

/**
 * reconcileDraftPosting の中核（要件05 §5・要件06 §7, T-M3-23）。failed draft のみ対象に、
 * 既知tweet_idと直近投稿をXから再照合して未解決状態を解消する。
 *
 * - 作成不明（threadが未完＝tweet_ids.length < thread.length）: 直近投稿から全ポストを意図した
 *   threadとして照合できれば不足tweet_id/`post_create` consumeを冪等補完して posted へ確定する。
 *   一意に確定できなければ failed のまま。
 * - 削除不明（thread完了＋`ambiguous_delete_tweet_ids`）: 対象IDを存在確認し、削除済みなら
 *   `post_delete` consume を補完して未解決情報から外す。まだ存在する候補は残存として維持する。
 *
 * DB・X呼び出しは注入する。consume はいずれも冪等キーで二重計上しない。
 */


interface LastPostError {
  code?: string;
  remaining_tweet_ids?: string[];
  deleted_tweet_ids?: string[];
  ambiguous_create_indices?: number[];
  ambiguous_delete_tweet_ids?: string[];
}

interface ReconcileDraftRow {
  status: string;
  thread: ThreadItem[];
  tweet_ids: string[];
  last_post_error: LastPostError | null;
  quote_url: string | null;
  x_account_id: string;
  x_user_id: string;
  user_id: string;
}

export interface ReconcileRecentPost {
  id: string;
  text: string;
  createdAt: string | null;
  inReplyToId: string | null;
}

export interface ReconcileDeps {
  db: Queryable;
  getAccessToken: (xAccountId: string) => Promise<string>;
  getRecentPosts: (accessToken: string, xUserId: string) => Promise<ReconcileRecentPost[]>;
  checkTweetExists: (accessToken: string, tweetId: string) => Promise<boolean | null>;
  now?: () => number;
}

export type ReconcileResult =
  | { status: "posted"; draftId: string }
  | { status: "deletes_reconciled"; draftId: string; remaining: string[] }
  | { status: "still_failed"; draftId: string };

async function loadDraft(
  db: Queryable,
  userId: string,
  draftId: string,
): Promise<ReconcileDraftRow | null> {
  const { rows } = await db.query<ReconcileDraftRow>(
    `select d.status, d.thread, d.tweet_ids, d.last_post_error, d.quote_url,
            d.x_account_id, xa.x_user_id, xa.user_id
       from drafts d join x_accounts xa on xa.id = d.x_account_id
      where d.id = $1 and xa.user_id = $2`,
    [draftId, userId],
  );
  return rows[0] ?? null;
}

export async function reconcileDraftPosting(
  deps: ReconcileDeps,
  input: { userId: string; draftId: string },
): Promise<ReconcileResult> {
  const { db } = deps;
  const { userId, draftId } = input;

  const draft = await loadDraft(db, userId, draftId);
  if (!draft) throw new AppError("not_found");
  if (draft.status !== "failed") {
    throw new AppError("job_conflict", { details: { reason: `not_reconcilable:${draft.status}` } });
  }

  const thread = Array.isArray(draft.thread) ? draft.thread : [];
  const tweetIds = Array.isArray(draft.tweet_ids) ? draft.tweet_ids : [];
  const lpe = draft.last_post_error;
  const finalTextAt = finalTextResolver(thread, draft.quote_url);

  const accessToken = await deps.getAccessToken(draft.x_account_id);

  const consumeEvent = (
    tweetId: string,
    counterType: string,
    op: "post_create" | "post_delete",
  ): Promise<unknown> =>
    db.query(
      `insert into usage_events
         (user_id, x_account_id, draft_id, tweet_id, month, counter_type, operation, delta, reason, idempotency_key)
       values ($1, $2, $3, $4, ${usagePeriodKeySql("$1")},
               $5, $6, 1, 'consume', $7)
       on conflict (idempotency_key) do nothing`,
      [
        userId,
        draft.x_account_id,
        draftId,
        tweetId,
        counterType,
        op,
        postConsumeKey(draftId, tweetId, op),
      ],
    );

  // --- 作成不明: threadが未完なら直近投稿から全ポストを照合して補完（要件05 §5）---
  if (tweetIds.length < thread.length && thread.length > 0) {
    const recent = await deps.getRecentPosts(accessToken, draft.x_user_id);
    const resolved: (string | null)[] = [];
    for (let i = 0; i < thread.length; i++) {
      if (i < tweetIds.length && tweetIds[i]) {
        resolved.push(tweetIds[i]);
        continue;
      }
      const prev = i > 0 ? resolved[i - 1] : null;
      if (i > 0 && prev == null) {
        resolved.push(null); // 直前が未確定なら reply 照合できない
        continue;
      }
      const text = finalTextAt(i);
      const matches = recent.filter((p) => p.text === text && p.inReplyToId === prev);
      resolved.push(matches.length === 1 ? matches[0].id : null);
    }

    if (resolved.every((r): r is string => r != null)) {
      const original = new Set(tweetIds);
      for (let i = 0; i < resolved.length; i++) {
        if (!original.has(resolved[i])) {
          await consumeEvent(resolved[i], counterTypeFor(finalTextAt(i)), "post_create");
        }
      }
      await db.query(
        `update drafts
            set tweet_ids = $2::jsonb, status = 'posted', root_tweet_id = $3,
                posted_at = now(), posted_mode = coalesce(posted_mode, 'manual'),
                next_metrics_at = now() + interval '1 day', last_post_error = null, updated_at = now()
          where id = $1`,
        [draftId, JSON.stringify(resolved), resolved[0]],
      );
      return { status: "posted", draftId };
    }
    return { status: "still_failed", draftId };
  }

  // --- 削除不明: rollbackで結果不明だった削除を存在確認して補完（要件05 §5）---
  const ambiguous = lpe?.ambiguous_delete_tweet_ids ?? [];
  if (ambiguous.length > 0) {
    const stillAmbiguous: string[] = [];
    const newlyDeleted: string[] = [];
    for (const tweetId of ambiguous) {
      const exists = await deps.checkTweetExists(accessToken, tweetId);
      if (exists === false) {
        const idx = tweetIds.indexOf(tweetId);
        const counterType = idx >= 0 ? counterTypeFor(finalTextAt(idx)) : "post_normal";
        await consumeEvent(tweetId, counterType, "post_delete");
        newlyDeleted.push(tweetId);
      } else {
        stillAmbiguous.push(tweetId); // まだ存在 or 判定不能 → 未解決を維持
      }
    }
    const nextError: LastPostError = {
      ...lpe,
      deleted_tweet_ids: [...(lpe?.deleted_tweet_ids ?? []), ...newlyDeleted],
      ambiguous_delete_tweet_ids: stillAmbiguous,
    };
    await db.query(
      `update drafts set last_post_error = $2::jsonb, updated_at = now() where id = $1`,
      [draftId, JSON.stringify(nextError)],
    );
    const remaining = [...(nextError.remaining_tweet_ids ?? []), ...stillAmbiguous];
    return { status: "deletes_reconciled", draftId, remaining };
  }

  return { status: "still_failed", draftId };
}
