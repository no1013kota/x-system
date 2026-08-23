"use server";

import { after } from "next/server";

import { type BaseResult, errorResult, requireUserId } from "./_helpers";
import { pooledQueryable } from "@/lib/db/pool";
import { dispatchJob } from "@/lib/jobs/dispatch";
import { snapshotFollowerTodayForAccount } from "@/lib/jobs/follower-snapshot-server";
import {
  createManualSuggestionJob,
  type ManualSuggestionRejection,
} from "@/lib/jobs/suggestion-jobs";
import { recordUnexpectedError } from "@/lib/observability/sentry";
import { resolveActiveXAccountForUser } from "@/lib/x/account-actions-server";

/**
 * 「分析を開始」の Server Action（K-2/K-3, 要件05 §9, T-M8-255）。本人のみ。
 *
 * 1つのボタンで2つを行う:
 * 1. フォロワー数の当日分を記録する（K-3。X APIに履歴は無く、過去日は遡れない）
 * 2. 投稿分析（SUGGEST）を起票する（K-2。1日1回・冪等キーが上限を兼ねる）
 *
 * ゲート（所有・active・契約・BYOKキー）は中核（suggestion-jobs.ts）が判定する。
 * フォロワー記録は**ゲートを通ったときだけ**行う——契約が無効な利用者の操作で
 * X読取費用（$0.010/件）を発生させない。記録の失敗は分析を止めない（別系統の値のため）。
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

export async function startAnalysisAction(): Promise<
  BaseResult & { jobId?: string; followerRecorded?: boolean }
> {
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

    // 既に実行済み/実行中でもゲートは通っている＝フォロワー記録だけは更新する
    // （同日中の再押下は上書き・原価台帳はJST日付キーでdedup）。
    let followerRecorded = false;
    if (res.ok || res.reason === "already_running" || res.reason === "already_done_today") {
      try {
        const snap = await snapshotFollowerTodayForAccount(xAccountId, auth.userId);
        followerRecorded = snap.written;
      } catch (error) {
        // 記録失敗で分析まで止めない。ただし黙らず記録する（原則1）。
        recordUnexpectedError(error, { at: "startAnalysisAction:follower", xAccountId });
      }
    }

    if (!res.ok) {
      const message = REJECTION_MESSAGES[res.reason!];
      // 「今日はもう済み」はエラーではなく現状の説明として返す。
      if (res.reason === "already_done_today" || res.reason === "already_running") {
        return { followerRecorded, message, status: "success" };
      }
      return { followerRecorded, message, status: "error" };
    }

    after(() => dispatchJob(res.jobId!));
    return {
      followerRecorded,
      jobId: res.jobId,
      message: followerRecorded
        ? "分析を開始しました。フォロワー数も本日分として記録しました。"
        : "分析を開始しました。フォロワー数は記録できませんでした（X連携を確認してください）。",
      status: "success",
    };
  } catch (error) {
    return errorResult(error);
  }
}
