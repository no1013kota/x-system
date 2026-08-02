import { randomUUID } from "node:crypto";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * ホームKPIの集計SQLが**実スキーマで通ること**と、**他の利用者の数字が混ざらないこと**を
 * 検証する（T-M8-05）。列名の誤り（`source` と `posted_mode` を取り違える等）は
 * 純関数のテストでは見えない。
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

async function makeAccount(): Promise<{ userId: string; xAccountId: string }> {
  const uid = randomUUID();
  await sql(
    `insert into auth.users (id, instance_id, aud, role, email)
     values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2)`,
    [uid, `${uid}@example.com`],
  );
  const [row] = await sql<{ id: string }>(
    `insert into x_accounts (user_id, x_user_id, handle, name, auth_type, status)
     values ($1,$2,$3,'n','managed','active') returning id`,
    [uid, `x-${uid}`, `h${uid.slice(0, 8)}`],
  );
  return { userId: uid, xAccountId: row.id };
}

/** 投稿済みの下書きを1件作る。`postedAt` はISO文字列。 */
async function seedPosted(xAccountId: string, postedAt: string, mode: "auto" | "manual") {
  await sql(
    `insert into drafts (x_account_id, pattern, thread, initial_thread, status, posted_at, posted_mode)
     values ($1, 'p1', '[]'::jsonb, '[]'::jsonb, 'posted', $2::timestamptz, $3::posted_mode)`,
    [xAccountId, postedAt, mode],
  );
}

describe("loadPostsThisWeek（実DB）", () => {
  let available = false;
  const userIds: string[] = [];
  let loadPostsThisWeek: typeof import("./kpi-server").loadPostsThisWeek;

  beforeAll(async () => {
    try {
      await sql("select 1");
      available = true;
    } catch {
      if (process.env.REQUIRE_DB === "1") throw new Error("ローカルSupabaseへ接続できません");
      available = false;
    }
    if (available) ({ loadPostsThisWeek } = await import("./kpi-server"));
  });

  afterAll(async () => {
    for (const id of userIds) {
      await sql(`delete from drafts where x_account_id in (select id from x_accounts where user_id = $1)`, [id]).catch(() => []);
      await sql(`delete from x_accounts where user_id = $1`, [id]).catch(() => []);
      await sql(`delete from auth.users where id = $1`, [id]).catch(() => []);
    }
  });

  it("今週の投稿だけを数え、自動の内訳も出す", async () => {
    if (!available) return;
    const a = await makeAccount();
    userIds.push(a.userId);
    // 2026-08-01(土) 12:00Z を「いま」とする。週の始まりは 7/27(月) 0:00 JST。
    const now = new Date("2026-08-01T12:00:00Z");
    await seedPosted(a.xAccountId, "2026-07-28T01:00:00Z", "auto");
    await seedPosted(a.xAccountId, "2026-07-30T01:00:00Z", "manual");
    // 週より前（7/25）は数えない。
    await seedPosted(a.xAccountId, "2026-07-25T01:00:00Z", "auto");

    expect(await loadPostsThisWeek(a.userId, a.xAccountId, now)).toEqual({ total: 2, auto: 1 });
  });

  it("**他の利用者の投稿は数えない**", async () => {
    if (!available) return;
    const a = await makeAccount();
    const b = await makeAccount();
    userIds.push(a.userId, b.userId);
    const now = new Date("2026-08-01T12:00:00Z");
    await seedPosted(b.xAccountId, "2026-07-28T01:00:00Z", "auto");

    expect(await loadPostsThisWeek(a.userId, a.xAccountId, now)).toEqual({ total: 0, auto: 0 });
    // 他人のIDを渡しても、user_id で弾かれるので0になる。
    expect(await loadPostsThisWeek(a.userId, b.xAccountId, now)).toEqual({ total: 0, auto: 0 });
  });
});
