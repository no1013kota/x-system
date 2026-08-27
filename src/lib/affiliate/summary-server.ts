import "server-only";

import { maskEmail, tierProgress, type TierProgress } from "./config";
import { ensureAffiliateAccount, type AffiliateAccount } from "./store";

import { pooledQueryable } from "@/lib/db/pool";

/**
 * 招待ページ（/app/invite）の表示データを1回で集める（T-M8-174・invite_cp.md §2）。
 * 金額は integer 円。メールアドレスはマスクして返す（個人情報を画面へ出さない）。
 */

export interface PendingPayout {
  id: string;
  grossAmount: number;
  feeAmount: number;
  netAmount: number;
  paymentDueAt: string;
}

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
  /** 次回振込（未払いのうち**期限が最も近い**もの）。 */
  nextPayout: PendingPayout | null;
  /**
   * 未払いの振込すべて（期限の近い順・T-M8-240）。締めは月1回だが、口座未登録などで
   * 2件以上たまることがある。**1件しか出さないと期限が古い方が画面から消える**。
   */
  pendingPayouts: PendingPayout[];
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

/**
 * 「解約済み」として扱う契約状態（T-M8-345）。`incomplete` は申込の途中なので含めない
 * （まだ始まっていないだけで、解約ではない）。
 */
const CANCELLED_SUBSCRIPTION_STATUSES = new Set(["canceled", "unpaid", "incomplete_expired"]);

export async function loadInviteSummary(userId: string): Promise<InviteSummary> {
  const db = pooledQueryable();
  const account = await ensureAffiliateAccount(db, userId);

  const [totals, payout, bank, invited, history] = await Promise.all([
    db.query<{ paid_users: string; pending: string; payable: string }>(
      /*
        **報酬率の人数は「いま続いている」有料招待ユーザー**（T-M8-345・運営者の指示 2026-08-28）。
        解約した利用者は数から外す——`store.ts` の率の計算と**同じ条件**にしないと、
        画面に出ている率と実際に付く率が食い違う（原則1）。
        金額（pending/payable）は解約後も残るので、そちらは全件から集計する。
      */
      `select (select count(distinct c.referred_user_id)
                 from affiliate_commissions c
                 join affiliate_attributions a
                   on a.affiliate_account_id = c.affiliate_account_id
                  and a.referred_user_id = c.referred_user_id
                where c.affiliate_account_id = $1
                  and c.status <> 'reversed'
                  and a.commission_terminated_reason is null)::text as paid_users,
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
      /*
        **期限が最も近い未払いを出す**（T-M8-240）。以前は `period_start desc limit 1` で
        「最新に作られた1件」を出していたため、未払いが2件以上あると**期限が古い方が画面から消えた**
        （締めは月1回なので、口座未登録などで積み上がると起きる）。合計と件数も返して
        「いくら受け取れるのか」を画面で説明できるようにする。
      */
      `select id, gross_amount, fee_amount, net_amount, payment_due_at::text
         from affiliate_payouts
        where affiliate_account_id = $1 and status = 'created'
        order by payment_due_at asc`,
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
      // **日付は日本時間で切る**（T-M8-253・運営者の指示 2026-08-23）。`created_at::date` は
      // UTCの日付になり、JSTの朝9時より前に作られた報酬が「前日」として並ぶ（他の表示と最大1日ずれる）。
      `select (created_at at time zone 'Asia/Tokyo')::date::text as date, '紹介報酬' as label, status,
              case when status = 'reversed' then -commission_amount else commission_amount end as amount
         from affiliate_commissions
        where affiliate_account_id = $1
        order by created_at desc
        limit 20`,
      [account.id],
    ),
  ]);

  const t = totals.rows[0];
  // 未払いの振込（期限の近い順）。先頭が「次回のお振込み」になる（T-M8-240）。
  const pendingPayouts: PendingPayout[] = payout.rows.map((row) => ({
    id: row.id,
    grossAmount: row.gross_amount,
    feeAmount: row.fee_amount,
    netAmount: row.net_amount,
    paymentDueAt: row.payment_due_at,
  }));
  const paidReferralCount = Number(t?.paid_users ?? "0");
  return {
    account,
    paidReferralCount,
    tier: tierProgress(paidReferralCount),
    pendingAmount: Number(t?.pending ?? "0"),
    payableAmount: Number(t?.payable ?? "0"),
    pendingPayouts: pendingPayouts,
    nextPayout: pendingPayouts[0] ?? null,
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
      /*
        **解約が分かるようにする**（T-M8-345・運営者の指示 2026-08-28）。
        報酬期間が終了した（`terminated`）場合に加えて、**契約が切れている状態**も解約として出す
        ——トライアル中に解約した人は `terminated` が付かない（報酬期間が始まっていないため）ので、
        以前は「Trial」のまま並び続け、招待した側からは解約したことが分からなかった。
      */
      status:
        row.terminated || CANCELLED_SUBSCRIPTION_STATUSES.has(row.subscription_status ?? "")
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
