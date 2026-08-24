import "server-only";

import { cache } from "react";

import { LEGAL_CONSENT_SELECT_POOLED } from "@/lib/auth/legal-consent";
import { getPool } from "@/lib/db/pool";
import type { AppShellProfileRow } from "@/lib/app-shell/data";

/**
 * **1リクエストにつき1回だけ読む profile 行**（T-M8-286）。
 *
 * 以前は同じ行を1遷移で複数回 SELECT していた——App Shell（契約バナー・再同意）、
 * ロック判定（`loadAppLock`）、ホームのプラン取得が、それぞれ別のクエリを投げていた。
 * 行は同じなので、**読む場所を1つにして React `cache()` で共有する**（往復が減り、
 * 「profileのどの列を誰が使うか」も1か所に集まる）。
 *
 * **行が無い（null）と取得の失敗を混同しない**（原則1・T-M8-158）。`getPool()` 経由なので
 * 失敗は throw し、null は「profile未作成」だけを意味する。
 *
 * 列を足すときはここへ足す。**呼び出しごとに列を絞った別クエリを書かない**——往復が増え、
 * どこが何を読んでいるか分からなくなる（この関数が生まれた理由そのもの）。
 */
export const loadRequestProfile = cache(
  async (userId: string): Promise<AppShellProfileRow | null> => {
    const { rows } = await getPool().query<AppShellProfileRow>(
      `select plan,
              subscription_status,
              trial_ends_at::text as trial_ends_at,
              -- 解約予約を画面へ出すために読む（T-M8-253）。
              cancel_at_period_end,
              current_period_end::text as current_period_end,
              -- 下位プランへの予約を画面へ出すために読む（T-M8-260）。
              scheduled_plan,
              scheduled_plan_at::text as scheduled_plan_at,
              stripe_customer_id,
              ${LEGAL_CONSENT_SELECT_POOLED}
         from profiles where id = $1`,
      [userId],
    );
    return rows[0] ?? null;
  },
);
