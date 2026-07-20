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
    const { rows } = await client.query<{ typname: string; value: string }>(
      `select t.typname, e.enumlabel as value
         from pg_type t
         join pg_enum e on e.enumtypid = t.oid
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

  it("has all 23 enums with the exact expected values and order", async (ctx) => {
    if (!db) {
      ctx.skip();
      return;
    }
    const actual = await fetchEnumValues(db);
    const names = Object.keys(DB_ENUMS) as DbEnumName[];
    expect(names).toHaveLength(23);
    for (const name of names) {
      expect(actual.get(name), `enum ${name} missing from pg_type`).toEqual([
        ...DB_ENUMS[name],
      ]);
    }
  });
});
