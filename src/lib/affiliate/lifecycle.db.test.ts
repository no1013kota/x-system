import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { connectLocalDb } from "@/lib/db/test-utils";

import { createMonthlyPayouts } from "./payout-store";
import {
  adjustCommissionForInvoiceRefund,
  attributeSignup,
  ensureAffiliateAccount,
  recordCommissionForInvoice,
  settleMatureCommissions,
  terminateAttributionForReferredUser,
} from "./store";

/**
 * 招待された利用者の**契約が動いたとき**の報酬（T-M8-305・運営者の指示 2026-08-25）。
 *
 * 招待は「1回紹介して終わり」ではなく、**紹介した人が払い続けるあいだ報酬が発生し続ける**。
 * そのため被招待者の契約が動くたびに金額が変わる——プラン変更・解約・復活・大量招待・
 * 月の途中でのランク変更。どれも**金額が静かに間違う**型で、画面には正しく見えてしまう。
 *
 * `scenarios.db.test.ts` が「招待者側の状態」（停止・締め・振込）を見るのに対し、
 * こちらは**被招待者側の契約が動く筋**を見る。実DBのtransaction内で完結させ、
 * 検査は必ず自分が作ったIDに限定する。
 */
describe("招待された利用者の契約が動いたときの報酬 (db)", () => {
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

  const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

  /** 招待者と、紐づけ済みの被招待者を1人作る。 */
  async function pair(db: NonNullable<typeof database>) {
    const inviter = await makeUser(db);
    const account = await ensureAffiliateAccount(db, inviter);
    const referred = await makeUser(db);
    await attributeSignup(db, { code: account.code, newUserId: referred });
    return { account, referred };
  }

  async function pay(
    db: NonNullable<typeof database>,
    referred: string,
    amount: number,
    at: string,
  ) {
    const invoice = `in_${randomUUID()}`;
    const result = await recordCommissionForInvoice(db, {
      referredUserId: referred,
      stripeInvoiceId: invoice,
      amountPaid: amount,
      paidAtSec: sec(at),
    });
    return { invoice, result };
  }

  async function commissionOf(db: NonNullable<typeof database>, invoice: string) {
    const { rows } = await db.query<{
      eligible_amount: number;
      commission_amount: number;
      commission_rate_bps: number;
      status: string;
    }>(
      `select eligible_amount, commission_amount, commission_rate_bps, status
         from affiliate_commissions where stripe_invoice_id = $1`,
      [invoice],
    );
    return rows[0] ?? null;
  }

  // ------------------------------------------------------------ プラン変更

  it("被招待者が上位プランへ変えると、次の支払いから報酬額も上がる", async (ctx) => {
    if (!database) return ctx.skip();
    const { referred } = await pair(database);
    // スタンダード → プレミアム → エキスパート（実際に支払われた額で決まる）。
    const a = await pay(database, referred, 1480, "2026-03-01T00:00:00Z");
    const b = await pay(database, referred, 3980, "2026-04-01T00:00:00Z");
    const c = await pay(database, referred, 14800, "2026-05-01T00:00:00Z");

    expect((await commissionOf(database, a.invoice))?.commission_amount).toBe(444);
    expect((await commissionOf(database, b.invoice))?.commission_amount).toBe(1194);
    expect((await commissionOf(database, c.invoice))?.commission_amount).toBe(4440);
    // 率は変わらない（招待人数で決まる）。変わったのは対象額だけ。
    for (const inv of [a, b, c]) {
      expect((await commissionOf(database, inv.invoice))?.commission_rate_bps).toBe(3000);
    }
  });

  it("上位プランへの変更で日割りの差額が請求されても、その支払いぶんの報酬が出る", async (ctx) => {
    if (!database) return ctx.skip();
    const { referred } = await pair(database);
    await pay(database, referred, 1480, "2026-03-01T00:00:00Z");
    /*
      Portalの上位変更は `always_invoice` で**その場で日割りを請求する**（要件03 §2.2）。
      その請求も `invoice.paid` として届くので、報酬の対象になる。
      「月額しか対象にならない」と誤解しやすいが、判断は**実際に払われた額**だけ。
    */
    const proration = await pay(database, referred, 7330, "2026-03-15T00:00:00Z");
    expect(proration.result).toBe("created");
    expect((await commissionOf(database, proration.invoice))?.commission_amount).toBe(2199);
  });

  it("被招待者が下位プランへ変えると報酬額も下がる（期間は変わらない）", async (ctx) => {
    if (!database) return ctx.skip();
    const { referred } = await pair(database);
    const first = await pay(database, referred, 14800, "2026-03-01T00:00:00Z");
    const later = await pay(database, referred, 1480, "2026-08-01T00:00:00Z");

    expect((await commissionOf(database, first.invoice))?.commission_amount).toBe(4440);
    expect((await commissionOf(database, later.invoice))?.commission_amount).toBe(444);
    // 6ヶ月の期間はプラン変更では動かない（初回課金からの起算のまま）。
    const { rows } = await database.query<{ ends: string }>(
      `select commission_ends_at as ends from affiliate_attributions where referred_user_id = $1`,
      [referred],
    );
    expect(new Date(rows[0]!.ends).toISOString().slice(0, 10)).toBe("2026-09-01");
  });

  // ------------------------------------------------------------ 解約と復活

  it("解約したら以後の支払いは対象外だが、解約前の支払いが遅れて届いたら対象", async (ctx) => {
    if (!database) return ctx.skip();
    const { referred } = await pair(database);
    await pay(database, referred, 3980, "2026-03-01T00:00:00Z");
    await terminateAttributionForReferredUser(database, referred, "2026-04-10T00:00:00Z");

    // 解約より前の支払い（webhookが遅れて後から届く）。
    const late = await pay(database, referred, 3980, "2026-04-05T00:00:00Z");
    expect(late.result, "解約前の支払いは対象").toBe("created");
    // 解約より後の支払い。
    const after = await pay(database, referred, 3980, "2026-04-20T00:00:00Z");
    expect(after.result, "解約後の支払いは対象外").toBe("skipped");
  });

  it("解約から復活して再契約しても、その後の支払いは報酬対象外", async (ctx) => {
    if (!database) return ctx.skip();
    const { account, referred } = await pair(database);
    await pay(database, referred, 3980, "2026-03-01T00:00:00Z");
    await terminateAttributionForReferredUser(database, referred, "2026-04-01T00:00:00Z");

    /*
      **復活しても報酬は再開しない**（運営者の確認 2026-08-25「この場合は招待報酬対象外」）。
      解約時に `commission_ends_at` が前倒しされ、以後の支払いは日付で弾かれる。
      再契約は新しい契約（別のsubscription）だが、**帰属は利用者単位**なので同じ判定になる。
    */
    for (const month of ["2026-05-01", "2026-06-01", "2026-07-01"]) {
      const again = await pay(database, referred, 3980, `${month}T00:00:00Z`);
      expect(again.result, `${month} の支払いが対象になっている`).toBe("skipped");
    }
    const { rows } = await database.query<{ n: string }>(
      `select count(*)::text as n from affiliate_commissions where affiliate_account_id = $1`,
      [account.id],
    );
    expect(rows[0]?.n, "復活で報酬が増えてはいけない").toBe("1");
  });

  it("トライアル中に解約した人が後から契約したら、そこから報酬期間が始まる", async (ctx) => {
    if (!database) return ctx.skip();
    const { referred } = await pair(database);
    /*
      **一度も払っていない解約では終了しない**。トライアル中の離脱で恒久終了させると、
      後日戻ってきて課金しても報酬が永久にゼロになる（招待した人の努力が消える）。
    */
    await terminateAttributionForReferredUser(database, referred, "2026-03-05T00:00:00Z");
    const later = await pay(database, referred, 3980, "2026-06-01T00:00:00Z");
    expect(later.result).toBe("created");

    const { rows } = await database.query<{ started: string; reason: string | null }>(
      `select commission_started_at as started, commission_terminated_reason as reason
         from affiliate_attributions where referred_user_id = $1`,
      [referred],
    );
    expect(rows[0]?.reason, "未課金の解約で終了扱いにしない").toBeNull();
    expect(new Date(rows[0]!.started).toISOString().slice(0, 10)).toBe("2026-06-01");
  });

  // ------------------------------------------------------------ 大量招待とランク変更

  it("60人招待すると率が段階的に上がる（30→35→40→45→50）", async (ctx) => {
    if (!database) return ctx.skip();
    const inviter = await makeUser(database);
    const account = await ensureAffiliateAccount(database, inviter);
    const rates: number[] = [];
    for (let i = 1; i <= 60; i++) {
      const u = await makeUser(database);
      await attributeSignup(database, { code: account.code, newUserId: u });
      const { invoice } = await pay(database, u, 10000, "2026-03-01T00:00:00Z");
      rates.push((await commissionOf(database, invoice))!.commission_rate_bps);
    }
    // 帯の境目（何人目から上がるか）だけを見る。
    expect(rates[0], "1人目は30%").toBe(3000);
    expect(rates[4], "5人目はまだ30%").toBe(3000);
    expect(rates[5], "6人目から35%").toBe(3500);
    expect(rates[9], "10人目は35%").toBe(3500);
    expect(rates[10], "11人目から40%").toBe(4000);
    expect(rates[24], "25人目は40%").toBe(4000);
    expect(rates[25], "26人目から45%").toBe(4500);
    expect(rates[49], "50人目は45%").toBe(4500);
    expect(rates[50], "51人目から50%").toBe(5000);
    expect(rates[59], "60人目も50%").toBe(5000);
  });

  it("同じ人が何回払っても「有料招待1人」のまま（率が水増しされない）", async (ctx) => {
    if (!database) return ctx.skip();
    const { account, referred } = await pair(database);
    /*
      **率は「人数」で決まる**（`count(distinct referred_user_id)`）。ここが件数だと、
      1人が6ヶ月払い続けただけで最上位まで駆け上がってしまう。
      招待の努力ではなく継続で率が上がるのは、制度の意図と違う。
    */
    const rates: number[] = [];
    for (const month of ["03", "04", "05", "06", "07", "08"]) {
      const { invoice } = await pay(database, referred, 10000, `2026-${month}-01T00:00:00Z`);
      rates.push((await commissionOf(database, invoice))!.commission_rate_bps);
    }
    expect(rates, "6回払っても30%のまま").toEqual([3000, 3000, 3000, 3000, 3000, 3000]);

    const { rows } = await database.query<{ n: string }>(
      `select count(distinct referred_user_id)::text as n
         from affiliate_commissions where affiliate_account_id = $1 and status <> 'reversed'`,
      [account.id],
    );
    expect(rows[0]?.n, "有料招待は1人").toBe("1");
  });

  it("報酬期間の6ヶ月を過ぎたら、契約が続いていても報酬は止まる", async (ctx) => {
    if (!database) return ctx.skip();
    const { referred } = await pair(database);
    await pay(database, referred, 3980, "2026-03-01T00:00:00Z");
    // 6ヶ月ちょうど（終端）までは対象。
    expect((await pay(database, referred, 3980, "2026-09-01T00:00:00Z")).result).toBe("created");
    // それ以降は、被招待者が払い続けていても対象外。
    for (const month of ["2026-10-01", "2026-11-01", "2027-03-01"]) {
      expect(
        (await pay(database, referred, 3980, `${month}T00:00:00Z`)).result,
        `${month} が対象になっている`,
      ).toBe("skipped");
    }
  });

  it("月の途中でランクが上がると、その月の報酬に2つの率が混ざったまま締められる", async (ctx) => {
    if (!database) return ctx.skip();
    const inviter = await makeUser(database);
    const account = await ensureAffiliateAccount(database, inviter);
    await database.query(
      `insert into affiliate_payout_accounts
         (affiliate_account_id, bank_name, branch_name, account_number_ciphertext,
          bank_account_last4, account_holder_name)
       values ($1, 'テスト銀行', '本店', 'cipher', '1234', 'テスト')`,
      [account.id],
    );
    // 同じ月に7人が課金。6人目からランクが上がる。
    for (let i = 0; i < 7; i++) {
      const u = await makeUser(database);
      await attributeSignup(database, { code: account.code, newUserId: u });
      await pay(database, u, 10000, "2026-07-10T00:00:00Z");
    }
    const { rows } = await database.query<{ rate: number; n: string }>(
      `select commission_rate_bps as rate, count(*)::text as n
         from affiliate_commissions where affiliate_account_id = $1
        group by commission_rate_bps order by commission_rate_bps`,
      [account.id],
    );
    expect(rows.map((r) => [r.rate, Number(r.n)])).toEqual([
      [3000, 5],
      [3500, 2],
    ]);

    // 締めは率を混ぜたまま合計する（後から一律の率へ揃え直さない）。
    await settleMatureCommissions(database);
    await createMonthlyPayouts(database, "2026-09-05T00:00:00Z");
    const payout = await database.query<{ gross_amount: number }>(
      `select gross_amount from affiliate_payouts where affiliate_account_id = $1`,
      [account.id],
    );
    expect(payout.rows[0]?.gross_amount, "3000×5 + 3500×2").toBe(3000 * 5 + 3500 * 2);
  });

  it("返金で有料招待が減ると、その後の報酬の率も下がる", async (ctx) => {
    if (!database) return ctx.skip();
    const inviter = await makeUser(database);
    const account = await ensureAffiliateAccount(database, inviter);
    const invoices: string[] = [];
    for (let i = 0; i < 6; i++) {
      const u = await makeUser(database);
      await attributeSignup(database, { code: account.code, newUserId: u });
      const { invoice } = await pay(database, u, 10000, "2026-03-01T00:00:00Z");
      invoices.push(invoice);
    }
    expect((await commissionOf(database, invoices[5]!))?.commission_rate_bps).toBe(3500);

    /*
      **全額返金された利用者は「有料招待」に数えない**（`status <> 'reversed'`）。
      2人取り消すと有料招待は4人になるので、次の紹介は5人目＝まだ30%へ戻る。
      ここが数え直されないと、返金された分で上がった率が居座る。
    */
    for (const invoice of invoices.slice(0, 2)) {
      await adjustCommissionForInvoiceRefund(database, invoice, {
        amountRefunded: 10000,
        fullyRefunded: true,
      });
    }
    const next = await makeUser(database);
    await attributeSignup(database, { code: account.code, newUserId: next });
    const { invoice } = await pay(database, next, 10000, "2026-03-02T00:00:00Z");
    expect((await commissionOf(database, invoice))?.commission_rate_bps).toBe(3000);
  });

  it("招待した人が自分の契約を解約しても、報酬は受け取れる", async (ctx) => {
    if (!database) return ctx.skip();
    const { account, referred } = await pair(database);
    /*
      報酬の判定は**招待アカウントの状態**（active/suspended）と被招待者の支払いだけで、
      **招待者自身の契約状態は見ない**。招待して解約した人の報酬が黙って止まると、
      「払ったのに入らない」型の苦情になる。
    */
    await database.query(
      `update profiles set subscription_status = 'canceled', plan = null where id = $1`,
      [
        (
          await database.query<{ user_id: string }>(
            `select user_id from affiliate_accounts where id = $1`,
            [account.id],
          )
        ).rows[0]!.user_id,
      ],
    );
    const { result, invoice } = await pay(database, referred, 3980, "2026-03-01T00:00:00Z");
    expect(result).toBe("created");
    expect((await commissionOf(database, invoice))?.commission_amount).toBe(1194);
  });
});
