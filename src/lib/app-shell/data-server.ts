import "server-only";

import { getXApiKeyStatusForUser } from "@/lib/app-banners-server";
import { LEGAL_CONSENT_SELECT_POOLED } from "@/lib/auth/legal-consent";
import { getPool } from "@/lib/db/pool";
import { env } from "@/lib/env";
import {
  countUnreadNotificationsForUser,
  listNotificationsForUser,
} from "@/lib/notifications-server";
import { loadTodaysPostCount } from "@/lib/usage/daily-post-limit-server";
import { loadUsageSummaryForUser } from "@/lib/usage/usage-summary-server";
import {
  listXAccounts,
  resolveActiveXAccountForUser,
} from "@/lib/x/account-actions-server";

import {
  loadAppShellDataWithDependencies,
  type AppShellProfileRow,
} from "./data";

/**
 * profile行を1本読む。**行が無い（null）と取得の失敗を混同しない**（CLAUDE.md 原則1・T-M8-158）。
 *
 * 以前はここだけ Supabase client の `maybeSingle()` を使っており、supabase-js は
 * `.throwOnError()` が無い限り失敗も `{data:null,error}` で resolve するため、
 * **取得失敗が「profile未作成」と同じ null に潰れていた**。App Shellは失敗を null として受け取り、
 * 契約更新の督促・利用枠超過・X連携切れ・再同意のバナーが**全部黙って消えた**画面になる。
 *
 * 同じ波で読む他の5件（通知・Xアカウント・キーstatus・利用量）はすべて `getPool()` 経由で
 * **失敗時に throw する**ので、ここだけが沈黙する側だった。pooled queryへ寄せて挙動を揃える。
 * `_at` 系は timestamptz を文字列で受けるため `::text` を付ける（`LEGAL_CONSENT_SELECT_POOLED` と同じ理由）。
 */
async function loadProfileRow(userId: string): Promise<AppShellProfileRow | null> {
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
}

/** Connects the App Shell core to the production DB and server adapters. */
export function loadAppShellData(userId: string) {
  return loadAppShellDataWithDependencies(userId, {
    countUnreadNotifications: countUnreadNotificationsForUser,
    dailyPostLimit: env.X_DAILY_POST_LIMIT,
    getXApiKeyStatus: getXApiKeyStatusForUser,
    listNotifications: listNotificationsForUser,
    listXAccounts,
    loadProfile: loadProfileRow,
    loadTodaysPostCount,
    loadUsageSummary: loadUsageSummaryForUser,
    resolveActiveXAccount: resolveActiveXAccountForUser,
  });
}
