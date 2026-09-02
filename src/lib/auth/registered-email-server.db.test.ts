import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closePool, getPool, withTransaction } from "../db/pool";

import { isRegisteredEmail } from "./registered-email-server";

/**
 * 登録の有無の判定（T-M8-295）の実DB検証。
 *
 * ログイン時の自動確認（T-M8-377）は、新規登録の6桁コード確認を必須へ戻したT-M8-404で
 * 廃止した（残すと「コードを入れずにログイン」で確認を素通りできる）。
 */
describe("isRegisteredEmail（db）", () => {
  let available = false;
  const created: string[] = [];

  beforeAll(async () => {
    try {
      const c = await getPool().connect();
      c.release();
      available = true;
    } catch {
      available = false;
      if (process.env.REQUIRE_DB) throw new Error("DBに接続できません（REQUIRE_DB=1）");
    }
  });
  afterAll(async () => {
    if (available) {
      for (const uid of created) {
        await getPool().query(`delete from auth.users where id = $1`, [uid]);
      }
    }
    await closePool();
  });

  async function makeUser(confirmed: boolean): Promise<{ id: string; email: string }> {
    const id = randomUUID();
    const email = `legacy-${id}@example.com`;
    await withTransaction(async (c) => {
      await c.query(
        `insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at)
         values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,
                 case when $3 then now() end)`,
        [id, email, confirmed],
      );
    });
    created.push(id);
    return { id, email };
  }

  it("登録済み（未確認でも）は true、存在しないメールは false（大文字小文字は無視）", async () => {
    if (!available) return;
    const confirmed = await makeUser(true);
    const unconfirmed = await makeUser(false);
    expect(await isRegisteredEmail(confirmed.email)).toBe(true);
    expect(await isRegisteredEmail(confirmed.email.toUpperCase())).toBe(true);
    // 未確認のままの登録も「登録あり」——ログインでは確認済みへ揃えず、コード画面へ回す（T-M8-404）。
    expect(await isRegisteredEmail(unconfirmed.email)).toBe(true);
    expect(await isRegisteredEmail(`none-${randomUUID()}@example.com`)).toBe(false);
  });
});
