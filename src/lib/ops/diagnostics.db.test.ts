import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closePool, getPool, withTransaction } from "@/lib/db/pool";

import { collectFailurePatterns, judgeRepeatedFailures } from "./diagnostics";

/**
 * 失敗の集計SQLを**実DBで**通す（T-M8-307）。
 *
 * 純粋関数（`judgeRepeatedFailures`）の単体テストは `diagnostics.test.ts` にあるが、
 * **それだけでは今回の種類の不具合は防げない**。2026-08-25 に見つかった T-M8-299 は
 * 「文字列を組み立てる検査」と「DBへ書く検査」が別々にあり、繋ぎ目を誰も通っていなかった
 * ために本番へ出た。ここでは実際のテーブルへ行を入れ、SQLの列名・型・`having` の条件まで通す。
 *
 * 対象の絞り込み（`userIds`）は**テスト用**。共有ローカルDBには他のテストが作った
 * ジョブが残るため、絞らないと件数が他のテストに左右される。
 */
describe("失敗の集計（local DB）", () => {
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

  const db = {
    query: <T = unknown>(sql: string, params?: unknown[]) =>
      getPool().query(sql, params) as unknown as Promise<{ rows: T[]; rowCount: number | null }>,
  };

  /** 利用者1人 ＋ Xアカウント1つ。ジョブは呼び出し側で足す。 */
  async function seedUser(): Promise<{ userId: string; xAccountId: string }> {
    const userId = randomUUID();
    const xAccountId = randomUUID();
    await withTransaction(async (c) => {
      await c.query(
        `insert into auth.users (id, instance_id, aud, role, email)
         values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2)`,
        [userId, `${userId}@example.com`],
      );
      await c.query(
        `insert into profiles (id, email) values ($1,$2) on conflict (id) do nothing`,
        [userId, `${userId}@example.com`],
      );
      await c.query(
        `insert into x_accounts (id, user_id, x_user_id, handle, name, auth_type)
         values ($1,$2,$3,$4,$5,'byok')`,
        [xAccountId, userId, `x-${xAccountId}`, `h_${xAccountId.slice(0, 8)}`, "テスト"],
      );
    });
    return { userId, xAccountId };
  }

  async function addJob(
    xAccountId: string,
    status: "succeeded" | "failed",
    message?: string,
  ): Promise<void> {
    await db.query(
      `insert into generation_jobs (x_account_id, kind, trigger, status, error)
       values ($1,'post_publish','manual',$2,
               case when $3::text is null then null
                    else jsonb_build_object('code','job_failed','message',$3::text) end)`,
      [xAccountId, status, message ?? null],
    );
  }

  const cleanup = (userId: string) =>
    withTransaction(async (c) => {
      await c.query(
        `delete from generation_jobs gj using x_accounts xa
          where gj.x_account_id = xa.id and xa.user_id = $1`,
        [userId],
      );
      await c.query(`delete from auth.users where id = $1`, [userId]);
    });

  it("実行が全滅している利用者を数え、運営者向けに error まで上げる", async () => {
    const { userId, xAccountId } = await seedUser();
    try {
      await addJob(xAccountId, "failed", "しばらくしてからもう一度お試しください");
      await addJob(xAccountId, "failed", "しばらくしてからもう一度お試しください");

      const facts = await collectFailurePatterns(db, { userIds: [userId] });
      expect(facts.allFailingUsers).toBe(1);
      expect(facts.groups).toEqual([
        { message: "しばらくしてからもう一度お試しください", count: 2, users: 1 },
      ]);
      // 合計では「失敗2件」でしかない状態が、ここでは error になる。
      expect(judgeRepeatedFailures(facts).level).toBe("error");
    } finally {
      await cleanup(userId);
    }
  });

  it("1件でも成功していれば全滅とは数えない", async () => {
    const { userId, xAccountId } = await seedUser();
    try {
      await addJob(xAccountId, "failed", "画像の生成に失敗しました");
      await addJob(xAccountId, "failed", "画像の生成に失敗しました");
      await addJob(xAccountId, "succeeded");

      const facts = await collectFailurePatterns(db, { userIds: [userId] });
      expect(facts.allFailingUsers).toBe(0);
      expect(facts.groups[0]?.count).toBe(2);
    } finally {
      await cleanup(userId);
    }
  });

  it("失敗が1件だけの利用者は全滅に数えない（普通に起こるため）", async () => {
    const { userId, xAccountId } = await seedUser();
    try {
      await addJob(xAccountId, "failed", "Xへの投稿に失敗しました");
      const facts = await collectFailurePatterns(db, { userIds: [userId] });
      expect(facts.allFailingUsers).toBe(0);
    } finally {
      await cleanup(userId);
    }
  });

  it("理由が記録されていない失敗も数から漏らさない", async () => {
    const { userId, xAccountId } = await seedUser();
    try {
      await addJob(xAccountId, "failed");
      await addJob(xAccountId, "failed");
      const facts = await collectFailurePatterns(db, { userIds: [userId] });
      expect(facts.groups).toEqual([
        { message: "原因が記録されていない失敗", count: 2, users: 1 },
      ]);
    } finally {
      await cleanup(userId);
    }
  });

  it("同じ理由が複数の利用者にまたがれば人数として出る", async () => {
    const a = await seedUser();
    const b = await seedUser();
    try {
      await addJob(a.xAccountId, "failed", "AIの利用残高が不足しています");
      await addJob(b.xAccountId, "failed", "AIの利用残高が不足しています");
      const facts = await collectFailurePatterns(db, { userIds: [a.userId, b.userId] });
      expect(facts.groups).toEqual([
        { message: "AIの利用残高が不足しています", count: 2, users: 2 },
      ]);
    } finally {
      await cleanup(a.userId);
      await cleanup(b.userId);
    }
  });

  it("失敗が無ければ空で返る（0件と失敗を混同しない）", async () => {
    const { userId, xAccountId } = await seedUser();
    try {
      await addJob(xAccountId, "succeeded");
      const facts = await collectFailurePatterns(db, { userIds: [userId] });
      expect(facts.groups).toEqual([]);
      expect(facts.allFailingUsers).toBe(0);
      expect(judgeRepeatedFailures(facts).level).toBe("ok");
    } finally {
      await cleanup(userId);
    }
  });
});
