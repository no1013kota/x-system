import "server-only";

import { cache } from "react";

import { pooledQueryable } from "@/lib/db/pool";

import { requiresPlanSelection } from "./subscription-access";

/**
 * 画面をロックするか（T-M8-269・運営者の指示 2026-08-23）。
 *
 * **プランを登録するまでは機能画面を開けない。** 触れるのは友達招待（契約不要）と
 * 設定＞課金・プラン（登録・再開の入口）だけで、それ以外は「先にプランを登録してください」を
 * その場に出す。判定の正本は `requiresPlanSelection`（`SUBSCRIPTION_ACCESS` から導出）。
 *
 * `cache()` で**同一リクエスト内では1回だけ**読む（複数のServer Componentが呼んでも往復は増えない）。
 * 読めなかったときはロック側へ倒す——プランがあるのに閉じてしまう方は課金・プランタブから
 * 復帰できるが、逆（無いのに開く）は費用の出る操作へ通してしまう。
 */
export const isPlanRequired = cache(async (userId: string): Promise<boolean> => {
  const { rows } = await pooledQueryable().query<{ subscription_status: string }>(
    `select subscription_status::text as subscription_status from profiles where id = $1`,
    [userId],
  );
  const status = rows[0]?.subscription_status;
  return status === undefined ? true : requiresPlanSelection(status);
});
