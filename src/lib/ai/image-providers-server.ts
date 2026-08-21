import "server-only";

import { env } from "@/lib/env";
import { isOperatorManagedPlan } from "@/lib/plans";

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
