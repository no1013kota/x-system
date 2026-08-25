import "server-only";

import { getPool } from "./db/pool";
import type { ExecutionPrereqInput } from "./execution-prereqs";
import type { PlanId } from "./plans";

/** 文章生成・リサーチに使えるprovider（AIモデル設定 text の選択肢）。 */
const TEXT_CAPABLE_PROVIDERS = ["anthropic", "openai", "google"] as const;

/**
 * 実行前提の判定入力をDBから収集する（要件06 §3.2, T-M2-23）。生成・投稿・スケジュール・学習の
 * Actionと初期設定ガイド（SC-05）が共用する。文章/画像AIキーの有効性は ai_purpose_config の割当
 * providerのキーstatusで判定する。アカウント設定は選択中Xアカウントの base_md_version で判定する。
 */
export async function gatherExecutionPrereqInputs(
  userId: string,
  opts: {
    imageRequested?: boolean;
    /**
     * 判定対象のXアカウント（T-M8-196）。**ジョブ実行時は必ずジョブのx_account_idを渡す**——
     * 省略時のactive基準だと、別アカウントを表示中（設定中・失効中）なだけで
     * 健全なアカウントのスケジュール生成が terminally fail していた（実DBで再現）。
     */
    xAccountId?: string;
  } = {},
): Promise<ExecutionPrereqInput | null> {
  const pool = getPool();
  const prof = (
    await pool.query<{
      plan: PlanId | null;
      subscription_status: string;
      ai_purpose_config: { text?: string | null; image?: string | null } | null;
      active_x_account_id: string | null;
      trial_ends_at: string | null;
      current_period_end: string | null;
    }>(
      // 期限（trial_ends_at / current_period_end）も読む。status が `trialing`/`active` のまま
      // 期限切れなら「契約の反映が届いていない」として実行を止める（T-M8-235）。
      `select plan, subscription_status, ai_purpose_config, active_x_account_id,
              trial_ends_at::text as trial_ends_at, current_period_end::text as current_period_end
         from profiles where id = $1`,
      [userId],
    )
  ).rows[0];
  if (!prof?.plan) return null;

  const ai = prof.ai_purpose_config ?? {};
  const keyRows = (
    await pool.query<{ provider: string; status: string }>(
      `select provider, status from user_api_keys where user_id = $1`,
      [userId],
    )
  ).rows;
  const keyStatus: Record<string, string> = {};
  for (const row of keyRows) keyStatus[row.provider] = row.status;

  let hasActiveXAccount = false;
  let baseMdVersion = 0;
  const targetAccountId = opts.xAccountId ?? prof.active_x_account_id;
  if (targetAccountId) {
    const acct = (
      await pool.query<{ base_md_version: number }>(
        `select base_md_version from x_accounts
          where id = $1 and user_id = $2 and status = 'active'`,
        [targetAccountId, userId],
      )
    ).rows[0];
    if (acct) {
      hasActiveXAccount = true;
      baseMdVersion = acct.base_md_version;
    }
  }

  return {
    plan: prof.plan,
    subscriptionStatus: prof.subscription_status,
    xApiKeyStatus: keyStatus["x"] ?? null,
    hasActiveXAccount,
    textAiKeyValid: !!ai.text && keyStatus[ai.text] === "valid",
    textProviderAssigned: !!ai.text,
    // 文章生成に使えるAIキー（anthropic/openai/google）が1つでもvalidか。キーはあるのに
    // 用途未割り当て、というケースだけ割り当て画面へ誘導するために使う。
    hasValidTextCapableKey: TEXT_CAPABLE_PROVIDERS.some(
      (provider) => keyStatus[provider] === "valid",
    ),
    imageRequested: opts.imageRequested ?? false,
    imageAiKeyValid: !!ai.image && keyStatus[ai.image] === "valid",
    baseMdVersion,
    // 契約期間の期限（T-M8-235）。status だけでは webhook 未達を見抜けない。
    trialEndsAt: prof.trial_ends_at,
    currentPeriodEnd: prof.current_period_end,
  };
}
