import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { connectLocalDb } from "@/lib/db/test-utils";

import { MIN_PAYOUT_JPY, PAYOUT_FEE_JPY } from "./config";
import { createMonthlyPayouts, markPayoutPaid } from "./payout-store";
import {
  adjustCommissionForInvoiceRefund,
  attributeSignup,
  ensureAffiliateAccount,
  recordCommissionForInvoice,
  settleMatureCommissions,
  terminateAttributionForReferredUser,
} from "./store";

/**
 * 招待プログラムの**アカウント状況を組み合わせた**検証（T-M8-300・運営者の指示 2026-08-25
 * 「複数アカウントを用いて、様々なアカウント状況を仮定して、網羅的かつ完全にテストしてください」）。
 *
 * `store.db.test.ts` が1本の道すじ（帰属→報酬→締め）を通すのに対し、こちらは
 * **境界と組み合わせ**を担当する——停止された招待者、退会した被招待者、
 * ちょうど最低振込額、期間の端、複数の招待者と被招待者が絡む場合など。
 * どれも「金額が静かに間違う」型の不具合が出る場所で、画面には正しく見えてしまう。
 *
 * 実DBのtransaction内で完結させ、最後にrollbackする（他のテストの行を数えないよう、
 * 検査はすべて**自分が作ったIDに限定**する）。
 */
describe("affiliate scenarios (db)", () => {
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

  /**
   * 利用者を1人作る。**契約状態を明示する**（T-M8-351）。
   *
   * 報酬率の人数は `profiles.subscription_status` を見て数えるようになった
   * （Trial中も1人・解約は外す）。既定の `incomplete`（＝申込の途中）のままだと、
   * 支払いが起きているのに誰も数えられず、**テストが現実と食い違う**。
   */
  async function makeUser(
    db: NonNullable<typeof database>,
    status: "active" | "trialing" | "canceled" | "incomplete" = "active",
  ): Promise<string> {
    const id = randomUUID();
    await db.query(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1, '00000000-0000-0000-0000-000000000000',
               'authenticated', 'authenticated', $2)`,
      [id, `${id}@example.com`],
    );
    await db.query(`update profiles set subscription_status = $2::subscription_status where id = $1`, [
      id,
      status,
    ]);
    return id;
  }

  const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

  /** その招待者の報酬だけを読む（他のテストの行を数えない）。 */
  async function commissionsOf(db: NonNullable<typeof database>, accountId: string) {
    const { rows } = await db.query<{
      referred_user_id: string | null;
      eligible_amount: number;
      commission_amount: number;
      commission_rate_bps: number;
      status: string;
      payout_id: string | null;
    }>(
      `select referred_user_id, eligible_amount, commission_amount,
              commission_rate_bps, status, payout_id
         from affiliate_commissions
        where affiliate_account_id = $1
        order by created_at, stripe_invoice_id`,
      [accountId],
    );
    return rows;
  }

  async function addBankAccount(db: NonNullable<typeof database>, accountId: string, status = "active") {
    await db.query(
      `insert into affiliate_payout_accounts
         (affiliate_account_id, bank_name, branch_name, account_number_ciphertext,
          bank_account_last4, account_holder_name, status)
       values ($1, 'テスト銀行', '本店', 'cipher', '1234', 'テスト タロウ', $2)`,
      [accountId, status],
    );
  }

  // ---------------------------------------------------------------- 帰属

  it("停止（suspended）された招待者のコードでは新しい帰属が付かない", async (ctx) => {
    if (!database) return ctx.skip();
    const inviter = await makeUser(database);
    const account = await ensureAffiliateAccount(database, inviter);
    await database.query(`update affiliate_accounts set status = 'suspended' where id = $1`, [
      account.id,
    ]);

    const newcomer = await makeUser(database);
    await attributeSignup(database, { code: account.code, newUserId: newcomer });
    // 停止中は**帰属の行を作らない**（戻り値の区別は下の T-M8-302 のテストが持つ）。
    const { rows } = await database.query<{ n: string }>(
      `select count(*)::text as n from affiliate_attributions where referred_user_id = $1`,
      [newcomer],
    );
    expect(rows[0]?.n).toBe("0");
  });

  it("コードが大文字で届いても帰属する（リンクの転記で崩れても取りこぼさない）", async (ctx) => {
    if (!database) return ctx.skip();
    const inviter = await makeUser(database);
    const account = await ensureAffiliateAccount(database, inviter);
    const newcomer = await makeUser(database);

    expect(
      await attributeSignup(database, { code: account.code.toUpperCase(), newUserId: newcomer }),
    ).toBe("attributed");
  });

  it("1人の招待者が何人でも招待でき、被招待者はそれぞれ1人の招待者に固定される", async (ctx) => {
    if (!database) return ctx.skip();
    const inviterA = await makeUser(database);
    const inviterB = await makeUser(database);
    const accountA = await ensureAffiliateAccount(database, inviterA);
    const accountB = await ensureAffiliateAccount(database, inviterB);

    const [u1, u2, u3] = [await makeUser(database), await makeUser(database), await makeUser(database)];
    expect(await attributeSignup(database, { code: accountA.code, newUserId: u1 })).toBe("attributed");
    expect(await attributeSignup(database, { code: accountA.code, newUserId: u2 })).toBe("attributed");
    expect(await attributeSignup(database, { code: accountB.code, newUserId: u3 })).toBe("attributed");
    // **後から別の招待者のリンクを踏んでも移らない**（登録後変更不可）。
    expect(await attributeSignup(database, { code: accountB.code, newUserId: u1 })).toBe(
      "already_attributed",
    );

    const { rows } = await database.query<{ n: string }>(
      `select count(*)::text as n from affiliate_attributions where affiliate_account_id = $1`,
      [accountA.id],
    );
    expect(rows[0]?.n).toBe("2");
  });

  it("招待された人も招待者になれるが、報酬は多段にならない（孫の課金は親に入らない）", async (ctx) => {
    if (!database) return ctx.skip();
    const top = await makeUser(database);
    const middle = await makeUser(database);
    const bottom = await makeUser(database);
    const topAccount = await ensureAffiliateAccount(database, top);
    await attributeSignup(database, { code: topAccount.code, newUserId: middle });
    const middleAccount = await ensureAffiliateAccount(database, middle);
    await attributeSignup(database, { code: middleAccount.code, newUserId: bottom });

    // 孫（bottom）が課金しても、報酬は直接の招待者（middle）だけに入る。
    await recordCommissionForInvoice(database, {
      referredUserId: bottom,
      stripeInvoiceId: `in_${randomUUID()}`,
      amountPaid: 3980,
      paidAtSec: sec("2026-08-01T00:00:00Z"),
    });
    expect(await commissionsOf(database, middleAccount.id)).toHaveLength(1);
    expect(await commissionsOf(database, topAccount.id)).toHaveLength(0);
  });

  // ---------------------------------------------------------------- 報酬

  it("招待者が停止されると、既存の報酬は残るが新しい報酬は作られない", async (ctx) => {
    if (!database) return ctx.skip();
    const inviter = await makeUser(database);
    const referred = await makeUser(database);
    const account = await ensureAffiliateAccount(database, inviter);
    await attributeSignup(database, { code: account.code, newUserId: referred });

    await recordCommissionForInvoice(database, {
      referredUserId: referred,
      stripeInvoiceId: `in_${randomUUID()}`,
      amountPaid: 3980,
      paidAtSec: sec("2026-08-01T00:00:00Z"),
    });
    await database.query(`update affiliate_accounts set status = 'suspended' where id = $1`, [
      account.id,
    ]);
    const after = await recordCommissionForInvoice(database, {
      referredUserId: referred,
      stripeInvoiceId: `in_${randomUUID()}`,
      amountPaid: 3980,
      paidAtSec: sec("2026-09-01T00:00:00Z"),
    });

    expect(after).toBe("skipped");
    // 停止は「これ以上増やさない」であって、既に確定した分の取り上げではない。
    expect(await commissionsOf(database, account.id)).toHaveLength(1);
  });

  it("報酬期間の終端はちょうどの支払いを含み、その後は含まない（6ヶ月の境界）", async (ctx) => {
    if (!database) return ctx.skip();
    const inviter = await makeUser(database);
    const referred = await makeUser(database);
    const account = await ensureAffiliateAccount(database, inviter);
    await attributeSignup(database, { code: account.code, newUserId: referred });

    const first = "2026-03-01T00:00:00Z";
    await recordCommissionForInvoice(database, {
      referredUserId: referred,
      stripeInvoiceId: `in_${randomUUID()}`,
      amountPaid: 1480,
      paidAtSec: sec(first),
    });
    const { rows } = await database.query<{ ends: string }>(
      `select commission_ends_at as ends from affiliate_attributions where referred_user_id = $1`,
      [referred],
    );
    const endsSec = Math.floor(new Date(rows[0]!.ends).getTime() / 1000);

    // 終端ちょうど＝対象。1秒後＝対象外。
    expect(
      await recordCommissionForInvoice(database, {
        referredUserId: referred,
        stripeInvoiceId: `in_${randomUUID()}`,
        amountPaid: 1480,
        paidAtSec: endsSec,
      }),
    ).toBe("created");
    expect(
      await recordCommissionForInvoice(database, {
        referredUserId: referred,
        stripeInvoiceId: `in_${randomUUID()}`,
        amountPaid: 1480,
        paidAtSec: endsSec + 1,
      }),
    ).toBe("skipped");
  });

  it("解約後に再契約しても報酬は再開しない（終了は一度きり）", async (ctx) => {
    if (!database) return ctx.skip();
    const inviter = await makeUser(database);
    const referred = await makeUser(database);
    const account = await ensureAffiliateAccount(database, inviter);
    await attributeSignup(database, { code: account.code, newUserId: referred });

    await recordCommissionForInvoice(database, {
      referredUserId: referred,
      stripeInvoiceId: `in_${randomUUID()}`,
      amountPaid: 3980,
      paidAtSec: sec("2026-05-01T00:00:00Z"),
    });
    await terminateAttributionForReferredUser(database, referred, "2026-06-01T00:00:00Z");
    // 再契約して払っても、終了日より後なので対象外。
    expect(
      await recordCommissionForInvoice(database, {
        referredUserId: referred,
        stripeInvoiceId: `in_${randomUUID()}`,
        amountPaid: 3980,
        paidAtSec: sec("2026-07-01T00:00:00Z"),
      }),
    ).toBe("skipped");
    expect(await commissionsOf(database, account.id)).toHaveLength(1);
  });

  it("退会した被招待者は率の計算に数えない（履歴の金額は残す）", async (ctx) => {
    if (!database) return ctx.skip();
    const inviter = await makeUser(database);
    const account = await ensureAffiliateAccount(database, inviter);
    const referred: string[] = [];
    for (let i = 0; i < 4; i++) {
      const u = await makeUser(database);
      referred.push(u);
      await attributeSignup(database, { code: account.code, newUserId: u });
      await recordCommissionForInvoice(database, {
        referredUserId: u,
        stripeInvoiceId: `in_${randomUUID()}`,
        amountPaid: 3980,
        paidAtSec: sec("2026-08-01T00:00:00Z"),
      });
    }
    // 4人ぶんあるので、次の1人は5人目＝35%になるはず。
    // ところが1人が退会すると、実在する有料招待は3人なので**5人目にならない**。
    await database.query(`delete from auth.users where id = $1`, [referred[0]]);

    const next = await makeUser(database);
    await attributeSignup(database, { code: account.code, newUserId: next });
    await recordCommissionForInvoice(database, {
      referredUserId: next,
      stripeInvoiceId: `in_${randomUUID()}`,
      amountPaid: 3980,
      paidAtSec: sec("2026-08-02T00:00:00Z"),
    });

    const rows = await commissionsOf(database, account.id);
    const latest = rows.find((r) => r.referred_user_id === next);
    expect(latest?.commission_rate_bps, "退会者を数えて率が上がってはいけない").toBe(3000);
    // 退会しても金額の履歴は消えない（referred_user_id だけ null になる）。
    expect(rows.filter((r) => r.referred_user_id === null)).toHaveLength(1);
  });

  /**
   * **ランクが上がったら、昔招待した人の「その後の支払い」も新しい率になる**
   * （運営者の質問 2026-08-25「ランクが1つ上がると過去の招待も含めて%が増えるのか」）。
   *
   * 率は**報酬1件ごと**に、そのときの累計有料招待人数で決まる（`recordCommissionForInvoice`）。
   * つまり「過去の招待者」も報酬期間（6ヶ月）のあいだ払い続けるかぎり、新しい率が乗る。
   * 一方、**すでに作られた報酬の率は書き換わらない**（snapshot）。この2つは別の話。
   */
  it("ランクが上がると、先に招待した人の次の支払いも新しい率になる", async (ctx) => {
    if (!database) return ctx.skip();
    const inviter = await makeUser(database);
    const account = await ensureAffiliateAccount(database, inviter);

    // 1人目を招待して1回目の支払い（このとき30%）。
    const first = await makeUser(database);
    await attributeSignup(database, { code: account.code, newUserId: first });
    const firstInvoice = `in_${randomUUID()}`;
    await recordCommissionForInvoice(database, {
      referredUserId: first,
      stripeInvoiceId: firstInvoice,
      amountPaid: 10000,
      paidAtSec: sec("2026-03-01T00:00:00Z"),
    });

    // さらに5人（合計6人）。**6人目から35%**なので、ここでランクが上がる。
    for (let i = 0; i < 5; i++) {
      const u = await makeUser(database);
      await attributeSignup(database, { code: account.code, newUserId: u });
      await recordCommissionForInvoice(database, {
        referredUserId: u,
        stripeInvoiceId: `in_${randomUUID()}`,
        amountPaid: 10000,
        paidAtSec: sec("2026-03-02T00:00:00Z"),
      });
    }

    // **1人目の2回目の支払い**（翌月）。このとき累計は6人なので35%が乗る。
    const secondInvoice = `in_${randomUUID()}`;
    await recordCommissionForInvoice(database, {
      referredUserId: first,
      stripeInvoiceId: secondInvoice,
      amountPaid: 10000,
      paidAtSec: sec("2026-04-01T00:00:00Z"),
    });

    const rows = await commissionsOf(database, account.id);
    const before = rows.find((r) => r.commission_rate_bps === 3000 && r.eligible_amount === 10000);
    expect(before, "1回目は30%のまま残る").toBeTruthy();
    const after = await database.query<{ rate: number; amount: number }>(
      `select commission_rate_bps as rate, commission_amount as amount
         from affiliate_commissions where stripe_invoice_id = $1`,
      [secondInvoice],
    );
    expect(after.rows[0]?.rate, "先に招待した人の2回目の支払いも35%になる").toBe(3500);
    expect(after.rows[0]?.amount).toBe(3500);
    // 1回目の報酬は書き換わっていない（snapshot）。
    const original = await database.query<{ rate: number; amount: number }>(
      `select commission_rate_bps as rate, commission_amount as amount
         from affiliate_commissions where stripe_invoice_id = $1`,
      [firstInvoice],
    );
    expect(original.rows[0]?.rate, "過去に作られた報酬の率は変わらない").toBe(3000);
    expect(original.rows[0]?.amount).toBe(3000);
  });

  it("率のsnapshotは後から率が上がっても過去の報酬を書き換えない", async (ctx) => {
    if (!database) return ctx.skip();
    const inviter = await makeUser(database);
    const account = await ensureAffiliateAccount(database, inviter);
    const first = await makeUser(database);
    await attributeSignup(database, { code: account.code, newUserId: first });
    await recordCommissionForInvoice(database, {
      referredUserId: first,
      stripeInvoiceId: `in_${randomUUID()}`,
      amountPaid: 10000,
      paidAtSec: sec("2026-08-01T00:00:00Z"),
    });

    // 6人目まで増やして率を上げる（区切りは 1〜5 / 6〜10・2026-08-25）。
    let fifth = "";
    for (let i = 0; i < 5; i++) {
      const u = await makeUser(database);
      fifth = u;
      await attributeSignup(database, { code: account.code, newUserId: u });
      await recordCommissionForInvoice(database, {
        referredUserId: u,
        stripeInvoiceId: `in_${randomUUID()}`,
        amountPaid: 10000,
        paidAtSec: sec("2026-08-02T00:00:00Z"),
      });
    }

    /*
      **並び順で特定しない**。transaction の中では `now()` が固定されるので `created_at` は
      全行で同じ値になり、「最後に作った行」を順序では取り出せない（ここで一度間違えた）。
      利用者IDで引く。
    */
    const rows = await commissionsOf(database, account.id);
    const firstRow = rows.find((r) => r.referred_user_id === first);
    const fifthRow = rows.find((r) => r.referred_user_id === fifth);
    expect(firstRow?.commission_rate_bps, "1件目は30%のまま").toBe(3000);
    expect(firstRow?.commission_amount).toBe(3000);
    expect(fifthRow?.commission_rate_bps, "6人目は35%").toBe(3500);
    expect(fifthRow?.commission_amount, "35%で計算される").toBe(3500);
  });

  // ---------------------------------------------------------------- 締め・振込

  it("ちょうど最低振込額なら作られ、1円足りなければ翌月へ繰り越す", async (ctx) => {
    if (!database) return ctx.skip();
    const now = "2026-09-05T00:00:00Z";

    async function inviterWithGross(gross: number) {
      const inviter = await makeUser(database!);
      const account = await ensureAffiliateAccount(database!, inviter);
      await addBankAccount(database!, account.id);
      const referred = await makeUser(database!);
      await attributeSignup(database!, { code: account.code, newUserId: referred });
      // 率30%なので、欲しい報酬額から逆算して支払額を決める。
      await recordCommissionForInvoice(database!, {
        referredUserId: referred,
        stripeInvoiceId: `in_${randomUUID()}`,
        amountPaid: Math.ceil(gross / 0.3),
        paidAtSec: sec("2026-07-01T00:00:00Z"),
      });
      return account.id;
    }

    const exact = await inviterWithGross(MIN_PAYOUT_JPY);
    const short = await inviterWithGross(MIN_PAYOUT_JPY - 1);
    await settleMatureCommissions(database);
    await createMonthlyPayouts(database, now);

    const payoutOf = async (accountId: string) =>
      (
        await database!.query<{ gross_amount: number; fee_amount: number; net_amount: number }>(
          `select gross_amount, fee_amount, net_amount from affiliate_payouts
            where affiliate_account_id = $1`,
          [accountId],
        )
      ).rows;

    const madeExact = await payoutOf(exact);
    expect(madeExact, "ちょうど最低額は作られる").toHaveLength(1);
    // **判定は手数料を引く前**の額で行う（引いた後で判定すると誰も届かなくなる）。
    expect(madeExact[0]!.gross_amount).toBeGreaterThanOrEqual(MIN_PAYOUT_JPY);
    expect(madeExact[0]!.fee_amount).toBe(PAYOUT_FEE_JPY);
    expect(madeExact[0]!.net_amount).toBe(madeExact[0]!.gross_amount - PAYOUT_FEE_JPY);
    expect(await payoutOf(short), "1円足りなければ作らない（繰越）").toHaveLength(0);
  });

  it("口座が無効（disabled）なら振込を作らない——止まっている口座へ送らない", async (ctx) => {
    if (!database) return ctx.skip();
    const inviter = await makeUser(database);
    const account = await ensureAffiliateAccount(database, inviter);
    await addBankAccount(database, account.id, "disabled");
    const referred = await makeUser(database);
    await attributeSignup(database, { code: account.code, newUserId: referred });
    await recordCommissionForInvoice(database, {
      referredUserId: referred,
      stripeInvoiceId: `in_${randomUUID()}`,
      amountPaid: 100000,
      paidAtSec: sec("2026-07-01T00:00:00Z"),
    });
    await settleMatureCommissions(database);
    await createMonthlyPayouts(database, "2026-09-05T00:00:00Z");

    const { rows } = await database.query<{ n: string }>(
      `select count(*)::text as n from affiliate_payouts where affiliate_account_id = $1`,
      [account.id],
    );
    expect(rows[0]?.n).toBe("0");
  });

  it("同じ月に2回流しても振込は1つ（バッチの再実行で二重払いしない）", async (ctx) => {
    if (!database) return ctx.skip();
    const inviter = await makeUser(database);
    const account = await ensureAffiliateAccount(database, inviter);
    await addBankAccount(database, account.id);
    const referred = await makeUser(database);
    await attributeSignup(database, { code: account.code, newUserId: referred });
    await recordCommissionForInvoice(database, {
      referredUserId: referred,
      stripeInvoiceId: `in_${randomUUID()}`,
      amountPaid: 100000,
      paidAtSec: sec("2026-07-01T00:00:00Z"),
    });
    await settleMatureCommissions(database);

    await createMonthlyPayouts(database, "2026-09-05T00:00:00Z");
    await createMonthlyPayouts(database, "2026-09-06T00:00:00Z");

    const { rows } = await database.query<{ n: string }>(
      `select count(*)::text as n from affiliate_payouts where affiliate_account_id = $1`,
      [account.id],
    );
    expect(rows[0]?.n, "複合uniqueで冪等になっているはず").toBe("1");
  });

  it("確認期間中（pending）の報酬は束ねない——返金され得る分を先に払わない", async (ctx) => {
    if (!database) return ctx.skip();
    const inviter = await makeUser(database);
    const account = await ensureAffiliateAccount(database, inviter);
    await addBankAccount(database, account.id);
    const referred = await makeUser(database);
    await attributeSignup(database, { code: account.code, newUserId: referred });
    // **たった今**の支払い＝確認期間が明けていない。
    await recordCommissionForInvoice(database, {
      referredUserId: referred,
      stripeInvoiceId: `in_${randomUUID()}`,
      amountPaid: 100000,
      paidAtSec: Math.floor(Date.now() / 1000),
    });
    await settleMatureCommissions(database);
    await createMonthlyPayouts(database, "2026-09-05T00:00:00Z");

    const rows = await commissionsOf(database, account.id);
    expect(rows[0]?.status).toBe("pending");
    expect(rows[0]?.payout_id).toBeNull();
  });

  it("束ねた後に全額返金されたら、支払記録の直前に取り消される（過払いを防ぐ）", async (ctx) => {
    if (!database) return ctx.skip();
    const inviter = await makeUser(database);
    const account = await ensureAffiliateAccount(database, inviter);
    await addBankAccount(database, account.id);
    const referred = await makeUser(database);
    await attributeSignup(database, { code: account.code, newUserId: referred });
    const invoiceId = `in_${randomUUID()}`;
    await recordCommissionForInvoice(database, {
      referredUserId: referred,
      stripeInvoiceId: invoiceId,
      amountPaid: 100000,
      paidAtSec: sec("2026-07-01T00:00:00Z"),
    });
    await settleMatureCommissions(database);
    await createMonthlyPayouts(database, "2026-09-05T00:00:00Z");
    const payout = (
      await database.query<{ id: string }>(
        `select id from affiliate_payouts where affiliate_account_id = $1`,
        [account.id],
      )
    ).rows[0]!;

    // 束ねたあとに全額返金が届く。
    await adjustCommissionForInvoiceRefund(database, invoiceId, {
      amountRefunded: 100000,
      fullyRefunded: true,
    });
    const paid = await markPayoutPaid(database, payout.id);

    expect(paid, "手取りが残らない振込は「支払った」ことにしない").toBe(false);
    const { rows } = await database.query<{ status: string }>(
      `select status from affiliate_payouts where id = $1`,
      [payout.id],
    );
    expect(rows[0]?.status).toBe("canceled");
  });

  it("複数の招待者が同時に締められても、互いの金額が混ざらない", async (ctx) => {
    if (!database) return ctx.skip();
    const made: { accountId: string; expected: number }[] = [];
    for (const amount of [40000, 60000]) {
      const inviter = await makeUser(database);
      const account = await ensureAffiliateAccount(database, inviter);
      await addBankAccount(database, account.id);
      const referred = await makeUser(database);
      await attributeSignup(database, { code: account.code, newUserId: referred });
      await recordCommissionForInvoice(database, {
        referredUserId: referred,
        stripeInvoiceId: `in_${randomUUID()}`,
        amountPaid: amount,
        paidAtSec: sec("2026-07-01T00:00:00Z"),
      });
      made.push({ accountId: account.id, expected: Math.floor(amount * 0.3) });
    }
    await settleMatureCommissions(database);
    await createMonthlyPayouts(database, "2026-09-05T00:00:00Z");

    for (const { accountId, expected } of made) {
      const { rows } = await database.query<{ gross_amount: number }>(
        `select gross_amount from affiliate_payouts where affiliate_account_id = $1`,
        [accountId],
      );
      expect(rows[0]?.gross_amount, "他の招待者の報酬が混ざっている").toBe(expected);
    }
  });

  // ---------------------------------------------------------------- 運営者が止める（D-40）

  it("停止された招待者のコードは `suspended` を返す（打ち間違いと区別する）", async (ctx) => {
    if (!database) return ctx.skip();
    const inviter = await makeUser(database);
    const account = await ensureAffiliateAccount(database, inviter);
    await database.query(`update affiliate_accounts set status = 'suspended' where id = $1`, [
      account.id,
    ]);
    const newcomer = await makeUser(database);
    /*
      **`unknown_code` と混ぜない**（T-M8-302）。混ぜると、運営者が1人止めるたびに
      登録側のSentryへ「不明なコード」が上がり、本物の取りこぼしが埋もれる。
    */
    expect(await attributeSignup(database, { code: account.code, newUserId: newcomer })).toBe(
      "suspended",
    );
    // 存在しないコードは従来どおり unknown_code。
    expect(
      await attributeSignup(database, { code: "zzzzzzzz", newUserId: await makeUser(database) }),
    ).toBe("unknown_code");
  });

  it("保留（held）にした報酬は振込に束ねられない", async (ctx) => {
    if (!database) return ctx.skip();
    const inviter = await makeUser(database);
    const account = await ensureAffiliateAccount(database, inviter);
    await addBankAccount(database, account.id);
    const referred = await makeUser(database);
    await attributeSignup(database, { code: account.code, newUserId: referred });
    await recordCommissionForInvoice(database, {
      referredUserId: referred,
      stripeInvoiceId: `in_${randomUUID()}`,
      amountPaid: 100000,
      paidAtSec: sec("2026-07-01T00:00:00Z"),
    });
    await settleMatureCommissions(database);
    // 運営者が保留にする（scripts/affiliate-moderate.mjs --hold と同じSQL）。
    await database.query(
      `update affiliate_commissions set status = 'held', payout_id = null
        where affiliate_account_id = $1 and status in ('pending', 'payable')`,
      [account.id],
    );
    await createMonthlyPayouts(database, "2026-09-05T00:00:00Z");

    const { rows } = await database.query<{ n: string }>(
      `select count(*)::text as n from affiliate_payouts where affiliate_account_id = $1`,
      [account.id],
    );
    expect(rows[0]?.n, "保留中の報酬で振込を作ってはいけない").toBe("0");
  });

  it("保留を解除すると、確認期間を過ぎていれば payable・まだなら pending へ戻る", async (ctx) => {
    if (!database) return ctx.skip();
    const inviter = await makeUser(database);
    const account = await ensureAffiliateAccount(database, inviter);
    const old = await makeUser(database);
    const fresh = await makeUser(database);
    await attributeSignup(database, { code: account.code, newUserId: old });
    await attributeSignup(database, { code: account.code, newUserId: fresh });
    // 確認期間を過ぎたもの／まだのもの。
    await recordCommissionForInvoice(database, {
      referredUserId: old,
      stripeInvoiceId: `in_${randomUUID()}`,
      amountPaid: 10000,
      paidAtSec: sec("2026-07-01T00:00:00Z"),
    });
    await recordCommissionForInvoice(database, {
      referredUserId: fresh,
      stripeInvoiceId: `in_${randomUUID()}`,
      amountPaid: 10000,
      paidAtSec: Math.floor(Date.now() / 1000),
    });
    await database.query(
      `update affiliate_commissions set status = 'held' where affiliate_account_id = $1`,
      [account.id],
    );
    // 解除（--release と同じSQL）。**一律 payable にしない**——確認期間中の分を先に払えてしまう。
    await database.query(
      `update affiliate_commissions
          set status = case when available_at <= now() then 'payable' else 'pending' end
        where affiliate_account_id = $1 and status = 'held'`,
      [account.id],
    );

    const rows = await commissionsOf(database, account.id);
    expect(rows.find((r) => r.referred_user_id === old)?.status).toBe("payable");
    expect(rows.find((r) => r.referred_user_id === fresh)?.status).toBe("pending");
  });
});
