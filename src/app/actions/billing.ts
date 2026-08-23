"use server";

import { revalidatePath } from "next/cache";

import { type BaseResult, errorResult, requireUserId } from "./_helpers";
import { pooledQueryable } from "@/lib/db/pool";
import { stripe } from "@/lib/stripe/client";
import { cancelScheduledPlanChange } from "@/lib/stripe/scheduled-plan-change";

/**
 * 予約済みの下位プラン変更を取り消す（T-M8-260）。
 *
 * Portalで下位プランを選ぶと期間末の予約（subscription schedule）になり、予約が付いた契約は
 * Portalで再変更できない。「やっぱり今のプランのまま続ける」を利用者自身で完結させる。
 */
export async function cancelScheduledPlanChangeAction(): Promise<BaseResult> {
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const outcome = await cancelScheduledPlanChange(pooledQueryable(), stripe, auth.userId);
    revalidatePath("/app", "layout");
    return {
      status: "success",
      message:
        outcome === "released"
          ? "プラン変更の予約を取り消しました。現在のプランのまま続きます。"
          : "取り消せる予約はありませんでした。表示を最新にしました。",
    };
  } catch (error) {
    return errorResult(error);
  }
}
