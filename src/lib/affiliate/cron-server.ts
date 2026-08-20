import "server-only";

import { createMonthlyPayouts, payoutPeriodFor } from "./payout-store";
import { settleMatureCommissions } from "./store";

import type { AffiliateDb } from "./db";

/**
 * 招待報酬の定時処理（T-M8-174）。scheduler_tick に相乗りし、cron_runs で冪等にする。
 * - 毎日: 確認期間（30日）を過ぎた報酬を pending → payable へ
 * - 毎月: 前月締めのPayoutを作成（月末締め・翌月末支払・invite_cp.md §9〜§14）
 */
export async function runAffiliateBatch(deps: {
  db: AffiliateDb;
  nowIso: string;
  claim: (windowKey: string) => Promise<boolean>;
}): Promise<{ settled: number; payoutsCreated: number }> {
  const jstDay = new Date(new Date(deps.nowIso).getTime() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  let settled = 0;
  if (await deps.claim(`settle:${jstDay}`)) {
    settled = await settleMatureCommissions(deps.db);
  }
  let payoutsCreated = 0;
  const { windowKey } = payoutPeriodFor(deps.nowIso);
  if (await deps.claim(`payout:${windowKey}`)) {
    payoutsCreated = (await createMonthlyPayouts(deps.db, deps.nowIso)).created;
  }
  return { settled, payoutsCreated };
}
