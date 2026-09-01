"use server";

import { after } from "next/server";

import { type BaseResult, errorResult, requireUserId } from "./_helpers";
import { pooledQueryable } from "@/lib/db/pool";
import { dispatchJob } from "@/lib/jobs/dispatch";
import {
  createManualSuggestionJob,
  type ManualSuggestionRejection,
} from "@/lib/jobs/suggestion-jobs";
import { resolveActiveXAccountForUser } from "@/lib/x/account-actions-server";

/**
 * 「分析を開始」の Server Action（K-2, 要件05 §9, T-M8-255）。本人のみ。
 *
 * 投稿分析（SUGGEST）を起票する（1日1回・冪等キーが上限を兼ねる）。
 * ゲート（所有・active・契約・BYOKキー）は中核（suggestion-jobs.ts）が判定する。
 *
 * **フォロワー数はここでは記録しない**（T-M8-403・運営者の指示 2026-09-01「フォロワー数は
 * cronのみで良い」）。T-M8-257までは押した時点の最新値で当日分を上書きしていたが、
 * 記録の入口は毎時cron `follower_snapshot` の1つにする——ボタン1つに2つの意味を
 * 持たせない（何が起きたかを利用者が数えなくて済む）。
 */

const pooledDb = pooledQueryable();

/** 起票できなかった理由 → 利用者向けの文言（押した結果を必ず言葉で返す・原則1）。 */
const REJECTION_MESSAGES: Record<ManualSuggestionRejection, string> = {
  already_done_today: "本日の分析は実行済みです。分析は1日1回までです。",
  already_running: "分析を実行中です。完了するとこの画面に結果が表示されます。",
  api_key_required:
    "分析にはAIのAPIキーが必要です。設定のAPIキーから登録してください。",
  not_found: "操作中のXアカウントが見つかりません。ページを再読み込みしてください。",
  subscription_inactive: "プランが有効でないため分析を開始できません。",
  x_account_inactive: "このXアカウントは停止中のため分析を開始できません。",
};

export async function startAnalysisAction(): Promise<BaseResult & { jobId?: string }> {
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const xAccountId = await resolveActiveXAccountForUser(auth.userId);
    if (!xAccountId) return { message: REJECTION_MESSAGES.not_found, status: "error" };

    const res = await createManualSuggestionJob(pooledDb, {
      nowIso: new Date().toISOString(),
      userId: auth.userId,
      xAccountId,
    });

    if (!res.ok) {
      const message = REJECTION_MESSAGES[res.reason!];
      // 「今日はもう済み」はエラーではなく現状の説明として返す。
      if (res.reason === "already_done_today" || res.reason === "already_running") {
        return { message, status: "success" };
      }
      return { message, status: "error" };
    }

    after(() => dispatchJob(res.jobId!));
    return {
      jobId: res.jobId,
      message: "分析を開始しました。完了するとこの画面にレポートが表示されます。",
      status: "success",
    };
  } catch (error) {
    return errorResult(error);
  }
}
