import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closePool, getPool, withTransaction } from "@/lib/db/pool";

import { loadRequestProfile } from "./request-profile-server";

/**
 * 利用者まわりの1行（T-M8-288）を実DBで固定する。
 *
 * **1文へ束ねたので、書き損じると複数の表示がまとめて壊れる**——契約バナー・再同意・
 * 利用枠・Xキー状態・通知の未読数が同時に消える形になり、しかも例外が出ないので気付けない
 * （data-server.ts が過去に踏んだのと同じ型）。left join・スカラーサブクエリが
 * 「行が無い」「関連が無い」で何を返すかを、ここで明示的に確かめる。
 */
describe("loadRequestProfile (local DB)", () => {
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

  async function seed(): Promise<string> {
    const uid = randomUUID();
    await withTransaction(async (c) => {
      await c.query(
        `insert into auth.users (id, instance_id, aud, role, email)
         values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2)`,
        [uid, `${uid}@example.com`],
      );
      await c.query(
        `insert into profiles (id, email, plan, subscription_status)
         values ($1,$2,'premium','active')
         on conflict (id) do update set plan = 'premium', subscription_status = 'active'`,
        [uid, `${uid}@example.com`],
      );
    });
    return uid;
  }

  // usage_counters は on delete restrict の台帳なので、先に消してから利用者を消す。
  const cleanup = (uid: string) =>
    withTransaction(async (c) => {
      await c.query(`delete from usage_counters where user_id = $1`, [uid]);
      await c.query(`delete from auth.users where id = $1`, [uid]);
    });

  it("行が無ければ null（「取得できなかった」ではなく「未作成」）", async () => {
    expect(await loadRequestProfile(randomUUID())).toBeNull();
  });

  it("関連が1つも無くても既定値で返る（カウンタ未作成・キー未登録・未読0）", async () => {
    const uid = await seed();
    try {
      const bundle = await loadRequestProfile(uid);
      expect(bundle).not.toBeNull();
      expect(bundle!.plan).toBe("premium");
      expect(bundle!.subscription_status).toBe("active");
      // left join / スカラーサブクエリが行を消したり増やしたりしないこと。
      expect(bundle!.normal_posts_count).toBe(0);
      expect(bundle!.url_posts_count).toBe(0);
      expect(bundle!.ai_credits_used).toBe(0);
      expect(bundle!.x_api_key_status).toBeNull();
      expect(bundle!.unread_count).toBe(0);
    } finally {
      await cleanup(uid);
    }
  });

  it("Xキー・未読通知・利用枠カウンタを同じ1行から返す", async () => {
    const uid = await seed();
    try {
      await withTransaction(async (c) => {
        await c.query(
          `insert into user_api_keys (user_id, provider, credentials_ciphertext, status)
           values ($1,'x','sealed','valid')`,
          [uid],
        );
        // 未読2件＋既読1件＋アプリ内無効1件（数えるのは未読かつ in_app のみ）。
        await c.query(
          `insert into notifications (user_id, type, title, body, in_app_enabled, read_at)
           values ($1,'summary','a','a',true,null),
                  ($1,'summary','b','b',true,null),
                  ($1,'summary','c','c',true,now()),
                  ($1,'summary','d','d',false,null)`,
          [uid],
        );
        const { rows } = await c.query<{ key: string }>(
          `select coalesce(to_char((current_period_start at time zone 'Asia/Tokyo'),'YYYY-MM-DD'),
                           to_char((now() at time zone 'Asia/Tokyo'),'YYYY-MM')) as key
             from profiles where id = $1`,
          [uid],
        );
        await c.query(
          `insert into usage_counters (user_id, month, normal_posts_count, url_posts_count, ai_credits_used)
           values ($1,$2,7,2,120)`,
          [uid, rows[0].key],
        );
      });

      const bundle = await loadRequestProfile(uid);
      expect(bundle!.x_api_key_status).toBe("valid");
      expect(bundle!.unread_count).toBe(2);
      expect(bundle!.normal_posts_count).toBe(7);
      expect(bundle!.url_posts_count).toBe(2);
      expect(bundle!.ai_credits_used).toBe(120);
    } finally {
      await cleanup(uid);
    }
  });
});
