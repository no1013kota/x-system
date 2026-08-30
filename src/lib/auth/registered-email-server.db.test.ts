import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closePool, getPool, withTransaction } from "../db/pool";

import { confirmLegacyUnconfirmedEmail, isRegisteredEmail } from "./registered-email-server";

/**
 * 未確認アカウントのログイン時確認（T-M8-377）の実DB検証。
 *
 * 新規登録は確認なしで完了する設定なのに、設定変更前に登録された未確認アカウントは
 * ログインで6桁コード画面へ回されていた（運営者の指摘 2026-08-30）。
 * この関数がログイン試行の前に確認済みへ揃えることで、コード画面の分岐へ入らなくなる。
 */
describe("confirmLegacyUnconfirmedEmail（db）", () => {
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

  it("未確認のアカウントを確認済みへ揃える（大文字小文字は無視）", async () => {
    if (!available) return;
    const { email } = await makeUser(false);
    expect(await confirmLegacyUnconfirmedEmail(email.toUpperCase())).toBe(true);
    const { rows } = await getPool().query<{ confirmed: boolean }>(
      `select email_confirmed_at is not null as confirmed from auth.users where email = $1`,
      [email],
    );
    expect(rows[0]?.confirmed).toBe(true);
    // 2回目は対象なし（冪等・確認日時を上書きしない）。
    expect(await confirmLegacyUnconfirmedEmail(email)).toBe(false);
  });

  it("確認済み・存在しないメールには何もしない", async () => {
    if (!available) return;
    const { email } = await makeUser(true);
    expect(await confirmLegacyUnconfirmedEmail(email)).toBe(false);
    expect(await confirmLegacyUnconfirmedEmail(`none-${randomUUID()}@example.com`)).toBe(false);
    expect(await isRegisteredEmail(email)).toBe(true);
  });
});
