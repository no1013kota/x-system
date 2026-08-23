"use server";

import { revalidatePath } from "next/cache";

import { type BaseResult, errorResult, requireUserId } from "./_helpers";
import { pooledQueryable } from "@/lib/db/pool";
import { stripe } from "@/lib/stripe/client";
import { saveCancellationSurvey } from "@/lib/billing/cancellation-survey";
import { cancelTrialNow } from "@/lib/stripe/cancel-now";
import { cancelScheduledCancellation } from "@/lib/stripe/scheduled-cancellation";
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

/**
 * 解約予定の取り消し（T-M8-271・運営者の指示 2026-08-23）。
 *
 * 以前は Stripe の Portal トップを開いて「プランを続ける」を押させていたが、**その場で終わらせる**。
 * 解約済みの契約の再開は別経路（課金タブの「プランを再開」・T-M8-264）。
 */
export async function keepSubscriptionAction(): Promise<BaseResult> {
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const outcome = await cancelScheduledCancellation(pooledQueryable(), stripe, auth.userId);
    revalidatePath("/app", "layout");
    return {
      status: "success",
      message:
        outcome === "resumed"
          ? "解約予定を取り消しました。今までどおりご利用いただけます。"
          : "取り消せる解約予定はありませんでした。表示を最新にしました。",
    };
  } catch (error) {
    return errorResult(error);
  }
}

/**
 * 解約アンケートの記録（T-M8-277）。確認画面で理由を選んだ時点で呼ぶ。
 * **失敗しても解約の導線は止めない**——記録できないことより、利用者が手続きを進められることを優先する
 * （呼び出し側は結果を待つが、error でも画面は次へ進む）。
 */
export async function recordCancellationSurveyAction(input: {
  reason: string;
  detail?: string | null;
  proceeded: boolean;
}): Promise<BaseResult> {
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    await saveCancellationSurvey(pooledQueryable(), auth.userId, input);
    return { status: "success", message: "ご回答ありがとうございました。" };
  } catch (error) {
    return errorResult(error);
  }
}

/**
 * 無料トライアル中の解約（T-M8-278・運営者の指示 2026-08-23）。**その場で終了**させる。
 * 有料契約はPortalの期間末解約なので、この経路は trialing のときだけ画面に出す。
 * 残りのトライアル期間は `profiles.trial_ends_at` に残り、「トライアルを再開する」で戻せる。
 */
export async function cancelTrialNowAction(): Promise<BaseResult> {
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const result = await cancelTrialNow(pooledQueryable(), stripe, auth.userId);
    revalidatePath("/app", "layout");
    return {
      status: "success",
      message: result.trialEndsAt
        ? "無料トライアルを終了しました。期限内なら残りの期間で再開できます。"
        : "無料トライアルを終了しました。",
    };
  } catch (error) {
    return errorResult(error);
  }
}
