import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { connectLocalDb } from "@/lib/db/test-utils";

import { createMonthlyPayouts, markPayoutPaid, payoutPeriodFor } from "./payout-store";
import {
  adjustCommissionForInvoiceRefund,
  attributeSignup,
  ensureAffiliateAccount,
  recordCommissionForInvoice,
  settleMatureCommissions,
  terminateAttributionForReferredUser,
} from "./store";

/**
 * 招待プログラムのDB配線（T-M8-174。正本: docs/cp/invite_cp.md）。
 * 帰属→報酬→締めの一連を実DBで検証する（transaction内・rollback）。
 */
describe("affiliate store (db)", () => {
  let database: Awaited<ReturnType<typeof connectLocalDb>>;

  beforeAll(async () => {
    database = await connectLocalDb();
    if (database) await database.query("begin");
  });
  afterAll(async () => {
    if (database) {
      await database.query("rollback");
      await database.end();
    }
  });

  async function makeUser(db: NonNullable<typeof database>): Promise<string> {
    const id = randomUUID();
    await db.query(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1, '00000000-0000-0000-0000-000000000000',
               'authenticated', 'authenticated', $2)`,
      [id, `${id}@example.com`],
    );
    return id;
  }

  it("帰属: 一意コード発行・自己招待拒否・1ユーザー1招待者・変更不可", async (ctx) => {
    if (!database) return ctx.skip();
    const db = database;
    const inviter = await makeUser(db);
    const inviter2 = await makeUser(db);
    const invited = await makeUser(db);

    const account = await ensureAffiliateAccount(db, inviter);
    expect(account.code).toMatch(/^[a-z2-9]{8}$/);
    // 2回呼んでも同じ行（コードは変わらない）。
    expect((await ensureAffiliateAccount(db, inviter)).code).toBe(account.code);

    // 自己招待は拒否。
    expect(await attributeSignup(db, { code: account.code, newUserId: inviter })).toBe(false);
    // 未知のコードは何もしない。
    expect(await attributeSignup(db, { code: "zzzzzzzz", newUserId: invited })).toBe(false);
    // 正常な帰属。
    expect(await attributeSignup(db, { code: account.code, newUserId: invited })).toBe(true);
    // 別の招待者コードで再登録されても変わらない（登録後変更不可）。
    const account2 = await ensureAffiliateAccount(db, inviter2);
    expect(await attributeSignup(db, { code: account2.code, newUserId: invited })).toBe(false);
    const owner = await db.query<{ affiliate_account_id: string }>(
      `select affiliate_account_id from affiliate_attributions where referred_user_id = $1`,
      [invited],
    );
    expect(owner.rows[0].affiliate_account_id).toBe(account.id);
  });

  it("報酬: 初回課金で6ヶ月の期間開始・率snapshot・冪等・期間外/解約後/0円は作らない", async (ctx) => {
    if (!database) return ctx.skip();
    const db = database;
    const inviter = await makeUser(db);
    const invited = await makeUser(db);
    const account = await ensureAffiliateAccount(db, inviter);
    await attributeSignup(db, { code: account.code, newUserId: invited });

    const paidAt = Math.floor(Date.parse("2026-08-15T00:00:00Z") / 1000);
    // Trial中（0円）は作らない。
    expect(
      await recordCommissionForInvoice(db, {
        referredUserId: invited,
        stripeInvoiceId: `in_${randomUUID()}`,
        amountPaid: 0,
        paidAtSec: paidAt,
      }),
    ).toBe("skipped");

    // 初回課金 ¥3,980 → 累計1人 → 20% → ¥796。
    const firstInvoice = `in_${randomUUID()}`;
    expect(
      await recordCommissionForInvoice(db, {
        referredUserId: invited,
        stripeInvoiceId: firstInvoice,
        amountPaid: 3980,
        paidAtSec: paidAt,
      }),
    ).toBe("created");
    // 同じinvoiceのリトライwebhookは冪等。
    expect(
      await recordCommissionForInvoice(db, {
        referredUserId: invited,
        stripeInvoiceId: firstInvoice,
        amountPaid: 3980,
        paidAtSec: paidAt,
      }),
    ).toBe("skipped");
    const commission = await db.query<{
      commission_rate_bps: number;
      commission_amount: number;
      status: string;
    }>(
      `select commission_rate_bps, commission_amount, status
         from affiliate_commissions where stripe_invoice_id = $1`,
      [firstInvoice],
    );
    expect(commission.rows[0]).toMatchObject({
      commission_rate_bps: 2000,
      commission_amount: 796,
      status: "pending",
    });
    const window = await db.query<{ started: string; ends: string }>(
      `select commission_started_at::text as started, commission_ends_at::text as ends
         from affiliate_attributions where referred_user_id = $1`,
      [invited],
    );
    expect(window.rows[0].started).toContain("2026-08-15");
    expect(window.rows[0].ends).toContain("2027-02-15"); // ＋6ヶ月

    // 期間内の2回目は作られる（率は据え置き20%＝累計1人のまま）。
    const paidAt2 = Math.floor(Date.parse("2026-09-15T00:00:00Z") / 1000);
    expect(
      await recordCommissionForInvoice(db, {
        referredUserId: invited,
        stripeInvoiceId: `in_${randomUUID()}`,
        amountPaid: 3980,
        paidAtSec: paidAt2,
      }),
    ).toBe("created");

    // 6ヶ月を超えた支払いは対象外。
    expect(
      await recordCommissionForInvoice(db, {
        referredUserId: invited,
        stripeInvoiceId: `in_${randomUUID()}`,
        amountPaid: 3980,
        paidAtSec: Math.floor(Date.parse("2027-02-16T00:00:00Z") / 1000),
      }),
    ).toBe("skipped");

    // 解約 → 期間終了。以後は期間内の日付でも作られず、再契約でも再開しない。
    await terminateAttributionForReferredUser(db, invited, "2026-10-01T00:00:00Z");
    expect(
      await recordCommissionForInvoice(db, {
        referredUserId: invited,
        stripeInvoiceId: `in_${randomUUID()}`,
        amountPaid: 3980,
        paidAtSec: Math.floor(Date.parse("2026-11-15T00:00:00Z") / 1000),
      }),
    ).toBe("skipped");
  });

  it("率は累計有料招待ユーザー数で上がる（5人目から25%）", async (ctx) => {
    if (!database) return ctx.skip();
    const db = database;
    const inviter = await makeUser(db);
    const account = await ensureAffiliateAccount(db, inviter);
    const paidAt = Math.floor(Date.now() / 1000);
    const rates: number[] = [];
    for (let i = 0; i < 5; i++) {
      const invited = await makeUser(db);
      await attributeSignup(db, { code: account.code, newUserId: invited });
      const invoice = `in_${randomUUID()}`;
      await recordCommissionForInvoice(db, {
        referredUserId: invited,
        stripeInvoiceId: invoice,
        amountPaid: 1000,
        paidAtSec: paidAt,
      });
      const row = await db.query<{ commission_rate_bps: number }>(
        `select commission_rate_bps from affiliate_commissions where stripe_invoice_id = $1`,
        [invoice],
      );
      rates.push(row.rows[0].commission_rate_bps);
    }
    expect(rates).toEqual([2000, 2000, 2000, 2000, 2500]);
  });

  it("Refundで取消（reversed）・確認期間経過でpayableへ", async (ctx) => {
    if (!database) return ctx.skip();
    const db = database;
    const inviter = await makeUser(db);
    const invited = await makeUser(db);
    const account = await ensureAffiliateAccount(db, inviter);
    await attributeSignup(db, { code: account.code, newUserId: invited });
    const invoice = `in_${randomUUID()}`;
    // 31日前の支払い → 確認期間（30日）を過ぎている。
    const paidAt = Math.floor(Date.now() / 1000) - 31 * 24 * 60 * 60;
    await recordCommissionForInvoice(db, {
      referredUserId: invited,
      stripeInvoiceId: invoice,
      amountPaid: 3980,
      paidAtSec: paidAt,
    });
    expect(await settleMatureCommissions(db)).toBeGreaterThanOrEqual(1);
    const settled = await db.query<{ status: string }>(
      `select status from affiliate_commissions where stripe_invoice_id = $1`,
      [invoice],
    );
    expect(settled.rows[0].status).toBe("payable");

    const full = await adjustCommissionForInvoiceRefund(db, invoice, {
      amountRefunded: 3980,
      fullyRefunded: true,
    });
    expect(full.reversed).toBe(1);
    const reversed = await db.query<{ status: string }>(
      `select status from affiliate_commissions where stripe_invoice_id = $1`,
      [invoice],
    );
    expect(reversed.rows[0].status).toBe("reversed");
  });

  it("部分返金は残額×snapshot率で減額する（全額取消しない・invite_cp.md §6「減額」）", async (ctx) => {
    if (!database) return ctx.skip();
    const db = database;
    const inviter = await makeUser(db);
    const invited = await makeUser(db);
    const account = await ensureAffiliateAccount(db, inviter);
    await attributeSignup(db, { code: account.code, newUserId: invited });
    const invoice = `in_${randomUUID()}`;
    await recordCommissionForInvoice(db, {
      referredUserId: invited,
      stripeInvoiceId: invoice,
      amountPaid: 3980,
      paidAtSec: Math.floor(Date.now() / 1000),
    });
    // ¥500の部分返金 → 残額3,480×20%＝696へ減額（statusは変えない）。
    const partial = await adjustCommissionForInvoiceRefund(db, invoice, {
      amountRefunded: 500,
      fullyRefunded: false,
    });
    expect(partial).toMatchObject({ reversed: 0, reduced: 1, paidUntouched: 0 });
    const row = await db.query<{ eligible_amount: number; commission_amount: number; status: string }>(
      `select eligible_amount, commission_amount, status
         from affiliate_commissions where stripe_invoice_id = $1`,
      [invoice],
    );
    expect(row.rows[0]).toMatchObject({
      eligible_amount: 3480,
      commission_amount: 696,
      status: "pending",
    });
  });

  it("解約の期間終了は初回課金前には適用しない（Trial中解約→後日課金で報酬が始まる）", async (ctx) => {
    if (!database) return ctx.skip();
    const db = database;
    const inviter = await makeUser(db);
    const invited = await makeUser(db);
    const account = await ensureAffiliateAccount(db, inviter);
    await attributeSignup(db, { code: account.code, newUserId: invited });
    // 一度も課金していない段階の解約 → 終了しない。
    await terminateAttributionForReferredUser(db, invited, new Date().toISOString());
    const before = await db.query<{ reason: string | null }>(
      `select commission_terminated_reason as reason
         from affiliate_attributions where referred_user_id = $1`,
      [invited],
    );
    expect(before.rows[0].reason).toBeNull();
    // 後日の有料化で報酬が普通に始まる。
    expect(
      await recordCommissionForInvoice(db, {
        referredUserId: invited,
        stripeInvoiceId: `in_${randomUUID()}`,
        amountPaid: 1480,
        paidAtSec: Math.floor(Date.now() / 1000),
      }),
    ).toBe("created");
  });

  it("月次Payout: ¥5,000以上＋口座ありだけ作成・手数料980を会計分離・支払完了でpaidへ", async (ctx) => {
    if (!database) return ctx.skip();
    const db = database;
    const nowIso = new Date().toISOString();
    const paidAt = Math.floor(Date.now() / 1000) - 31 * 24 * 60 * 60;

    // A: ¥5,000以上＋口座あり → Payout作成。
    const inviterA = await makeUser(db);
    const accountA = await ensureAffiliateAccount(db, inviterA);
    // B: ¥5,000未満 → 繰越。C: 口座なし → 繰越。
    const inviterB = await makeUser(db);
    const accountB = await ensureAffiliateAccount(db, inviterB);
    const inviterC = await makeUser(db);
    const accountC = await ensureAffiliateAccount(db, inviterC);

    async function seedCommission(accountId: string, userId: string, amount: number) {
      const invited = await makeUser(db);
      await db.query(
        `insert into affiliate_attributions (affiliate_account_id, referred_user_id,
           commission_started_at, commission_ends_at)
         values ($1, $2, to_timestamp($3), to_timestamp($3) + interval '6 months')`,
        [accountId, invited, paidAt],
      );
      await db.query(
        `insert into affiliate_commissions
           (affiliate_account_id, referred_user_id, stripe_invoice_id,
            eligible_amount, commission_rate_bps, commission_amount, status, available_at)
         values ($1, $2, $3, $4, 2000, $4, 'payable', now() - interval '1 day')`,
        [accountId, invited, `in_${randomUUID()}`, amount],
      );
    }
    await seedCommission(accountA.id, inviterA, 6200);
    await seedCommission(accountA.id, inviterA, 6200);
    await seedCommission(accountB.id, inviterB, 4990);
    await seedCommission(accountC.id, inviterC, 9000);
    // 口座はAとBだけ登録（Cは未登録）。
    for (const acc of [accountA, accountB]) {
      await db.query(
        `insert into affiliate_payout_accounts
           (affiliate_account_id, bank_name, branch_name,
            account_number_ciphertext, bank_account_last4, account_holder_name)
         values ($1, '三井住友銀行', '渋谷支店', 'ct', '1234', 'テスト タロウ')`,
        [acc.id],
      );
    }

    const result = await createMonthlyPayouts(db, nowIso);
    expect(result.created).toBeGreaterThanOrEqual(1);
    const payout = await db.query<{
      id: string;
      gross_amount: number;
      fee_amount: number;
      net_amount: number;
      status: string;
    }>(
      `select id, gross_amount, fee_amount, net_amount, status
         from affiliate_payouts where affiliate_account_id = $1`,
      [accountA.id],
    );
    expect(payout.rows[0]).toMatchObject({
      gross_amount: 12400,
      fee_amount: 980,
      net_amount: 11420,
      status: "created",
    });
    // B（5,000未満）とC（口座なし）はPayoutなし＝翌月へ繰越。
    for (const acc of [accountB, accountC]) {
      const none = await db.query(
        `select 1 from affiliate_payouts where affiliate_account_id = $1`,
        [acc.id],
      );
      expect(none.rowCount).toBe(0);
    }
    // 再実行しても二重作成しない（unique(affiliate, period_start)）。
    const again = await createMonthlyPayouts(db, nowIso);
    const payoutCount = await db.query(
      `select 1 from affiliate_payouts where affiliate_account_id = $1`,
      [accountA.id],
    );
    expect(payoutCount.rowCount).toBe(1);
    expect(again.created + again.skippedBelowMinimum + again.skippedNoBankAccount).toBeGreaterThan(0);

    // Payout作成後のRefund → 束ねから外れ、Payout金額が引き直される（過払い防止・レビュー修正）。
    const bundled = await db.query<{ stripe_invoice_id: string }>(
      `select stripe_invoice_id from affiliate_commissions
        where payout_id = $1 order by created_at limit 1`,
      [payout.rows[0].id],
    );
    await adjustCommissionForInvoiceRefund(db, bundled.rows[0].stripe_invoice_id, {
      amountRefunded: 6200,
      fullyRefunded: true,
    });
    const recalced = await db.query<{ gross_amount: number; net_amount: number }>(
      `select gross_amount, net_amount from affiliate_payouts where id = $1`,
      [payout.rows[0].id],
    );
    expect(recalced.rows[0]).toMatchObject({ gross_amount: 6200, net_amount: 5220 });

    // 支払完了 → payout=paid・束ねたCommissionもpaid。
    expect(await markPayoutPaid(db, payout.rows[0].id, "bank-2026-09")).toBe(true);
    const statuses = await db.query<{ status: string }>(
      `select status from affiliate_commissions where affiliate_account_id = $1 order by status`,
      [accountA.id],
    );
    expect(statuses.rows.map((r) => r.status)).toEqual(["paid", "reversed"]);

    // 支払済みへの返金は触らず、件数だけ返す（呼び出し側がSentryへ記録・原則1）。
    const paidInvoice = await db.query<{ stripe_invoice_id: string }>(
      `select stripe_invoice_id from affiliate_commissions
        where affiliate_account_id = $1 and status = 'paid'`,
      [accountA.id],
    );
    const paidAdjust = await adjustCommissionForInvoiceRefund(
      db,
      paidInvoice.rows[0].stripe_invoice_id,
      { amountRefunded: 6200, fullyRefunded: true },
    );
    expect(paidAdjust).toMatchObject({ reversed: 0, reduced: 0, paidUntouched: 1 });
  });

  it("payoutPeriodForは前月JSTの期間と翌月末の支払期限を返す", () => {
    const period = payoutPeriodFor("2026-09-02T00:00:00Z");
    expect(period.periodStart).toBe("2026-08-01");
    expect(period.periodEnd).toBe("2026-08-31");
    expect(period.windowKey).toBe("2026-08");
    // 支払期限は9/30 23:59:59 JST = 9/30T14:59:59Z。
    expect(period.paymentDueIso).toBe("2026-09-30T14:59:59.000Z");
  });
});
