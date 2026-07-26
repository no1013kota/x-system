import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closePool, getPool, withTransaction } from "./pool";

/**
 * `service_role` のテーブル権限（要件02 §1・migration 20260726000002）。
 *
 * RLSポリシーの migration は `authenticated` への SELECT だけを付与し、`service_role` への GRANT が
 * 抜けていた。直結pg（DATABASE_URL）は postgres として繋ぐため気付けず、PostgREST 経由
 * （Supabase admin client）だけが `42501 permission denied` で落ちていた（X連携が internal_error）。
 * 権限はSQLレベルの設定でアプリのテストからは見えないため、ここで直接検査する。
 */
describe("service_role のテーブル権限", () => {
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

  it("public の全テーブルで SELECT/INSERT/UPDATE/DELETE を持つ", async () => {
    const { rows } = await withTransaction((c) =>
      c.query<{ tablename: string; missing: string }>(
        `select t.tablename,
                array_to_string(array(
                  select p from unnest(array['SELECT','INSERT','UPDATE','DELETE']) as p
                   where not exists (
                     select 1 from information_schema.role_table_grants g
                      where g.table_schema = 'public'
                        and g.table_name = t.tablename
                        and g.grantee = 'service_role'
                        and g.privilege_type = p
                   )
                ), ',') as missing
           from pg_tables t
          where t.schemaname = 'public'
          order by t.tablename`,
      ),
    );
    expect(rows.length).toBeGreaterThan(0);
    const incomplete = rows.filter((r) => r.missing !== "");
    expect(
      incomplete.map((r) => `${r.tablename}: ${r.missing} が無い`),
      "service_role の権限が欠けているテーブル",
    ).toEqual([]);
  });

  it("今後追加されるテーブルにも自動で付与される（default privileges）", async () => {
    await withTransaction(async (c) => {
      await c.query(`create table if not exists public.__grant_probe (id int)`);
      const { rows } = await c.query<{ n: string }>(
        `select count(*)::text as n from information_schema.role_table_grants
          where table_schema = 'public' and table_name = '__grant_probe'
            and grantee = 'service_role' and privilege_type = 'SELECT'`,
      );
      // transaction をロールバックするため、probe テーブルは残らない。
      expect(rows[0].n, "新規テーブルへ service_role の SELECT が既定で付く").toBe("1");
      throw new Error("rollback");
    }).catch((e) => {
      if (!(e instanceof Error) || e.message !== "rollback") throw e;
    });
  });
});
