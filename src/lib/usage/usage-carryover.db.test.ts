import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closePool, getPool, withTransaction } from "@/lib/db/pool";

import { carryOverUsage } from "./usage-carryover";

/**
 * 超過分の繰り越し（T-M8-324・運営者の指示「翌月初にはマイナス分は引かれた状態でリセット」）。
 *
 * 予約をやめたので走り出した生成は最後まで通り、使用量が上限を超えうる。
 * **超過を無かったことにすると、期間の変わり目に毎回チャラになって上限が効かなくなる。**
 */
describe("超過分の繰り越し（local DB）", () => {
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

  /** 契約期間の開始を指定して利用者を作る（期間キーはこの日付から決まる）。 */
  async function seed(periodStart: string): Promise<string> {
    const uid = randomUUID();
    await withTransaction(async (c) => {
      await c.query(
        `insert into auth.users (id, instance_id, aud, role, email)
         values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2)`,
        [uid, `${uid}@example.com`],
      );
      await c.query(
        `insert into profiles (id, email, plan, subscription_status, current_period_start)
         values ($1,$2,'premium','active',$3::timestamptz)
         on conflict (id) do update set current_period_start = $3::timestamptz`,
        [uid, `${uid}@example.com`, periodStart],
      );
    });
    return uid;
  }

  const setPeriodStart = (uid: string, iso: string) =>
    withTransaction((c) =>
      c.query(`update profiles set current_period_start = $2::timestamptz where id = $1`, [uid, iso]),
    );

  const usedNow = async (uid: string): Promise<number> =>
    (
      await withTransaction((c) =>
        c.query<{ n: number }>(
          `select ai_credits_used as n from usage_counters where user_id = $1 order by month desc limit 1`,
          [uid],
        ),
      )
    ).rows[0]?.n ?? 0;

  const cleanup = (uid: string) =>
    withTransaction(async (c) => {
      await c.query(`delete from usage_counters where user_id = $1`, [uid]);
      await c.query(`delete from auth.users where id = $1`, [uid]);
    });

  it("上限を超えたぶんだけを次の期間へ持ち越す", async () => {
    const uid = await seed("2026-07-01T00:00:00Z");
    try {
      // 前期: 上限100,000に対し105,000使った
      await withTransaction((c) =>
        c.query(
          `insert into usage_counters (user_id, month, ai_credits_used) values ($1, '2026-07-01', 105000)`,
          [uid],
        ),
      );
      await setPeriodStart(uid, "2026-08-01T00:00:00Z");
      const carried = await withTransaction((c) => carryOverUsage(c, { userId: uid, limit: 100_000 }));
      expect(carried, "超過5,000が持ち越されていない").toBe(5_000);
      expect(await usedNow(uid)).toBe(5_000);
    } finally {
      await cleanup(uid);
    }
  });

  it("上限内で終えた期間は0から始まる（使い残しは繰り越さない）", async () => {
    const uid = await seed("2026-07-01T00:00:00Z");
    try {
      await withTransaction((c) =>
        c.query(
          `insert into usage_counters (user_id, month, ai_credits_used) values ($1, '2026-07-01', 40000)`,
          [uid],
        ),
      );
      await setPeriodStart(uid, "2026-08-01T00:00:00Z");
      expect(await withTransaction((c) => carryOverUsage(c, { userId: uid, limit: 100_000 }))).toBe(0);
      expect(await usedNow(uid)).toBe(0);
    } finally {
      await cleanup(uid);
    }
  });

  it("同じ期間で二度呼んでも積み増さない（初回作成のときだけ持ち込む）", async () => {
    const uid = await seed("2026-07-01T00:00:00Z");
    try {
      await withTransaction((c) =>
        c.query(
          `insert into usage_counters (user_id, month, ai_credits_used) values ($1, '2026-07-01', 130000)`,
          [uid],
        ),
      );
      await setPeriodStart(uid, "2026-08-01T00:00:00Z");
      await withTransaction((c) => carryOverUsage(c, { userId: uid, limit: 100_000 }));
      // 2回目は何もしない（既に今期の行がある）
      expect(await withTransaction((c) => carryOverUsage(c, { userId: uid, limit: 100_000 }))).toBe(0);
      expect(await usedNow(uid), "繰り越しが二重に入っている").toBe(30_000);
    } finally {
      await cleanup(uid);
    }
  });
});
