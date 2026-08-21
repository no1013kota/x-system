import type { Queryable } from "../db/queryable";

import { createFailedNotification } from "./notifications";
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

/**
 * 予約時刻からこの分数を過ぎた予約は**投稿せず解除して知らせる**（T-M8-196）。
 * 失効中に溜まった予約が再連携の瞬間に何日遅れでもまとめて投稿されるのを防ぐ——
 * 遅れた投稿は文脈がズレており、利用者が意図した「その時刻の投稿」ではない。
 * 通常運用の遅延（tick間隔5分＋障害の回復）は十分に収まる幅にする。
 */
export const SCHEDULED_DRAFT_MAX_LATE_MINUTES = 60;

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
  /**
   * 過去のautoジョブが終端済みでkeyを保持しており、二度と投稿できないため
   * 予約を解除して通知した件数（T-M8-196。放置すると毎tick選ばれ続けるのに何も起きない）。
   */
  expired: number;
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
    too_late: boolean;
  }>(
    `select d.id, d.x_account_id, xa.status as x_status,
            d.scheduled_at < coalesce($1::timestamptz, now()) - make_interval(mins => $3) as too_late
       from drafts d join x_accounts xa on xa.id = d.x_account_id
      where d.status = 'draft'
        and d.scheduled_at is not null
        and d.scheduled_at <= coalesce($1::timestamptz, now())
      order by d.scheduled_at asc
      limit $2`,
    [nowIso ?? null, SCHEDULED_DRAFT_BATCH, SCHEDULED_DRAFT_MAX_LATE_MINUTES],
  );

  let enqueued = 0;
  let skippedInactive = 0;
  let expired = 0;
  for (const row of rows) {
    if (row.too_late) {
      // 60分超の遅れは投稿しない（失効からの再連携で溜まった予約を古い時刻のまま流さない・T-M8-196）。
      await expireScheduledDraft(db, row.id, {
        message:
          "予約時刻を1時間以上過ぎたため、この予約は実行せず解除しました。内容を確認して、もう一度予約するか手動で投稿してください。",
        title: "予約した投稿を実行しませんでした",
        body: "予約時刻を1時間以上過ぎていたため、自動投稿を行わず予約を解除しました。内容を確認して、もう一度予約するか手動で投稿してください。",
      });
      expired += 1;
      continue;
    }
    if (row.x_status !== "active") {
      skippedInactive += 1;
      continue;
    }
    const result = await ensureAutoPostPublishJob(db, {
      draftId: row.id,
      xAccountId: row.x_account_id,
    });
    if (result === "created") enqueued += 1;
    if (result === "spent") {
      /*
        過去のautoジョブが終端済み（同意撤回・日次上限などで canceled/failed）。
        keyは恒久uniqueなので**この下書きの自動投稿は二度と作れない**。予約を残すと
        毎tick選ばれ続けるのに何も起きない（永久沈黙・T-M8-196で実DB再現）。
        予約を解除し、理由をlast_post_errorへ残して利用者へ通知する（原則1）。
      */
      await expireScheduledDraft(db, row.id, {
        message:
          "予約時刻に投稿できませんでした（過去の自動投稿が停止されています）。内容を確認して手動で投稿してください。",
        title: "予約した投稿を実行できませんでした",
        body: "予約時刻になりましたが、この下書きの自動投稿は停止されています。内容を確認して手動で投稿するか、もう一度予約してください。",
      });
      expired += 1;
    }
  }

  return { due: rows.length, enqueued, skippedInactive, expired };
}

/** 予約を解除して理由を残し、利用者へ通知する（原則1: 黙って何もしない状態を作らない）。 */
async function expireScheduledDraft(
  db: Queryable,
  draftId: string,
  text: { message: string; title: string; body: string },
): Promise<void> {
  const { rows: updated } = await db.query<{ user_id: string }>(
    `update drafts d
        set scheduled_at = null,
            last_post_error = jsonb_build_object(
              'code', 'scheduled_publish_expired', 'message', $2::text),
            updated_at = now()
       from x_accounts xa
      where d.id = $1 and xa.id = d.x_account_id
      returning xa.user_id`,
    [draftId, text.message],
  );
  const userId = updated[0]?.user_id;
  if (userId) {
    await createFailedNotification(db, {
      userId,
      jobId: `scheduled-draft:${draftId}`,
      title: text.title,
      body: text.body,
      link: `/app/posts?tab=drafts&draftId=${draftId}`,
    });
  }
}
