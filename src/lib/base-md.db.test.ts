import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyRollbackBaseMd, applyUpdateBaseMdManual } from "./base-md";
import { BASE_MD_HISTORY_LIMIT } from "./base-md-history";
import { closePool, getPool, withTransaction } from "./db/pool";
import { AppError } from "./observability/errors";

/**
 * DB integration tests for base_md manual edit / rollback (M-1, T-M5-08, 要件05 §8/§9, 要件02 §3.4).
 * Skips without the local Supabase stack.
 */
const V1 = `# 発信定義書

## 1. ペルソナ
- v1

## 2. 発信テーマ
- t

## 3. トーン&マナー
- です・ます

## 4. やらないこと
- 煽らない

## 5. 参考にする型
v1-5
`;
const V2 = V1.replace("v1-5", "v2-5").replace("- v1", "- v2");

describe("base_md manual edit / rollback (db)", () => {
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

  async function seed(
    c: PoolClient,
    plan: string | null,
  ): Promise<{ uid: string; xid: string }> {
    const uid = randomUUID();
    await c.query(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2)`,
      [uid, `${uid}@example.com`],
    );
    // auth.users 挿入時にトリガーが profiles(plan=standard) を自動生成し得るため do update で plan を確定する。
    await c.query(
      `insert into profiles (id, email, plan) values ($1,$2,$3::plan_type)
       on conflict (id) do update set plan = excluded.plan`,
      [uid, `${uid}@example.com`, plan],
    );
    const xid = (
      await c.query<{ id: string }>(
        `insert into x_accounts (user_id, x_user_id, handle, name, auth_type, base_md, base_md_version)
         values ($1,$2,'h','n','byok',$3,2) returning id`,
        [uid, `x-${randomUUID()}`, V2],
      )
    ).rows[0].id;
    await c.query(`update profiles set active_x_account_id = $1 where id = $2`, [xid, uid]);
    // 履歴 v1, v2
    await c.query(
      `insert into base_md_versions (x_account_id, version, content, change_source)
       values ($1,1,$2,'settings'), ($1,2,$3,'manual')`,
      [xid, V1, V2],
    );
    return { uid, xid };
  }

  async function reject(p: Promise<unknown>): Promise<AppError> {
    try {
      await p;
    } catch (e) {
      return e as AppError;
    }
    throw new Error("expected rejection");
  }

  const cleanup = async (uid: string, xid: string) => {
    await withTransaction((c) => c.query(`delete from base_md_versions where x_account_id = $1`, [xid]));
    await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));
  };

  it("md plan: updates base_md + version + base_md_versions(manual) atomically", async () => {
    const { uid, xid } = await withTransaction((c) => seed(c, "standard"));
    try {
      const V3 = V2.replace("v2-5", "v3-5");
      const res = await withTransaction((c) =>
        applyUpdateBaseMdManual(c, { userId: uid, xAccountId: xid, content: V3, expectedVersion: 2 }),
      );
      expect(res.version).toBe(3);
      const acct = (
        await withTransaction((c) =>
          c.query<{ base_md: string; base_md_version: number }>(`select base_md, base_md_version from x_accounts where id=$1`, [xid]),
        )
      ).rows[0];
      expect(acct.base_md_version).toBe(3);
      expect(acct.base_md).toContain("v3-5");
      const ver = (
        await withTransaction((c) =>
          c.query<{ change_source: string }>(`select change_source from base_md_versions where x_account_id=$1 and version=3`, [xid]),
        )
      ).rows[0];
      expect(ver.change_source).toBe("manual");
    } finally {
      await cleanup(uid, xid);
    }
  });

  // 旧standard（編集不可プラン）はT-M8-168で撤廃。編集を拒否されるのは未契約（plan null）だけになった。
  it("未契約（plan null）: forbidden", async () => {
    const { uid, xid } = await withTransaction((c) => seed(c, null));
    try {
      const e = await reject(
        withTransaction((c) => applyUpdateBaseMdManual(c, { userId: uid, xAccountId: xid, content: V2, expectedVersion: 2 })),
      );
      expect(e.code).toBe("forbidden");
    } finally {
      await cleanup(uid, xid);
    }
  });

  it("version mismatch: job_conflict (409)", async () => {
    const { uid, xid } = await withTransaction((c) => seed(c, "premium"));
    try {
      const e = await reject(
        withTransaction((c) => applyUpdateBaseMdManual(c, { userId: uid, xAccountId: xid, content: V2, expectedVersion: 1 })),
      );
      expect(e.code).toBe("job_conflict");
      expect(e.details?.reason).toBe("base_md_version_changed");
    } finally {
      await cleanup(uid, xid);
    }
  });

  it("learning_analysis running: job_conflict", async () => {
    const { uid, xid } = await withTransaction((c) => seed(c, "standard"));
    try {
      await withTransaction((c) =>
        c.query(
          `insert into generation_jobs (x_account_id, kind, trigger, status) values ($1,'learning_analysis','manual','running')`,
          [xid],
        ),
      );
      const e = await reject(
        withTransaction((c) => applyUpdateBaseMdManual(c, { userId: uid, xAccountId: xid, content: V2, expectedVersion: 2 })),
      );
      expect(e.code).toBe("job_conflict");
      expect(e.details?.reason).toBe("base_md_learning_in_progress");
    } finally {
      await cleanup(uid, xid);
    }
  });

  it("rollback: creates a new version with the target's content (history untouched)", async () => {
    const { uid, xid } = await withTransaction((c) => seed(c, "premium"));
    try {
      const res = await withTransaction((c) =>
        applyRollbackBaseMd(c, { userId: uid, xAccountId: xid, targetVersion: 1, expectedVersion: 2 }),
      );
      expect(res.version).toBe(3);
      const acct = (
        await withTransaction((c) =>
          c.query<{ base_md: string; base_md_version: number }>(`select base_md, base_md_version from x_accounts where id=$1`, [xid]),
        )
      ).rows[0];
      expect(acct.base_md_version).toBe(3);
      expect(acct.base_md).toContain("v1-5"); // v1 content restored
      // history v1/v2 unchanged, new v3 = rollback
      const rows = (
        await withTransaction((c) =>
          c.query<{ version: number; change_source: string }>(`select version, change_source from base_md_versions where x_account_id=$1 order by version`, [xid]),
        )
      ).rows;
      expect(rows.map((r) => `${r.version}:${r.change_source}`)).toEqual(["1:settings", "2:manual", "3:rollback"]);
    } finally {
      await cleanup(uid, xid);
    }
  });

  /**
   * 履歴は1アカウント最大 `BASE_MD_HISTORY_LIMIT` 版（T-M8-156）。
   *
   * `base_md_versions` は版ごとにアカウント.md全文を持つのに削除経路が無く、`md_merge` が
   * 自動で積むため無制限に増えていた。**版を積んだのと同じtxで刈り込む**ので、
   * ここが緑でなくなったら費用の上限が外れたということ。
   */
  it(`履歴は最新${BASE_MD_HISTORY_LIMIT}版だけを残す（古い版は同じtxで消える）`, async () => {
    const { uid, xid } = await withTransaction((c) => seed(c, "premium"));
    try {
      // seed は v1/v2 を作る。上限を超えるまで手動編集で積む。
      for (let expected = 2; expected < 8; expected += 1) {
        await withTransaction((c) =>
          applyUpdateBaseMdManual(c, {
            userId: uid,
            xAccountId: xid,
            content: V1.replace("v1-5", `v1-5 rev${expected}`),
            expectedVersion: expected,
          }),
        );
      }

      const rows = (
        await withTransaction((c) =>
          c.query<{ version: number }>(
            `select version from base_md_versions where x_account_id=$1 order by version desc`,
            [xid],
          ),
        )
      ).rows;

      expect(rows).toHaveLength(BASE_MD_HISTORY_LIMIT);
      // 残るのは最新側。現行versionは8で、8..4 の5件。
      expect(rows.map((r) => r.version)).toEqual([8, 7, 6, 5, 4]);

      // 現行の base_md_version は刈り込みに影響されない。
      const acct = (
        await withTransaction((c) =>
          c.query<{ base_md_version: number }>(
            `select base_md_version from x_accounts where id=$1`,
            [xid],
          ),
        )
      ).rows[0];
      expect(acct.base_md_version).toBe(8);
    } finally {
      await cleanup(uid, xid);
    }
  });
});
