import "server-only";

import { getPool } from "@/lib/db/pool";
import { env } from "@/lib/env";
import { isOperatorManagedPlan } from "@/lib/plans";

/**
 * 画像に使えるBYOKキーの取得（T-M8-253）。**SQLもここへ置く**——投稿作成と予約の
 * 2ページへ逐語コピーされており、条件（provider/status）を変えるときに片方だけ直す形だった。
 * plan取得と並列に走らせられるよう、Promiseを返すだけにして await はしない。
 */
export function imageKeyRowsQuery(userId: string) {
  return getPool().query<{ provider: string }>(
    `select provider from user_api_keys
      where user_id = $1 and provider in ('openai','google') and status = 'valid'`,
    [userId],
  );
}

/**
 * 画像生成に使えるproviderの一覧（T-M8-180で posts/schedule ページの重複定義を集約）。
 * BYOKは valid な openai/google キー、運営キー系（premium/expert）は運営キー＋
 * 画像モデルが設定済みのproviderを返す。実行側の解決（resolve-provider.ts）と
 * 同じ判定基準（isOperatorManagedPlan・env）を使う——別々に書くと
 * 「画面では選べないのに実行はできる」食い違いが起きる（T-M8-168のレビューで実際に起きた）。
 */
export function imageProvidersFor(
  plan: string | null,
  keyRows: { provider: string }[],
): string[] {
  if (isOperatorManagedPlan(plan)) {
    const providers: string[] = [];
    if (env.OPENAI_API_KEY && env.OPENAI_IMAGE_MODEL) providers.push("openai");
    if (env.GEMINI_API_KEY && env.GEMINI_IMAGE_MODEL) providers.push("google");
    return providers;
  }
  return keyRows.map((row) => row.provider);
}
