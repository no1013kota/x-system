import { randomBytes, randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { encryptWithKey } from "../crypto/envelope";
import { closePool, getPool, withTransaction } from "../db/pool";
import { X_SCOPES } from "../x/oauth";
import type { Queryable } from "../x/token-refresh";
import { deliverDailySummaries, SUMMARY_HOUR_JST } from "./daily-summary";

/**
 * 日次サマリの配信（T-M7-29）を実DBで検証する。1日1通であること（tickは5分ごとに走る）と、
 * 通知設定を尊重することを見る。DB・Supabaseクライアントはモックしない。
 */
describe("deliverDailySummaries (local DB)", () => {
  let available = false;
  const db: Queryable = {
    query: <T = unknown>(sql: string, params?: unknown[]) =>
      getPool().query(sql, params) as unknown as Promise<{ rows: T[]; rowCount: number | null }>,
  };

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

  const testKey = randomBytes(32);

  /** Xアカウントを連携済みの利用者を作る（未連携にはサマリを届けない仕様のため）。 */
  async function makeUser(c: PoolClient, config?: Record<string, unknown>): Promise<string> {
    const uid = randomUUID();
    await c.query(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2)`,
      [uid, `${uid}@example.com`],
    );
    // profiles は auth.users のトリガーで自動作成されるため update で設定する。
    await c.query(`update profiles set notification_config = $2::jsonb where id = $1`, [
      uid,
      JSON.stringify(config ?? {}),
    ]);
    await c.query(
      `insert into x_accounts
         (user_id, x_user_id, handle, name, auth_type, status,
          access_token_ciphertext, refresh_token_ciphertext, oauth_scopes, token_expires_at)
       values ($1,$2,'h','n','byok','active',$3,$3,$4, now() + interval '1 hour')`,
      [uid, `x-${randomUUID()}`, encryptWithKey("t", testKey), X_SCOPES],
    );
    return uid;
  }

  /** Xアカウント未連携の利用者。 */
  async function makeUserWithoutAccount(c: PoolClient): Promise<string> {
    const uid = randomUUID();
    await c.query(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2)`,
      [uid, `${uid}@example.com`],
    );
    return uid;
  }

  /**
   * この日（2026-08-01 JST）のサマリだけを見る（T-M8-30）。
   *
   * **利用者IDだけで絞ると他のテストの分を拾う。** `jobs/cron.ts` の tick は
   * `deliverDailySummaries` を**利用者を絞らず現在時刻で**呼ぶので、tickを実際に走らせる
   * DBテスト（`cron.db.test.ts` / `scheduler-tick/route.db.test.ts`）と並行すると、
   * ここで作った利用者にも「今日」のサマリが1通増える。日付で絞れば影響を受けない。
   */
  const TARGET_DEDUPE_KEY = "summary:2026-08-01";

  async function summariesOf(uid: string) {
    const { rows } = await db.query<{ title: string; body: string; in_app_enabled: boolean }>(
      `select title, body, in_app_enabled
         from notifications
        where user_id = $1 and type = 'summary' and dedupe_key = $2
        order by created_at`,
      [uid, TARGET_DEDUPE_KEY],
    );
    return rows;
  }

  /** JST 2026-08-01 の指定時刻に対応するUTCのISO文字列（JST = UTC+9）。 */
  const jstAt = (hour: number) =>
    new Date(Date.UTC(2026, 7, 1, hour, 0, 0) - 9 * 3_600_000).toISOString();

  it("JST8時以降に1通だけ作り、同じ日に何度呼んでも増えない", async () => {
    const uid = await withTransaction((c) => makeUser(c));
    try {
      await deliverDailySummaries(db, jstAt(SUMMARY_HOUR_JST), { userIds: [uid] });
      await deliverDailySummaries(db, jstAt(SUMMARY_HOUR_JST + 1), { userIds: [uid] });
      const rows = await summariesOf(uid);
      // 5分ごとのtickから何度呼ばれても、その日は1通だけ（dedupe key）。
      expect(rows).toHaveLength(1);
      // 数字が入っていること（「問題なし」だけで終わらせない）
      expect(rows[0].body).toContain("今月かかった費用");
      expect(rows[0].title).toContain("のまとめ");
    } finally {
      await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));
    }
  });

  it("JST8時より前は作らない", async () => {
    const uid = await withTransaction((c) => makeUser(c));
    try {
      const res = await deliverDailySummaries(db, jstAt(SUMMARY_HOUR_JST - 1), { userIds: [uid] });
      expect(res.created).toBe(0);
      expect(await summariesOf(uid)).toHaveLength(0);
    } finally {
      await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));
    }
  });

  it("アプリ内通知をONにしていれば作る（メールチャネルはT-M8-222で廃止）", async () => {
    const uid = await withTransaction((c) =>
      makeUser(c, { summary: { in_app: true } }),
    );
    try {
      await deliverDailySummaries(db, jstAt(SUMMARY_HOUR_JST), { userIds: [uid] });
      const rows = await summariesOf(uid);
      expect(rows).toHaveLength(1);
      expect(rows[0].in_app_enabled).toBe(true);
    } finally {
      await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));
    }
  });

  it("Xアカウント未連携の利用者には作らない（運用が始まっていない）", async () => {
    const uid = await withTransaction((c) => makeUserWithoutAccount(c));
    try {
      await deliverDailySummaries(db, jstAt(SUMMARY_HOUR_JST), { userIds: [uid] });
      expect(await summariesOf(uid)).toHaveLength(0);
    } finally {
      await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));
    }
  });

  it("アプリ内通知OFFの利用者には作らない", async () => {
    const uid = await withTransaction((c) =>
      makeUser(c, { summary: { in_app: false } }),
    );
    try {
      await deliverDailySummaries(db, jstAt(SUMMARY_HOUR_JST), { userIds: [uid] });
      expect(await summariesOf(uid)).toHaveLength(0);
    } finally {
      await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));
    }
  });

  /**
   * **利用者が増えても黙って途中で終わらない**（T-M8-291）。
   *
   * 1人あたり集計5往復＋作成1往復かかり、`scheduler_tick` の maxDuration は200秒。
   * 上限が無いと利用者が増えたときに打ち切られ、**後半の利用者に届かないまま
   * 「成功」として終わる**（原則1違反）。上限で切った残りは次のtickが拾う。
   */
  it("1回で処理する人数に上限があり、積み残しの人数を返す", async (ctx) => {
    if (!available) return ctx.skip();
    const uids: string[] = [];
    try {
      for (let i = 0; i < 3; i++) uids.push(await withTransaction((c) => makeUser(c)));
      // 対象を自分たちの3人に絞り、上限を2人に見立てて2回に分ける代わりに、
      // 1回目で全員ぶんが作られること＋積み残しが0であることを見る。
      const first = await deliverDailySummaries(db, jstAt(SUMMARY_HOUR_JST), { userIds: uids });
      expect(first.created).toBe(3);
      expect(first.remaining, "全員ぶん作れたなら積み残しは0").toBe(0);

      /*
        **2回目は何も作らない**（その日ぶんは作成済み）。以前は1人ずつ「作ったか？」を
        問い合わせていたので、5分ごとのtickのたびに人数ぶんの往復が走っていた。
        いまは対象抽出の時点で除かれるので、対象0人＝積み残しも0になる。
      */
      const second = await deliverDailySummaries(db, jstAt(SUMMARY_HOUR_JST), { userIds: uids });
      expect(second.created).toBe(0);
      expect(second.remaining, "作成済みの人は対象にも積み残しにも数えない").toBe(0);
    } finally {
      for (const uid of uids) {
        await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));
      }
    }
  });

  it("JSTの配信時刻より前は何もせず、積み残しも0で返す", async (ctx) => {
    if (!available) return ctx.skip();
    const uid = await withTransaction((c) => makeUser(c));
    try {
      const res = await deliverDailySummaries(db, jstAt(SUMMARY_HOUR_JST - 1), { userIds: [uid] });
      expect(res).toEqual({ created: 0, createdIds: [], remaining: 0 });
    } finally {
      await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));
    }
  });
});
