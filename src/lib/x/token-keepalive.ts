import type { Queryable } from "./token-refresh";

/**
 * Xの連携を切らさない（T-M8-359・運営者の指示 2026-08-28）。
 *
 * ## なぜ要るか
 *
 * Xのaccess tokenは2時間で切れ、refresh tokenは**使うたびに入れ替わる**。これまでは
 * 「使うときに切れていたら更新する」だけだったので、投稿も分析も走らない日が続くと
 * refresh tokenが古いまま置き去りになり、**久しぶりに使ったときに `invalid_request` で
 * 弾かれて要再連携**になる（2026-08-15に実アカウント2つで発生・T-M8-96）。
 * 利用者から見れば「何もしていないのに連携が切れた」で、最も体験が悪い壊れ方をする。
 *
 * ## 何をするか
 *
 * 1時間に1回、**期限が近いものだけ**を先回りで更新する。更新のたびにrefresh tokenも
 * 入れ替わるので、使われないアカウントでもtokenが寝たままにならない。
 * 更新そのものは `getValidAccessToken`（single-flight・失敗時の要再連携遷移つき）を
 * そのまま使う——**更新の作法を2か所に持たない**。
 *
 * ## 数える対象
 *
 * `status='active'` で refresh token を持つものだけ。`expired` は人が再連携するまで
 * どうやっても直らないので、ここでは触らない（毎時APIを叩いて毎時失敗させない）。
 */

/** どれくらい先に切れるものを更新するか。cronは1時間おきなので、2時間の寿命に対して余裕を取る。 */
export const KEEPALIVE_LEAD_MINUTES = 90;

/** 1回で更新する上限。増えても次の起動が続きを見る（1回のcronを長時間占有しない）。 */
export const KEEPALIVE_MAX_PER_RUN = 25;

export interface KeepAliveResult {
  /** 対象になった件数。 */
  targeted: number;
  /** 更新できた件数。 */
  refreshed: number;
  /** 更新できなかった件数（要再連携になったものを含む）。 */
  failed: number;
}

/**
 * 期限が近いアカウントを先回りで更新する。
 *
 * **失敗しても止めない**——1アカウントの要再連携で、他のアカウントの更新まで巻き添えにしない。
 * 失敗の中身（要再連携かどうか）は `getValidAccessToken` が状態と通知へ書くので、
 * ここは件数だけ返す。
 */
export async function refreshDueXTokens(
  db: Queryable,
  refresh: (xAccountId: string) => Promise<unknown>,
  options: { leadMinutes?: number; limit?: number; onError?: (id: string, err: unknown) => void } = {},
): Promise<KeepAliveResult> {
  const lead = options.leadMinutes ?? KEEPALIVE_LEAD_MINUTES;
  const limit = options.limit ?? KEEPALIVE_MAX_PER_RUN;
  const { rows } = await db.query<{ id: string }>(
    `select id from x_accounts
      where status = 'active'
        and refresh_token_ciphertext is not null
        and (token_expires_at is null or token_expires_at <= now() + ($1 || ' minutes')::interval)
      order by token_expires_at asc nulls first
      limit $2`,
    [String(lead), limit],
  );

  const result: KeepAliveResult = { targeted: rows.length, refreshed: 0, failed: 0 };
  for (const row of rows) {
    try {
      await refresh(row.id);
      result.refreshed += 1;
      // 1件の失敗で他のアカウントを巻き添えにしない（件数だけ数えて次へ進む）
    } catch (err) {
      result.failed += 1;
      options.onError?.(row.id, err);
    }
  }
  return result;
}
