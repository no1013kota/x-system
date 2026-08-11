import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DB_ENUMS, type DbEnumName } from "./enums";
import { connectLocalDb } from "./test-utils";

/**
 * Verifies every enum in DB_ENUMS exists in pg_type with exactly the expected
 * values, in order (要件02 §2, T-M0-03). Skips when the local Supabase stack is
 * not running so the unit suite still passes without Docker.
 */
describe("Postgres enum types match DB_ENUMS", () => {
  let db: Client | null = null;

  beforeAll(async () => {
    db = await connectLocalDb();
  });

  afterAll(async () => {
    await db?.end();
  });

  async function fetchEnumValues(client: Client): Promise<Map<string, string[]>> {
    // **`public` に絞る**（R29）。Supabase は auth / storage / realtime / net にも enum を持ち、
    // 絞らないと同名の内部型を拾って別物の値と比べうる（実測: public 23・その他 13）。
    const { rows } = await client.query<{ typname: string; value: string }>(
      `select t.typname, e.enumlabel as value
         from pg_type t
         join pg_enum e on e.enumtypid = t.oid
         join pg_namespace n on n.oid = t.typnamespace
        where n.nspname = 'public'
        order by t.typname, e.enumsortorder`,
    );
    const map = new Map<string, string[]>();
    for (const { typname, value } of rows) {
      const list = map.get(typname) ?? [];
      list.push(value);
      map.set(typname, list);
    }
    return map;
  }

  it("every enum in DB_ENUMS exists in Postgres with the exact values and order", async (ctx) => {
    if (!db) {
      ctx.skip();
      return;
    }
    const actual = await fetchEnumValues(db);
    for (const name of Object.keys(DB_ENUMS) as DbEnumName[]) {
      expect(actual.get(name), `enum ${name} missing from pg_type`).toEqual([
        ...DB_ENUMS[name],
      ]);
    }
  });

  /**
   * **逆方向**（R29）。以前は `DB_ENUMS` 側からしか見ておらず、件数ガードも
   * `toHaveLength(23)` という魔法数だった。migration で enum を足して `DB_ENUMS` へ
   * 書き忘れると、TS側は古い値集合のまま**画面には出ないのに保存で落ちる**状態になる。
   * 件数ではなく「DBにあって TS に無い型名」を出して落とす。
   */
  it("has no Postgres enum that DB_ENUMS does not know about", async (ctx) => {
    if (!db) {
      ctx.skip();
      return;
    }
    const actual = await fetchEnumValues(db);
    const known = new Set(Object.keys(DB_ENUMS));
    const unknown = [...actual.keys()].filter((name) => !known.has(name)).sort();
    expect(unknown, "これらの enum を src/lib/db/enums.ts へ追加してください").toEqual([]);
  });
});
