import { randomBytes } from "node:crypto";

import {
  COMMISSION_CONFIRMATION_DAYS,
  COMMISSION_MONTHS,
  commissionAmount,
  rateBpsForPaidCount,
} from "./config";

import type { AffiliateDb } from "./db";

/**
 * 招待プログラムのDB配線（T-M8-174。正本: docs/cp/invite_cp.md）。
 *
 * すべて Server 専用（RLSは利用者のselectのみ・書き込みはここを通る）。
 * 金額は integer 円。Stripe webhook からの呼び出しは event claim transaction の中で行う。
 */

export interface AffiliateAccount {
  id: string;
  user_id: string;
  code: string;
  status: string;
}

/** 招待コード。URLに載るので紛らわしい文字（0/O/1/l/I）を避けた小文字英数8桁。 */
function generateCode(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(8);
  let code = "";
  for (const b of bytes) code += alphabet[b % alphabet.length];
  return code;
}

/** 自分の招待アカウントを取得（無ければ作る）。コード衝突はunique違反で引き直す。 */
export async function ensureAffiliateAccount(
  db: AffiliateDb,
  userId: string,
): Promise<AffiliateAccount> {
  const existing = await db.query<AffiliateAccount>(
    `select id, user_id, code, status from affiliate_accounts where user_id = $1`,
    [userId],
  );
  if (existing.rows[0]) return existing.rows[0];
  for (let attempt = 0; attempt < 3; attempt++) {
    const inserted = await db.query<AffiliateAccount>(
      `insert into affiliate_accounts (user_id, code)
       values ($1, $2)
       on conflict (code) do nothing
       returning id, user_id, code, status`,
      [userId, generateCode()],
    );
    if (inserted.rows[0]) return inserted.rows[0];
    // code衝突（極めて稀）またはuser_id衝突（並行作成）。後者なら既存行を返す。
    const raced = await db.query<AffiliateAccount>(
      `select id, user_id, code, status from affiliate_accounts where user_id = $1`,
      [userId],
    );
    if (raced.rows[0]) return raced.rows[0];
  }
  throw new Error("affiliate code generation failed after retries");
}

/**
 * 新規登録を招待者へ紐づける（invite_cp.md §4）。
 * Last Click（Cookieが最後のコードを持つ）・1ユーザー1招待者（unique）・登録後変更不可
 * （on conflict do nothing）・自己招待禁止。失敗しても登録は止めない（呼び出し側でbest-effort）。
 */
export async function attributeSignup(
  db: AffiliateDb,
  input: { code: string; newUserId: string },
): Promise<boolean> {
  const affiliate = await db.query<{ id: string; user_id: string }>(
    `select id, user_id from affiliate_accounts where code = $1 and status = 'active'`,
    [input.code],
  );
  const row = affiliate.rows[0];
  if (!row) return false;
  if (row.user_id === input.newUserId) return false; // 自己招待禁止
  const inserted = await db.query(
    `insert into affiliate_attributions (affiliate_account_id, referred_user_id)
     values ($1, $2)
     on conflict (referred_user_id) do nothing`,
    [row.id, input.newUserId],
  );
  return (inserted.rowCount ?? 0) > 0;
}

/**
 * 紹介ユーザーの解約で報酬期間を終了する（invite_cp.md §7）。
 * 一度終了したら再契約でも再開しない（reasonが入っている行は以後Commissionを作らない）。
 */
export async function terminateAttributionForReferredUser(
  db: AffiliateDb,
  referredUserId: string,
  endedAtIso: string,
): Promise<void> {
  await db.query(
    `update affiliate_attributions
        set commission_ends_at = least(coalesce(commission_ends_at, $2::timestamptz), $2::timestamptz),
            commission_terminated_reason = 'subscription_cancelled',
            updated_at = now()
      where referred_user_id = $1
        and commission_terminated_reason is null`,
    [referredUserId, endedAtIso],
  );
}

export interface RecordCommissionInput {
  /** 紹介された利用者（invoiceの支払者）。 */
  referredUserId: string;
  stripeInvoiceId: string;
  /** 実際に支払われた金額（invoice.amount_paid・JPY）。 */
  amountPaid: number;
  /** 支払時刻（unix秒）。 */
  paidAtSec: number;
}

/**
 * invoice.paid から報酬を作る（invite_cp.md §6）。冪等（stripe_invoice_id unique）。
 * - Trial中（amount 0）は作らない
 * - 初回課金で報酬期間を開始し、初回課金から6ヶ月で終了
 * - 解約で終了済み（reasonあり）・期間外は作らない
 * - 率は「累計有料招待ユーザー数（この利用者を含む）」で決め、snapshotとして保存する
 */
export async function recordCommissionForInvoice(
  db: AffiliateDb,
  input: RecordCommissionInput,
): Promise<"created" | "skipped"> {
  if (input.amountPaid <= 0) return "skipped";
  const attribution = await db.query<{
    id: string;
    affiliate_account_id: string;
    commission_started_at: string | null;
    commission_ends_at: string | null;
    commission_terminated_reason: string | null;
    affiliate_status: string;
  }>(
    `select att.id, att.affiliate_account_id, att.commission_started_at,
            att.commission_ends_at, att.commission_terminated_reason,
            acc.status as affiliate_status
       from affiliate_attributions att
       join affiliate_accounts acc on acc.id = att.affiliate_account_id
      where att.referred_user_id = $1
      for update`,
    [input.referredUserId],
  );
  const att = attribution.rows[0];
  if (!att) return "skipped";
  if (att.affiliate_status !== "active") return "skipped";
  if (att.commission_terminated_reason !== null) return "skipped"; // 解約後は再開しない
  const paidAtMs = input.paidAtSec * 1000;

  if (att.commission_started_at === null) {
    // 初回有料課金: 報酬期間を開始（6ヶ月）。
    await db.query(
      `update affiliate_attributions
          set commission_started_at = to_timestamp($2),
              commission_ends_at = to_timestamp($2) + make_interval(months => $3),
              updated_at = now()
        where id = $1`,
      [att.id, input.paidAtSec, COMMISSION_MONTHS],
    );
  } else if (
    att.commission_ends_at !== null &&
    paidAtMs > new Date(att.commission_ends_at).getTime()
  ) {
    return "skipped"; // 最大6ヶ月を超えた支払いは対象外
  }

  // 累計有料招待ユーザー数（この利用者を含む）で率を決める。reversedだけの利用者は数えない。
  const counted = await db.query<{ n: string }>(
    `select count(distinct referred_user_id)::text as n
       from affiliate_commissions
      where affiliate_account_id = $1
        and status <> 'reversed'
        and referred_user_id <> $2`,
    [att.affiliate_account_id, input.referredUserId],
  );
  const paidCount = Number(counted.rows[0]?.n ?? "0") + 1;
  const rateBps = rateBpsForPaidCount(paidCount);

  const inserted = await db.query(
    `insert into affiliate_commissions
       (affiliate_account_id, referred_user_id, stripe_invoice_id,
        eligible_amount, commission_rate_bps, commission_amount,
        status, available_at)
     values ($1, $2, $3, $4, $5, $6, 'pending',
             to_timestamp($7) + make_interval(days => $8))
     on conflict (stripe_invoice_id) do nothing`,
    [
      att.affiliate_account_id,
      input.referredUserId,
      input.stripeInvoiceId,
      input.amountPaid,
      rateBps,
      commissionAmount(input.amountPaid, rateBps),
      input.paidAtSec,
      COMMISSION_CONFIRMATION_DAYS,
    ],
  );
  return (inserted.rowCount ?? 0) > 0 ? "created" : "skipped";
}

/** Refund: 該当invoiceの報酬を取り消す（支払済みは触らず運営者が個別調整・invite_cp.md §6）。 */
export async function reverseCommissionForInvoice(
  db: AffiliateDb,
  stripeInvoiceId: string,
): Promise<number> {
  const updated = await db.query(
    `update affiliate_commissions
        set status = 'reversed', payout_id = null
      where stripe_invoice_id = $1
        and status in ('pending', 'payable', 'held')`,
    [stripeInvoiceId],
  );
  return updated.rowCount ?? 0;
}

/** 確認期間を過ぎた pending を payable へ（tickが1日1回呼ぶ）。 */
export async function settleMatureCommissions(db: AffiliateDb): Promise<number> {
  const updated = await db.query(
    `update affiliate_commissions
        set status = 'payable'
      where status = 'pending' and available_at <= now()`,
  );
  return updated.rowCount ?? 0;
}
