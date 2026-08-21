import "server-only";

import { maskEmail, tierProgress, type TierProgress } from "./config";
import { ensureAffiliateAccount, type AffiliateAccount } from "./store";

import { pooledQueryable } from "@/lib/db/pool";

/**
 * 招待ページ（/app/invite）の表示データを1回で集める（T-M8-174・invite_cp.md §2）。
 * 金額は integer 円。メールアドレスはマスクして返す（個人情報を画面へ出さない）。
 */

export interface InviteSummary {
  account: AffiliateAccount;
  /** 累計有料招待ユーザー数（reversedだけの利用者は数えない）。 */
  paidReferralCount: number;
  tier: TierProgress;
  /** 確定前（pending）の報酬合計。 */
  pendingAmount: number;
  /**
   * 受取可能の報酬合計。**振込予定に束ねられた分も含む**（運営者の指示 2026-08-21:
   * 翌月末の振込が完了した時点で0になり、報酬履歴に「支払済み」で並ぶ。月初の締めでは減らさない）。
   */
  payableAmount: number;
  /** 次回振込（作成済みで未払いのPayout）。 */
  nextPayout: {
    id: string;
    grossAmount: number;
    feeAmount: number;
    netAmount: number;
    paymentDueAt: string;
  } | null;
  bankAccount: {
    bankName: string;
    branchName: string;
    accountType: string;
    last4: string;
    holderName: string;
  } | null;
  invitedUsers: {
    maskedEmail: string;
    status: "trial" | "paid" | "cancelled" | "free";
    firstPaidAt: string | null;
    totalCommission: number;
  }[];
  history: {
    date: string;
    label: string;
    status: string;
    amount: number;
  }[];
}

export async function loadInviteSummary(userId: string): Promise<InviteSummary> {
  const db = pooledQueryable();
  const account = await ensureAffiliateAccount(db, userId);

  const [totals, payout, bank, invited, history] = await Promise.all([
    db.query<{ paid_users: string; pending: string; payable: string }>(
      `select count(distinct referred_user_id)
                filter (where status <> 'reversed')::text as paid_users,
              coalesce(sum(commission_amount) filter (where status = 'pending'), 0)::text as pending,
              coalesce(sum(commission_amount)
                filter (where status = 'payable'), 0)::text as payable
         from affiliate_commissions
        where affiliate_account_id = $1`,
      [account.id],
    ),
    db.query<{
      id: string;
      gross_amount: number;
      fee_amount: number;
      net_amount: number;
      payment_due_at: string;
    }>(
      `select id, gross_amount, fee_amount, net_amount, payment_due_at::text
         from affiliate_payouts
        where affiliate_account_id = $1 and status = 'created'
        order by period_start desc limit 1`,
      [account.id],
    ),
    db.query<{
      bank_name: string;
      branch_name: string;
      account_type: string;
      bank_account_last4: string;
      account_holder_name: string;
    }>(
      `select bank_name, branch_name, account_type, bank_account_last4, account_holder_name
         from affiliate_payout_accounts
        where affiliate_account_id = $1 and status = 'active'`,
      [account.id],
    ),
    db.query<{
      email: string;
      subscription_status: string | null;
      terminated: string | null;
      first_paid_at: string | null;
      total: string;
    }>(
      `select u.email,
              p.subscription_status::text as subscription_status,
              att.commission_terminated_reason as terminated,
              att.commission_started_at::text as first_paid_at,
              coalesce((
                select sum(c.commission_amount)
                  from affiliate_commissions c
                 where c.referred_user_id = att.referred_user_id
                   and c.affiliate_account_id = att.affiliate_account_id
                   and c.status <> 'reversed'
              ), 0)::text as total
         from affiliate_attributions att
         join profiles p on p.id = att.referred_user_id
         join auth.users u on u.id = att.referred_user_id
        where att.affiliate_account_id = $1
        order by att.attributed_at desc
        limit 50`,
      [account.id],
    ),
    db.query<{ date: string; label: string; status: string; amount: number }>(
      `select created_at::date::text as date, '紹介報酬' as label, status,
              case when status = 'reversed' then -commission_amount else commission_amount end as amount
         from affiliate_commissions
        where affiliate_account_id = $1
        order by created_at desc
        limit 20`,
      [account.id],
    ),
  ]);

  const t = totals.rows[0];
  const paidReferralCount = Number(t?.paid_users ?? "0");
  return {
    account,
    paidReferralCount,
    tier: tierProgress(paidReferralCount),
    pendingAmount: Number(t?.pending ?? "0"),
    payableAmount: Number(t?.payable ?? "0"),
    nextPayout: payout.rows[0]
      ? {
          id: payout.rows[0].id,
          grossAmount: payout.rows[0].gross_amount,
          feeAmount: payout.rows[0].fee_amount,
          netAmount: payout.rows[0].net_amount,
          paymentDueAt: payout.rows[0].payment_due_at,
        }
      : null,
    bankAccount: bank.rows[0]
      ? {
          bankName: bank.rows[0].bank_name,
          branchName: bank.rows[0].branch_name,
          accountType: bank.rows[0].account_type,
          last4: bank.rows[0].bank_account_last4,
          holderName: bank.rows[0].account_holder_name,
        }
      : null,
    invitedUsers: invited.rows.map((row) => ({
      maskedEmail: maskEmail(row.email),
      status: row.terminated
        ? "cancelled"
        : row.subscription_status === "trialing"
          ? "trial"
          : row.first_paid_at
            ? "paid"
            : "free",
      firstPaidAt: row.first_paid_at,
      totalCommission: Number(row.total),
    })),
    history: history.rows.map((row) => ({
      date: row.date,
      label: row.label,
      status: row.status,
      amount: row.amount,
    })),
  };
}
