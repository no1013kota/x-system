import "server-only";

import { createMonthlyPayouts, payoutPeriodFor } from "./payout-store";
import { settleMatureCommissions } from "./store";

import type { AffiliateDb } from "./db";

/**
 * 招待報酬の定時処理（T-M8-174）。scheduler_tick に相乗りし、cron_runs で冪等にする。
 * **claimと本処理は同一トランザクション**（claimTx）——本処理が失敗したらclaimごと
 * ロールバックされ、次のtickが再試行する（レビュー修正。claim先行だと1回の失敗で
 * その月のPayout作成が翌月まで飛んでいた）。
 * - 毎日: 確認期間（30日）を過ぎた報酬を pending → payable へ
 * - 毎月: 前月締めのPayoutを作成（月末締め・翌月末支払・invite_cp.md §9〜§14）
 */
export async function runAffiliateBatch(deps: {
  nowIso: string;
  claimTx: <T>(windowKey: string, work: (db: AffiliateDb) => Promise<T>) => Promise<T | null>;
}): Promise<{ settled: number; payoutsCreated: number }> {
  const jstDay = new Date(new Date(deps.nowIso).getTime() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const settled = await deps.claimTx(`settle:${jstDay}`, (db) => settleMatureCommissions(db));
  const { windowKey } = payoutPeriodFor(deps.nowIso);
  const payouts = await deps.claimTx(`payout:${windowKey}`, (db) =>
    createMonthlyPayouts(db, deps.nowIso),
  );
  return { settled: settled ?? 0, payoutsCreated: payouts?.created ?? 0 };
}
