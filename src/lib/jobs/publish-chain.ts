import type { Queryable } from "../db/queryable";

/**
 * auto（自動投稿）スロットの「生成成功 → 投稿」の連鎖（要件04 §10 手順6/7・T-M8-143）。
 *
 * **これが無いあいだ、`mode=auto` の予約は下書きを作るだけで投稿されていなかった。**
 * `post_publish` を作っていたのは (1) 画面からの手動投稿 (2) 画像jobがstale/最終失敗した
 * ときの回収 の2箇所だけで、成功経路は `draft_created` 通知で終わっていた
 * （`post-generation.ts` に「auto時の post_publish 子job作成はM4で追加する」という
 * コメントが残ったままだった）。
 *
 * **冪等keyは draft 単位にする。** 同じ下書きに対して複数の経路（本文生成の成功・画像生成の成功・
 * 画像失敗の回収）が投稿へ進もうとするため、経路ごとの key（`parent:...`）にすると
 * **同じ下書きが2回投稿されうる**。draft単位なら後から来た経路は必ず衝突して何もしない。
 */

/** 同じ下書きの自動投稿jobは常にこのkey。**経路をまたいで衝突させる**のが目的。 */
export function autoPostPublishKey(draftId: string): string {
  return `job:${draftId}:post_publish:auto`;
}

/**
 * 自動投稿の `post_publish` 子jobを、無ければ1件だけ作る。作ったら true。
 *
 * **阻害警告や同意の確認はここでしない。** `post-publish` handler が投稿直前に
 * `threadBlocksAutoPost` と自動投稿同意を見て、止めた理由を draft の `last_post_error` へ
 * 残す（要件04 §10 step2）。判定を2箇所に置くと、片方だけ直して食い違う。
 */
export async function ensureAutoPostPublishJob(
  db: Queryable,
  params: { xAccountId: string; draftId: string },
): Promise<boolean> {
  // 実行中／待機中のものがあれば作らない（`request_key` の衝突だけでは、
  // 過去に終わったjobがあるときに再作成を止められない）。
  const active = await db.query(
    `select 1 from generation_jobs
      where draft_id = $1 and kind = 'post_publish' and status in ('queued', 'running')
      limit 1`,
    [params.draftId],
  );
  if ((active.rowCount ?? 0) > 0) return false;
  const inserted = await db.query(
    `insert into generation_jobs
       (x_account_id, kind, trigger, draft_id, input, request_key, status)
     values ($1, 'post_publish', 'system', $2, $3::jsonb, $4, 'queued')
     on conflict (request_key) do nothing`,
    [
      params.xAccountId,
      params.draftId,
      JSON.stringify({ mode: "auto" }),
      autoPostPublishKey(params.draftId),
    ],
  );
  return (inserted.rowCount ?? 0) > 0;
}

/** この生成が自動投稿まで進むか（jobのinputから読む）。 */
export function isAutoMode(input: { mode?: string | null } | null | undefined): boolean {
  return input?.mode === "auto";
}
