import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closePool, getPool, withTransaction } from "@/lib/db/pool";

import {
  bumpUsageEpochSql,
  restoreUsageEpochSql,
  usagePeriodKeySql,
} from "./usage-period";

/**
 * 利用枠の世代（`usage_epoch`）を実DBで固定する（T-M8-299→T-M8-306）。
 *
 * ここが守るのは2つ。
 *
 * 1. **世代が付いたキーで実際に書けること。** `month` の形式検査は
 *    `^\d{4}-\d{2}(-\d{2})?$` のままだったため、世代が付いた瞬間に check 制約で落ちていた
 *    ——トライアル中に下位プランへ切り替えた利用者は、その後の生成で利用枠を記録できず
 *    **何もできなくなる**。世代を進めた後に利用枠を書くテストが1本も無く、誰にも踏まれずに
 *    通っていた（2026-08-25、実DBで再現して発見）。**キーを作るだけのテストでは足りない。**
 * 2. **上げ直しても枠が増えないこと。** 世代は 0→1→0→1 と同じ番号を行き来するので、
 *    戻った先には消費済みの行が残る。これが「下げてリセット→上げ直す」の往復を閉じる。
 */
describe("利用枠の世代（local DB）", () => {
  let available = false;
  const db = {
    query: <T = unknown>(sql: string, params?: unknown[]) =>
      getPool().query(sql, params) as unknown as Promise<{ rows: T[]; rowCount: number | null }>,
  };

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

  async function seed(): Promise<string> {
    const uid = randomUUID();
    await withTransaction(async (c) => {
      await c.query(
        `insert into auth.users (id, instance_id, aud, role, email)
         values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2)`,
        [uid, `${uid}@example.com`],
      );
      await c.query(
        `insert into profiles (id, email, plan, subscription_status, current_period_start)
         values ($1,$2,'expert','trialing', now())
         on conflict (id) do update
           set plan = 'expert', subscription_status = 'trialing', current_period_start = now()`,
        [uid, `${uid}@example.com`],
      );
    });
    return uid;
  }

  const cleanup = (uid: string) =>
    withTransaction(async (c) => {
      await c.query(`delete from usage_counters where user_id = $1`, [uid]);
      await c.query(`delete from auth.users where id = $1`, [uid]);
    });

  const currentKey = async (uid: string): Promise<string> =>
    (await db.query<{ k: string }>(`select ${usagePeriodKeySql("$1")} as k`, [uid])).rows[0].k;

  const consume = async (uid: string, credits: number): Promise<void> => {
    const key = await currentKey(uid);
    await db.query(
      `insert into usage_counters (user_id, month, ai_credits_used)
       values ($1,$2,$3)
       on conflict (user_id, month)
       do update set ai_credits_used = usage_counters.ai_credits_used + $3`,
      [uid, key, credits],
    );
  };

  const used = async (uid: string): Promise<number> => {
    const key = await currentKey(uid);
    const { rows } = await db.query<{ n: number }>(
      `select coalesce(ai_credits_used, 0)::int as n from usage_counters
        where user_id = $1 and month = $2`,
      [uid, key],
    );
    return rows[0]?.n ?? 0;
  };

  it("世代を進めた後も利用枠を書ける（月の形式検査が世代を弾かない）", async () => {
    const uid = await seed();
    try {
      await db.query(bumpUsageEpochSql("$1"), [uid]);
      expect(await currentKey(uid)).toMatch(/#1$/);
      // ここが check 制約で落ちていた。落ちると利用者は生成が一切できなくなる。
      await expect(consume(uid, 10)).resolves.toBeUndefined();
      expect(await used(uid)).toBe(10);
    } finally {
      await cleanup(uid);
    }
  });

  it("下げてリセット→上げ直す、を繰り返しても枠は増えない", async () => {
    const uid = await seed();
    try {
      await consume(uid, 5000); // 上位プランで使い切る
      await db.query(bumpUsageEpochSql("$1"), [uid]); // 下げる＝リセット（意図した動作）
      expect(await used(uid)).toBe(0);

      await consume(uid, 1000); // 下位プランでも使い切る
      await db.query(restoreUsageEpochSql("$1"), [uid]); // 上げ直す＝巻き戻し
      expect(await used(uid), "上げ直したら元の消費へ戻る").toBe(5000);

      // 2周目: 同じ世代へ戻るので、どちらも使い切り済みのまま。
      await db.query(bumpUsageEpochSql("$1"), [uid]);
      expect(await used(uid), "2周目の下位プランで枠が復活している").toBe(1000);
      await db.query(restoreUsageEpochSql("$1"), [uid]);
      expect(await used(uid)).toBe(5000);
    } finally {
      await cleanup(uid);
    }
  });

  it("下げたことが無い利用者が上げても世代は負にならない", async () => {
    const uid = await seed();
    try {
      await db.query(restoreUsageEpochSql("$1"), [uid]);
      const { rows } = await db.query<{ e: number }>(
        `select usage_epoch as e from profiles where id = $1`,
        [uid],
      );
      expect(rows[0].e).toBe(0);
    } finally {
      await cleanup(uid);
    }
  });
});
