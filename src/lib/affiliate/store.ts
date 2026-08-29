import { randomBytes } from "node:crypto";

import {
  COMMISSION_CONFIRMATION_DAYS,
  COMMISSION_MONTHS,
  COUNTED_REFERRAL_SQL,
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
       on conflict do nothing
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
 * 紐づけの結果（T-M8-242）。**「付かなかった」を1つの false にまとめない**——
 * 自己招待や紐づけ済みは正常だが、`unknown_code` は取りこぼしの疑いで、
 * 呼び出し側が記録できるようにする（CLAUDE.md 原則1）。
 */
export type AttributionOutcome =
  | "attributed"
  | "self"
  | "already_attributed"
  /**
   * 招待者が**停止されている**（要決定D-40・T-M8-302）。運営者が意図して止めた状態なので、
   * `unknown_code`（取りこぼしの疑い）と混ぜない——混ぜると、止めるたびにSentryへ
   * 「不明なコード」が上がり、本物の取りこぼしが埋もれる。
   */
  | "suspended"
  /** そのコードの招待アカウントが無い（打ち間違い・保存時の取り違え）。 */
  | "unknown_code";

/**
 * 新規登録を招待者へ紐づける（invite_cp.md §4）。
 * Last Click（Cookieが最後のコードを持つ）・1ユーザー1招待者（unique）・登録後変更不可
 * （on conflict do nothing）・自己招待禁止。失敗しても登録は止めない（呼び出し側でbest-effort）。
 */
export async function attributeSignup(
  db: AffiliateDb,
  input: { code: string; newUserId: string },
): Promise<AttributionOutcome> {
  const affiliate = await db.query<{ id: string; user_id: string; status: string }>(
    // コードは小文字で発行する。大文字混じりで届いても取りこぼさない（T-M8-242）。
    `select id, user_id, status from affiliate_accounts where code = lower($1)`,
    [input.code],
  );
  const row = affiliate.rows[0];
  if (!row) return "unknown_code";
  // 停止中は帰属させないが、「無いコード」とは区別して返す（T-M8-302）。
  if (row.status !== "active") return "suspended";
  if (row.user_id === input.newUserId) return "self"; // 自己招待禁止
  const inserted = await db.query(
    `insert into affiliate_attributions (affiliate_account_id, referred_user_id)
     values ($1, $2)
     on conflict (referred_user_id) do nothing`,
    [row.id, input.newUserId],
  );
  return (inserted.rowCount ?? 0) > 0 ? "attributed" : "already_attributed";
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
  // **報酬期間が始まっていない（一度も課金していない）解約では終了しない**（レビュー修正）。
  // Trial中の解約で恒久終了すると、後日戻ってきて課金しても報酬が永久にゼロになる。
  // 仕様（invite_cp.md §5/§7）の「解約で終了・再開しない」は初回課金後の話。
  await db.query(
    `update affiliate_attributions
        set commission_ends_at = least(coalesce(commission_ends_at, $2::timestamptz), $2::timestamptz),
            commission_terminated_reason = 'subscription_cancelled',
            updated_at = now()
      where referred_user_id = $1
        and commission_terminated_reason is null
        and commission_started_at is not null`,
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
  const paidAtMs = input.paidAtSec * 1000;
  /*
    **解約の判定は「日付」で行う**（T-M8-236）。以前は `commission_terminated_reason` があるだけで
    支払日を見ずに切っていたため、**解約より前の支払いが遅れて届くと報酬が恒久に落ちた**
    （Stripeはイベントの順序を保証せず、失敗した配信を最大3日リトライする）。
    解約時には `commission_ends_at` が解約時刻へ前倒しされているので、
    「ends_at より後の支払いは対象外」という下の判定だけで「解約後は再開しない」も満たせる。
    ただし**一度も報酬期間が始まっていない**まま解約された場合は、ここで始めない。
  */
  if (att.commission_terminated_reason !== null && att.commission_started_at === null) {
    return "skipped";
  }

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

  /*
    率を決める人数は**いま続いている招待ユーザー**（T-M8-345/351・運営者の指示 2026-08-28）。

    以前は「一度でも課金があれば永久に1人」と数えていたため、招待した人が全員解約しても
    率は上がったまま下がらなかった。**招待し続けている人ほど率が高い**という制度の趣旨に
    合わせて、解約した人（報酬期間の終了、または契約が切れている状態）は数から外す。

    **Trial中の人も1人と数える**（T-M8-351）。招待した時点で「連れてきた」ことは変わらず、
    課金を待つ間だけ率が下がるのは招待する側から見て説明が付かない。
    **過去のCommissionは作成時の率をsnapshot済みなので書き換わらない**（下がるのは以後の分だけ）。

    いま支払った本人（`$2`）はこの数に含めず、下で +1 する——この時点の
    `profiles.subscription_status` は webhook の届く順で `trialing` のこともあるため、
    状態を見て数えると本人が数え落ちることがある。
  */
  const counted = await db.query<{ n: string }>(
    `select count(*)::text as n
       from affiliate_attributions a
       join profiles pr on pr.id = a.referred_user_id
      where a.affiliate_account_id = $1
        and a.referred_user_id <> $2
        and ${COUNTED_REFERRAL_SQL}`,
    [att.affiliate_account_id, input.referredUserId],
  );
  const paidCount = Number(counted.rows[0]?.n ?? "0") + 1;
  const rateBps = rateBpsForPaidCount(paidCount);

  const inserted = await db.query(
    // `original_amount` は返金前の対象売上。返金は毎回ここから計算し直す（T-M8-236）。
    `insert into affiliate_commissions
       (affiliate_account_id, referred_user_id, stripe_invoice_id,
        eligible_amount, original_amount, commission_rate_bps, commission_amount,
        status, available_at)
     values ($1, $2, $3, $4, $4, $5, $6, 'pending',
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

/**
 * 未払い（created）のPayoutの金額を、束ねたCommissionの現在値から引き直す（レビュー修正）。
 * Refundの取消・減額でPayoutの表示額と実態が乖離すると**運営者が過払いする**ため、
 * 取消時と支払記録時（markPayoutPaid）の両方で呼ぶ。手取りが0以下になったらPayoutを取り消す。
 */
export async function recalcCreatedPayout(db: AffiliateDb, payoutId: string): Promise<void> {
  const payout = await db.query<{ id: string; fee_amount: number }>(
    `select id, fee_amount from affiliate_payouts
      where id = $1 and status = 'created'
      for update`,
    [payoutId],
  );
  if (!payout.rows[0]) return;
  const total = await db.query<{ n: string }>(
    `select coalesce(sum(commission_amount), 0)::text as n
       from affiliate_commissions
      where payout_id = $1 and status = 'payable'`,
    [payoutId],
  );
  const gross = Number(total.rows[0]?.n ?? "0");
  if (gross <= payout.rows[0].fee_amount) {
    // 手数料を下回った振込は成立しない。Payoutを取消し、残りは翌月の締めへ戻す。
    await db.query(
      `update affiliate_payouts set status = 'canceled', updated_at = now() where id = $1`,
      [payoutId],
    );
    await db.query(
      `update affiliate_commissions set payout_id = null
        where payout_id = $1 and status = 'payable'`,
      [payoutId],
    );
    return;
  }
  await db.query(
    `update affiliate_payouts
        set gross_amount = $2, net_amount = $2 - fee_amount, updated_at = now()
      where id = $1`,
    [payoutId, gross],
  );
}

export interface RefundAdjustResult {
  /** 全額取消した件数。 */
  reversed: number;
  /** 部分返金で減額した件数。 */
  reduced: number;
  /** 支払済みのため触らなかった件数（運営者の個別調整が必要・呼び出し側が記録する）。 */
  paidUntouched: number;
}

/**
 * Refund: 該当invoiceの報酬を取消・減額する（invite_cp.md §6）。
 * - 全額返金（または返金額が支払額以上）→ `reversed`
 * - 部分返金 → 実支払残額×snapshot率で減額（率は変えない）
 * - 支払済み（paid）は触らず件数だけ返す（呼び出し側がSentryへ記録する・原則1）
 * - 未払いPayoutに束ねられていた場合はPayout金額を引き直す（過払い防止）
 */
export async function adjustCommissionForInvoiceRefund(
  db: AffiliateDb,
  stripeInvoiceId: string,
  refund: { amountRefunded: number; fullyRefunded: boolean },
): Promise<RefundAdjustResult> {
  const rows = await db.query<{
    id: string;
    status: string;
    eligible_amount: number;
    original_amount: number;
    commission_rate_bps: number;
    payout_id: string | null;
  }>(
    `select id, status, eligible_amount, original_amount, commission_rate_bps, payout_id
       from affiliate_commissions
      where stripe_invoice_id = $1
      for update`,
    [stripeInvoiceId],
  );
  const result: RefundAdjustResult = { reversed: 0, reduced: 0, paidUntouched: 0 };
  const payoutIds = new Set<string>();
  for (const row of rows.rows) {
    if (row.status === "paid") {
      result.paidUntouched += 1;
      continue;
    }
    if (row.status === "reversed") continue;
    if (row.payout_id) payoutIds.add(row.payout_id);
    /*
      `refund.amountRefunded` は**その請求に対する累計返金額**（部分返金のたびに増える）。
      減額済みの `eligible_amount` から引くと二重に差し引かれるので、**返金前の額から毎回引き直す**
      （T-M8-236。同じイベントが再送されても結果が変わらない＝冪等）。
    */
    const remaining = Math.max(0, row.original_amount - refund.amountRefunded);
    if (refund.fullyRefunded || remaining === 0) {
      await db.query(
        `update affiliate_commissions set status = 'reversed', payout_id = null where id = $1`,
        [row.id],
      );
      result.reversed += 1;
    } else {
      await db.query(
        `update affiliate_commissions
            set eligible_amount = $2, commission_amount = $3
          where id = $1`,
        [row.id, remaining, commissionAmount(remaining, row.commission_rate_bps)],
      );
      result.reduced += 1;
    }
  }
  for (const payoutId of payoutIds) {
    await recalcCreatedPayout(db, payoutId);
  }
  return result;
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
