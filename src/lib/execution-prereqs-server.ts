import "server-only";

import { getPool } from "./db/pool";
import type { ExecutionPrereqInput } from "./execution-prereqs";
import type { PlanId } from "./plans";

/** 文章生成・リサーチに使えるprovider（AI用途 text の選択肢）。 */
const TEXT_CAPABLE_PROVIDERS = ["anthropic", "openai", "google"] as const;

/**
 * 実行前提の判定入力をDBから収集する（要件06 §3.2, T-M2-23）。生成・投稿・スケジュール・学習の
 * Actionと初期設定ガイド（SC-05）が共用する。文章/画像AIキーの有効性は ai_purpose_config の割当
 * providerのキーstatusで判定する。アカウント設定は選択中Xアカウントの base_md_version で判定する。
 */
export async function gatherExecutionPrereqInputs(
  userId: string,
  opts: { imageRequested?: boolean } = {},
): Promise<ExecutionPrereqInput | null> {
  const pool = getPool();
  const prof = (
    await pool.query<{
      plan: PlanId | null;
      subscription_status: string;
      ai_purpose_config: { text?: string | null; image?: string | null } | null;
      active_x_account_id: string | null;
    }>(
      `select plan, subscription_status, ai_purpose_config, active_x_account_id
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
  if (prof.active_x_account_id) {
    const acct = (
      await pool.query<{ base_md_version: number }>(
        `select base_md_version from x_accounts
          where id = $1 and user_id = $2 and status = 'active'`,
        [prof.active_x_account_id, userId],
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
  };
}
