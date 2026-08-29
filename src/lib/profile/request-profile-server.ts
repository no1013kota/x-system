import "server-only";

import { cache } from "react";

import { LEGAL_CONSENT_SELECT_POOLED } from "@/lib/auth/legal-consent";
import { getPool } from "@/lib/db/pool";
import type { AppShellProfileRow } from "@/lib/app-shell/data";
import { usagePeriodKeyExpr, usageResetsAtExpr } from "@/lib/usage/usage-period";
import type { UsageCounters } from "@/lib/usage/usage-summary";

/**
 * **1リクエストにつき1回だけ読む、利用者まわりの1行**（T-M8-286→T-M8-288）。
 *
 * 以前は同じ profiles 行を1遷移で何度も別々に SELECT していた——App Shell（契約バナー・再同意・
 * 利用枠・Xキー状態・通知の未読数）、ロック判定、ホーム、設定が、それぞれクエリを投げていた。
 * どれも **user_id 一本で決まる単一行・スカラー**なので、1文にまとめて React `cache()` で共有する。
 *
 * これで App Shell の往復は 8 → 5（利用枠と未読数とキー状態が消える）。ホーム・設定が重ねて
 * 呼んでいた利用枠の取得も同じ行から供給されるので、画面ごとにさらに1本ずつ減る。
 *
 * 束ねてよい根拠（行が増えない）:
 * - `user_api_keys` は `unique (user_id, provider)` なのでスカラーサブクエリは高々1行
 * - `usage_counters` は `primary key (user_id, month)` なので `left join` が行を増やさない
 *
 * **行が無い（null）と取得の失敗を混同しない**（原則1・T-M8-158）。`getPool()` 経由なので
 * 失敗は throw し、null は「profile未作成」だけを意味する。1文にしたことで、
 * 「一部だけ失敗して黙って既定値になる」形も無くなった。
 *
 * 列を足すときはここへ足す。**呼び出しごとに列を絞った別クエリを書かない**——往復が増え、
 * どこが何を読んでいるか分からなくなる（この関数が生まれた理由そのもの）。
 */
export interface RequestProfileBundle extends AppShellProfileRow, UsageCounters {
  /**
   * いま選んでいるXアカウント（T-M8-355）。**この1行へ足す**——以前はこの列が無いために
   * プロンプト画面が profiles をもう一度（PostgREST経由で）読んでいた。
   * 往復が1つ増えるうえ、同じ行を2か所から別々に読む形はこの関数が生まれた理由そのもの。
   */
  active_x_account_id: string | null;
  /**
   * 設定画面が要る列（T-M8-361）。**同じ行をPostgREST経由でもう一度読んでいた**——
   * App Shellがすでにpooled接続で読んでいる行なので、往復が1つ丸ごと無駄だった
   * （実測で最も遅い画面が設定タブだった）。
   */
  email: string | null;
  ai_purpose_config: unknown;
  stripe_subscription_id: string | null;
  discount_percent_off: number | null;
  discount_amount_off_jpy: number | null;
  discount_ends_at: string | null;
  /** Xの開発者キーの登録状態（未登録は null）。 */
  x_api_key_status: string | null;
  /** アプリ内通知の未読数。 */
  unread_count: number;
  /** 利用枠がリセットされる日時（期間が未同期なら null）。 */
  usage_resets_at: string | null;
}

export const loadRequestProfile = cache(
  async (userId: string): Promise<RequestProfileBundle | null> => {
    const { rows } = await getPool().query<RequestProfileBundle>(
      `select p.plan,
              p.active_x_account_id,
              p.email,
              p.ai_purpose_config,
              p.stripe_subscription_id,
              p.discount_percent_off,
              p.discount_amount_off_jpy,
              p.discount_ends_at::text as discount_ends_at,
              p.subscription_status,
              p.trial_ends_at::text as trial_ends_at,
              -- 解約予約を画面へ出すために読む（T-M8-253）。
              p.cancel_at_period_end,
              p.current_period_end::text as current_period_end,
              -- 下位プランへの予約を画面へ出すために読む（T-M8-260）。
              p.scheduled_plan,
              p.scheduled_plan_at::text as scheduled_plan_at,
              p.stripe_customer_id,
              ${LEGAL_CONSENT_SELECT_POOLED}
              ,
              (select k.status from user_api_keys k
                where k.user_id = p.id and k.provider = 'x') as x_api_key_status,
              (select count(*)::int from notifications n
                where n.user_id = p.id and n.in_app_enabled = true and n.read_at is null)
                as unread_count,
              coalesce(c.normal_posts_count, 0) as normal_posts_count,
              coalesce(c.url_posts_count, 0) as url_posts_count,
              coalesce(c.ai_credits_used, 0) as ai_credits_used,
              -- リセット日は期間が同期済みのときだけ（未同期は暦月で数えている）。
              ${usageResetsAtExpr("p")}::text as usage_resets_at
         from profiles p
         left join usage_counters c
           on c.user_id = p.id and c.month = ${usagePeriodKeyExpr("p")}
        where p.id = $1`,
      [userId],
    );
    return rows[0] ?? null;
  },
);
