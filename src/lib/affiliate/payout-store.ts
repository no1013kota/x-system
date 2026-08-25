import { MIN_PAYOUT_JPY, PAYOUT_FEE_JPY } from "./config";
import { recalcCreatedPayout, settleMatureCommissions } from "./store";

import type { AffiliateDb } from "./db";

/**
 * 月次Payout（invite_cp.md §9〜§14）。月末締め・翌月末支払・手数料980円・最低5,000円。
 * Commissionと手数料は会計分離（gross/fee/netを別カラムで保存し、Commission自体は減額しない）。
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 前月（JST）の締め期間と支払期限。now が 9/2 なら period=8/1〜8/31・支払期限=9/30。 */
export function payoutPeriodFor(nowIso: string): {
  periodStart: string; // YYYY-MM-DD（JST）
  periodEnd: string;
  paymentDueIso: string; // 翌月末（当月末日 23:59:59 JST）
  windowKey: string; // 冪等キー（YYYY-MM = 締め対象の月）
} {
  const jst = new Date(new Date(nowIso).getTime() + JST_OFFSET_MS);
  const year = jst.getUTCFullYear();
  const month = jst.getUTCMonth(); // 今月（0-based・JST）
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0)); // 前月末日
  const due = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59) - JST_OFFSET_MS);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  return {
    periodStart: day(start),
    periodEnd: day(end),
    paymentDueIso: due.toISOString(),
    windowKey: day(start).slice(0, 7),
  };
}

export interface MonthlyPayoutResult {
  settled: number;
  created: number;
  skippedBelowMinimum: number;
  skippedNoBankAccount: number;
}

/**
 * 月末締めバッチ（月初のtickが1回だけ呼ぶ・cron_runsで冪等）。
 * payable かつ未束ねのCommissionをAffiliateごとに集計し、
 * ¥5,000以上＋銀行口座ありのAffiliateへPayoutを作って束ねる。
 */
export async function createMonthlyPayouts(
  db: AffiliateDb,
  nowIso: string,
): Promise<MonthlyPayoutResult> {
  const settled = await settleMatureCommissions(db);
  const { periodStart, periodEnd, paymentDueIso } = payoutPeriodFor(nowIso);

  const candidates = await db.query<{
    affiliate_account_id: string;
    gross: string;
    has_bank: boolean;
  }>(
    `select c.affiliate_account_id,
            sum(c.commission_amount)::text as gross,
            exists (
              select 1 from affiliate_payout_accounts p
               where p.affiliate_account_id = c.affiliate_account_id
                 and p.status = 'active'
            ) as has_bank
       from affiliate_commissions c
      where c.status = 'payable' and c.payout_id is null
      group by c.affiliate_account_id`,
  );

  const result: MonthlyPayoutResult = {
    settled,
    created: 0,
    skippedBelowMinimum: 0,
    skippedNoBankAccount: 0,
  };
  for (const row of candidates.rows) {
    const gross = Number(row.gross);
    // 判定は手数料控除前（invite_cp.md §11）。未満は翌月へ繰越（何もしない）。
    if (gross < MIN_PAYOUT_JPY) {
      result.skippedBelowMinimum += 1;
      continue;
    }
    if (!row.has_bank) {
      result.skippedNoBankAccount += 1;
      continue;
    }
    const inserted = await db.query<{ id: string }>(
      `insert into affiliate_payouts
         (affiliate_account_id, period_start, period_end,
          gross_amount, fee_amount, net_amount, payment_due_at)
       values ($1, $2::date, $3::date, $4, $5, $6, $7::timestamptz)
       on conflict (affiliate_account_id, period_start) do nothing
       returning id`,
      [
        row.affiliate_account_id,
        periodStart,
        periodEnd,
        gross,
        PAYOUT_FEE_JPY,
        gross - PAYOUT_FEE_JPY,
        paymentDueIso,
      ],
    );
    const payoutId = inserted.rows[0]?.id;
    if (!payoutId) continue; // 同月ぶんは作成済み（再実行）
    await db.query(
      `update affiliate_commissions
          set payout_id = $2
        where affiliate_account_id = $1 and status = 'payable' and payout_id is null`,
      [row.affiliate_account_id, payoutId],
    );
    // 集計SELECTと束ねUPDATEの間にRefundが入る競合を塞ぐ: 実際に束ねた行から金額を引き直す
    // （レビュー修正。ずれていなければ同値更新で終わる）。
    await recalcCreatedPayout(db, payoutId);
    result.created += 1;
  }
  return result;
}

/** 運営者が振込を完了したら呼ぶ（scripts/affiliate-payouts.mjs）。束ねたCommissionをpaidへ。 */
export async function markPayoutPaid(
  db: AffiliateDb,
  payoutId: string,
  externalReference?: string,
): Promise<boolean> {
  // 支払記録の直前に金額を実態と突き合わせる（Refundで束ねが減っていたら引き直し、
  // 手取り0以下ならPayoutごと取消してfalseを返す・レビュー修正）。
  await recalcCreatedPayout(db, payoutId);
  const updated = await db.query(
    `update affiliate_payouts
        set status = 'paid', paid_at = now(),
            external_reference = coalesce($2, external_reference), updated_at = now()
      where id = $1 and status = 'created'`,
    [payoutId, externalReference ?? null],
  );
  if ((updated.rowCount ?? 0) === 0) return false;
  await db.query(
    `update affiliate_commissions set status = 'paid' where payout_id = $1`,
    [payoutId],
  );
  return true;
}
