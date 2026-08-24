import "server-only";

import { cache } from "react";

import { loadRequestProfile } from "@/lib/profile/request-profile-server";

import { appLockFor, type AppLockReason } from "./subscription-access";

/**
 * 機能画面をロックするか、するなら理由は何か（T-M8-269→T-M8-273・運営者の指示 2026-08-23）。
 *
 * **実行できない状態では機能画面を開けない。** 触れるのは友達招待（契約不要）と
 * 設定＞課金・プラン（登録・再開・支払い更新の入口）だけで、それ以外は「先にプランを
 * 登録してください」／「お支払い情報を更新してください」をその場に出す。
 * 判定の正本は `appLockFor`（`SUBSCRIPTION_ACCESS` から導出）。
 *
 * `cache()` で**同一リクエスト内では1回だけ**読む（複数のServer Componentが呼んでも往復は増えない）。
 * 読めなかったときはロック側へ倒す——プランがあるのに閉じてしまう方は課金・プランタブから
 * 復帰できるが、逆（無いのに開く）は費用の出る操作へ通してしまう。
 */
export const loadAppLock = cache(async (userId: string): Promise<AppLockReason | null> => {
  // profile は App Shell と同じ行なので**リクエスト内で共有する**（T-M8-286。
  // 専用クエリを持つと、同じ行のために遷移のたび往復が1本増える）。
  const profile = await loadRequestProfile(userId);
  return profile === null ? "plan_required" : appLockFor(profile.subscription_status);
});
