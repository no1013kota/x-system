import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closePool, getPool, withTransaction } from "@/lib/db/pool";

import { attributeSignup, ensureAffiliateAccount, recordCommissionForInvoice } from "./store";
import { loadInviteSummary } from "./summary-server";

/**
 * 招待画面に出る数（T-M8-351・運営者の指示 2026-08-28）。**本番実装をそのまま通す。**
 *
 * ここで守りたいのは1つ: **画面に出ている人数・状態が、実際に率を決める条件と同じであること**。
 * 食い違うと「35%と出ているのに30%で報酬が付く」という、利用者からは説明できない状態になる
 * （原則1）。率そのものの計算は `lifecycle.db.test.ts`、ここは**画面へ渡す値**を見る。
 *
 * `loadInviteSummary` は pool から読むので、テストも**実際にcommitして**作る
 * （transactionの中で作った行はpoolからは見えない）。後始末は finally で必ず消す。
 */
describe("招待画面のサマリ（db）", () => {
  let available = false;

  beforeAll(async () => {
    try {
      const c = await getPool().connect();
      c.release();
      available = true;
    } catch {
      available = false;
    }
  });
  afterAll(async () => {
    await closePool();
  });
  beforeEach((ctx) => {
    if (!available) ctx.skip();
  });

  async function makeUser(status: "active" | "trialing" | "canceled"): Promise<string> {
    const id = randomUUID();
    await withTransaction(async (c) => {
      await c.query(
        `insert into auth.users (id, instance_id, aud, role, email)
         values ($1, '00000000-0000-0000-0000-000000000000',
                 'authenticated', 'authenticated', $2)`,
        [id, `${id}@example.com`],
      );
      await c.query(
        `update profiles set subscription_status = $2::subscription_status where id = $1`,
        [id, status],
      );
    });
    return id;
  }

  it("Trial中は数に入り、Trial中に解約した人は「解約済み」で数から外れる", async () => {
    const inviter = await makeUser("active");
    const created: string[] = [inviter];
    try {
      const account = await withTransaction((c) => ensureAffiliateAccount(c, inviter));

      // 課金した1人・Trial中の1人・Trial中に解約した1人。
      const paidUser = await makeUser("active");
      const trialUser = await makeUser("trialing");
      const churnedTrial = await makeUser("canceled");
      created.push(paidUser, trialUser, churnedTrial);
      for (const u of [paidUser, trialUser, churnedTrial]) {
        await withTransaction((c) => attributeSignup(c, { code: account.code, newUserId: u }));
      }
      await withTransaction((c) =>
        recordCommissionForInvoice(c, {
          referredUserId: paidUser,
          stripeInvoiceId: `in_${randomUUID()}`,
          amountPaid: 10000,
          paidAtSec: Math.floor(new Date("2026-03-01T00:00:00Z").getTime() / 1000),
        }),
      );

      const summary = await loadInviteSummary(inviter);
      expect(summary.paidReferralCount, "課金1人＋Trial1人。解約した1人は数えない").toBe(2);

      // 3人がそれぞれ別の状態で並ぶ（人数が減った理由を一覧から辿れるように）。
      const statuses = summary.invitedUsers.map((row) => row.status).sort();
      expect(
        statuses,
        "Trial中に解約した人は解約済みとして出す（報酬期間は始まっていない）",
      ).toEqual(["cancelled", "paid", "trial"]);
      const paid = summary.invitedUsers.find((row) => row.status === "paid");
      expect(paid?.totalCommission, "課金した人には報酬が付いている").toBeGreaterThan(0);
    } finally {
      // profiles / affiliate_* は auth.users へ cascade する。
      await withTransaction((c) =>
        c.query(`delete from auth.users where id = any($1::uuid[])`, [created]),
      );
    }
  });
});
