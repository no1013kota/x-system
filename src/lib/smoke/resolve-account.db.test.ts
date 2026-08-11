import { randomUUID } from "node:crypto";

import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { resolveXAccountId } from "./resolve-account";

/**
 * `resolveXAccountId` の **SQLが実スキーマで通ること**を検証する（T-M7-49）。
 *
 * 単体テスト（`resolve-account.test.ts`）はダミーDBで分岐を網羅するが、**列名の誤りは見えない**
 * （`handle` を `username` と書いても緑になる）。ここで実DBへ当てる。
 *
 * ローカルSupabaseが無い環境では skip する（`REQUIRE_DB=1` なら失敗させる）。
 */

const DB_URL =
  process.env.SUPABASE_DB_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

async function sql<T extends Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const c = new Client({ connectionString: DB_URL, connectionTimeoutMillis: 5000 });
  await c.connect();
  try {
    return (await c.query<T>(text, params)).rows;
  } finally {
    await c.end();
  }
}

/** `resolveXAccountId` が受け取る形の最小アダプタ。 */
const db = {
  async query(text: string, params?: unknown[]) {
    return { rows: await sql(text, params ?? []) };
  },
};

describe("resolveXAccountId（実DB）", () => {
  let available = false;
  const userIds: string[] = [];
  let accountId = "";
  const handle = `smoke_${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    try {
      await sql("select 1");
      available = true;
    } catch {
      if (process.env.REQUIRE_DB === "1") throw new Error("ローカルSupabaseへ接続できません");
      available = false;
    }
    if (!available) return;
    const id = randomUUID();
    userIds.push(id);
    await sql(
      `insert into auth.users (id, email, encrypted_password, email_confirmed_at,
         created_at, updated_at, aud, role)
       values ($1, $2, '', now(), now(), now(), 'authenticated', 'authenticated')`,
      [id, `${id}@example.test`],
    );
    const [row] = await sql<{ id: string }>(
      `insert into x_accounts (user_id, x_user_id, handle, name, auth_type, status)
       values ($1, $2, $3, 'n', 'managed', 'active') returning id`,
      [id, `x-${id}`, handle],
    );
    accountId = row.id;
  });

  afterAll(async () => {
    for (const id of userIds) {
      await sql(`delete from x_accounts where user_id = $1`, [id]).catch(() => []);
      await sql(`delete from auth.users where id = $1`, [id]).catch(() => []);
    }
  });

  // DB未起動時は **skip** する。`return` で抜けると「何も検査せず passed」と数えられ、
  // 検査が動いていないことが件数から分からなくなる（他65本のDBテストと同じ形・R19）。
  beforeEach((ctx) => {
    if (!available) ctx.skip();
  });

  it("ユーザー名から id を引ける（大文字でも）", async () => {
    expect(await resolveXAccountId(handle, { db })).toEqual({ ok: true, id: accountId, handle });
    expect(await resolveXAccountId(`@${handle.toUpperCase()}`, { db })).toEqual({
      ok: true,
      id: accountId,
      handle,
    });
  });

  it("UUIDからも引ける", async () => {
    expect(await resolveXAccountId(accountId, { db })).toEqual({
      ok: true,
      id: accountId,
      handle,
    });
  });

  it("存在しないユーザー名では失敗し、候補を出す", async () => {
    const result = await resolveXAccountId(`missing_${randomUUID().slice(0, 6)}`, { db });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // 候補一覧のSQLも実スキーマで通ること（この分岐だけ別のクエリを使う）。
    expect(result.message).toContain(`@${handle}`);
  });

  it("存在しないUUIDでも落ちずに失敗を返す", async () => {
    const result = await resolveXAccountId(randomUUID(), { db });
    expect(result.ok).toBe(false);
  });
});
