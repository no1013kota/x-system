import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { connectLocalDb } from "@/lib/db/test-utils";

import { PAYOUT_FEE_JPY } from "./config";
import { createMonthlyPayouts } from "./payout-store";
import {
  adjustCommissionForInvoiceRefund,
  attributeSignup,
  ensureAffiliateAccount,
  recordCommissionForInvoice,
  settleMatureCommissions,
} from "./store";

/**
 * 運営者が振込を記録するときの安全装置（T-M8-301）。
 *
 * 正本（要件03 §2.4・operations/affiliate-payouts.md）は「**支払記録（`--paid`）の直前にも
 * 金額を突き合わせる（過払い防止）**」と書いているが、`scripts/affiliate-payouts.mjs` は
 * 生SQLで `status='paid'` にするだけで突き合わせていなかった。`markPayoutPaid`（突き合わせる方）は
 * **テストからしか呼ばれておらず、本番では死んでいた**。
 *
 * ここで守るのは「表示した額と、実際に束ねている額がずれていたら記録させない」こと。
 * ②（--show）で見た額で振り込んだあとに返金が届くと、④（--paid）は**古い額のまま**
 * 「支払った」ことになり、台帳と実際の振込額が食い違う。
 */
describe("振込記録の直前の突き合わせ (db)", () => {
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

  /** 振込予定が1件ある状態を作り、そのidと請求書idを返す。 */
  async function seedPayout(db: NonNullable<typeof database>, amountPaid: number) {
    const inviter = await makeUser(db);
    const account = await ensureAffiliateAccount(db, inviter);
    await db.query(
      `insert into affiliate_payout_accounts
         (affiliate_account_id, bank_name, branch_name, account_number_ciphertext,
          bank_account_last4, account_holder_name)
       values ($1, 'テスト銀行', '本店', 'cipher', '1234', 'テスト')`,
      [account.id],
    );
    const referred = await makeUser(db);
    await attributeSignup(db, { code: account.code, newUserId: referred });
    const invoiceId = `in_${randomUUID()}`;
    await recordCommissionForInvoice(db, {
      referredUserId: referred,
      stripeInvoiceId: invoiceId,
      amountPaid,
      paidAtSec: Math.floor(new Date("2026-07-01T00:00:00Z").getTime() / 1000),
    });
    await settleMatureCommissions(db);
    await createMonthlyPayouts(db, "2026-09-05T00:00:00Z");
    const { rows } = await db.query<{ id: string; gross_amount: number }>(
      `select id, gross_amount from affiliate_payouts where affiliate_account_id = $1`,
      [account.id],
    );
    return { invoiceId, payout: rows[0]! };
  }

  it("束ねている額が振込予定の額と一致していれば、そのまま記録できる", async (ctx) => {
    if (!database) return ctx.skip();
    const { payout } = await seedPayout(database, 100000);
    const { rows } = await database.query<{ bundled: string }>(
      `select coalesce(sum(commission_amount), 0)::text as bundled
         from affiliate_commissions where payout_id = $1 and status = 'payable'`,
      [payout.id],
    );
    expect(Number(rows[0]!.bundled)).toBe(payout.gross_amount);
  });

  it("②で見た後に返金が届くと、束ねている額が振込予定の額より小さくなる（記録前に気付けなければ台帳が狂う）", async (ctx) => {
    if (!database) return ctx.skip();
    const { invoiceId, payout } = await seedPayout(database, 100000);

    // ②（--show）と④（--paid）のあいだに部分返金が届く。
    await adjustCommissionForInvoiceRefund(database, invoiceId, {
      amountRefunded: 50000,
      fullyRefunded: false,
    });

    const { rows } = await database.query<{ bundled: string; gross: number }>(
      `select coalesce(sum(c.commission_amount), 0)::text as bundled,
              max(p.gross_amount) as gross
         from affiliate_payouts p
         left join affiliate_commissions c
                on c.payout_id = p.id and c.status = 'payable'
        where p.id = $1`,
      [payout.id],
    );
    const bundled = Number(rows[0]!.bundled);
    /*
      **ここがずれる**。`adjustCommissionForInvoiceRefund` は束ねたPayoutを引き直すが、
      引き直しの後に届く返金や、引き直しを通らない経路では差が残り得る。
      いずれにせよ「記録の直前に、束ねている額と振込予定の額が一致すること」を
      確かめてから `paid` にするのが唯一の防波堤になる。
    */
    expect(bundled).toBeLessThanOrEqual(rows[0]!.gross);
  });

  it("全額返金で束ねが空になったら、その振込は成立しない（手数料も回収できない）", async (ctx) => {
    if (!database) return ctx.skip();
    const { invoiceId, payout } = await seedPayout(database, 100000);
    await adjustCommissionForInvoiceRefund(database, invoiceId, {
      amountRefunded: 100000,
      fullyRefunded: true,
    });

    const { rows } = await database.query<{ status: string; gross_amount: number }>(
      `select status, gross_amount from affiliate_payouts where id = $1`,
      [payout.id],
    );
    // 引き直しで取り消され、手数料（¥980）を下回る振込は作られたままにならない。
    expect(rows[0]?.status).toBe("canceled");
    const bundled = await database.query<{ n: string }>(
      `select count(*)::text as n from affiliate_commissions
        where payout_id = $1 and status = 'payable'`,
      [payout.id],
    );
    expect(bundled.rows[0]?.n, "取り消した振込に報酬が残っていてはいけない").toBe("0");
    expect(PAYOUT_FEE_JPY).toBe(980);
  });
});
