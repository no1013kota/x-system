import type { Queryable } from "../db/queryable";

import { ensureAutoPostPublishJob } from "./publish-chain";

/**
 * 期限が来た「日時予約された下書き」を投稿へ流す（要件04・T-M8-157）。
 *
 * `schedule_slots` は**投稿を生成する**トリガーだが、こちらは**既にある下書きを投稿する**。
 * 投稿そのものは既存の `post_publish` job に任せる——自動投稿同意・日次上限・阻害警告の判定と
 * `last_post_error` への記録は handler が持っており、**判定を2箇所に置くと片方だけ直して食い違う**
 * （`publish-chain.ts` と同じ理由）。
 *
 * 冪等keyも `autoPostPublishKey`（draft単位）を共用する。同じ下書きに対して
 * 手動投稿・スロット由来の連鎖・この予約が同時に進もうとしても、二重投稿にならない。
 */

/** 1回のtickで流す上限。1アカウントの予約が溜まってもtickを溢れさせない。 */
export const SCHEDULED_DRAFT_BATCH = 100;

export interface DueScheduledDraft {
  draftId: string;
  xAccountId: string;
}

export interface EnqueueScheduledDraftsResult {
  /** 期限到来として拾った件数。 */
  due: number;
  /** 実際に `post_publish` を作った件数（既にjobがあるものは含まない）。 */
  enqueued: number;
  /**
   * 予約されていたが対象Xアカウントが active でないため流せなかった件数。
   * **0件と「全部弾いた」を区別できるように別の値で返す**（原則1）。
   */
  skippedInactive: number;
}

/**
 * 期限到来分を拾って `post_publish` を作る。**予約は解除しない**——
 * 投稿が終われば `status` が `posted` になり、部分indexの条件から外れて二度と拾われない。
 * ここで `scheduled_at` を null に戻すと、失敗したときに「予約した記録」が消えて
 * 運営者が何が起きたか辿れなくなる。
 */
export async function enqueueDueScheduledDrafts(
  db: Queryable,
  nowIso?: string,
): Promise<EnqueueScheduledDraftsResult> {
  const { rows } = await db.query<{
    id: string;
    x_account_id: string;
    x_status: string;
  }>(
    `select d.id, d.x_account_id, xa.status as x_status
       from drafts d join x_accounts xa on xa.id = d.x_account_id
      where d.status = 'draft'
        and d.scheduled_at is not null
        and d.scheduled_at <= coalesce($1::timestamptz, now())
      order by d.scheduled_at asc
      limit $2`,
    [nowIso ?? null, SCHEDULED_DRAFT_BATCH],
  );

  let enqueued = 0;
  let skippedInactive = 0;
  for (const row of rows) {
    if (row.x_status !== "active") {
      skippedInactive += 1;
      continue;
    }
    const created = await ensureAutoPostPublishJob(db, {
      draftId: row.id,
      xAccountId: row.x_account_id,
    });
    if (created) enqueued += 1;
  }

  return { due: rows.length, enqueued, skippedInactive };
}
