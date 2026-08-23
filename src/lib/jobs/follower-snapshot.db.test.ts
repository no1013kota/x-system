import { randomBytes, randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { encryptWithKey } from "../crypto/envelope";
import { closePool, getPool, withTransaction } from "../db/pool";
import { X_SCOPES } from "../x/oauth";
import type { Queryable } from "../x/token-refresh";
import {
  snapshotFollowerToday,
  type SnapshotFollowerDeps,
} from "./follower-snapshot";

/**
 * DB integration for follower snapshot (K-3, 要件02 §3.11, T-M5-14→T-M8-255):
 * 「分析を開始」からの単一アカウント記録。JST当日のupsert（同日再実行は上書き・行は増えない）、
 * token取得不能/読取不能は理由つきで書かない。X読取は mock を注入（原価台帳は経由しない）。
 */
describe("snapshotFollowerToday (local DB)", () => {
  let available = false;
  const testKey = randomBytes(32);
  const encrypt = (p: string) => encryptWithKey(p, testKey);
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

  async function seedAccount(): Promise<{ uid: string; xid: string; xUserId: string }> {
    return withTransaction(async (c: PoolClient) => {
      const uid = randomUUID();
      const xUserId = `x-${randomUUID()}`;
      await c.query(
        `insert into auth.users (id, instance_id, aud, role, email)
         values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2)`,
        [uid, `${uid}@example.com`],
      );
      await c.query(`insert into profiles (id, email) values ($1,$2) on conflict (id) do nothing`, [
        uid,
        `${uid}@example.com`,
      ]);
      const xid = (
        await c.query<{ id: string }>(
          `insert into x_accounts
             (user_id, x_user_id, handle, name, auth_type, status,
              access_token_ciphertext, refresh_token_ciphertext, oauth_scopes, token_expires_at)
           values ($1,$2,'h','n','byok','active',$3,$3,$4, now() + interval '1 hour')
           returning id`,
          [uid, xUserId, encrypt("t"), X_SCOPES],
        )
      ).rows[0].id;
      return { uid, xid, xUserId };
    });
  }

  function mockDeps(
    count: number | null,
    over: Partial<SnapshotFollowerDeps> = {},
  ): SnapshotFollowerDeps {
    return {
      db,
      getAccessToken: async () => "tok",
      readFollowersCount: async () => count,
      ...over,
    };
  }

  async function readSnapshot(xid: string): Promise<{ followers_count: number } | undefined> {
    return (
      await db.query<{ followers_count: number }>(
        `select followers_count from follower_snapshots
          where x_account_id = $1 and snapshot_date = (now() at time zone 'Asia/Tokyo')::date`,
        [xid],
      )
    ).rows[0];
  }

  const cleanup = async (uid: string, xid: string) => {
    // follower_snapshots は台帳（on delete restrict）のため account 削除前に消す。
    await withTransaction((c) => c.query(`delete from follower_snapshots where x_account_id = $1`, [xid]));
    await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));
  };

  it("writes today's snapshot; same-day rerun overwrites without a duplicate row", async () => {
    const { uid, xid, xUserId } = await seedAccount();
    const acct = { userId: uid, xAccountId: xid, xUserId };
    try {
      const res = await snapshotFollowerToday(mockDeps(1234), acct);
      expect(res).toEqual({ written: true, followersCount: 1234 });
      expect((await readSnapshot(xid))?.followers_count).toBe(1234);

      // 同日再押下: 行は増えず値だけ最新に上書きされる（1日1回の上限は suggestion 側が担う）。
      const rerun = await snapshotFollowerToday(mockDeps(9999), acct);
      expect(rerun).toEqual({ written: true, followersCount: 9999 });
      const rows = (
        await db.query<{ n: string }>(
          `select count(*) as n from follower_snapshots
            where x_account_id = $1 and snapshot_date = (now() at time zone 'Asia/Tokyo')::date`,
          [xid],
        )
      ).rows[0];
      expect(Number(rows.n)).toBe(1);
      expect((await readSnapshot(xid))?.followers_count).toBe(9999);
    } finally {
      await cleanup(uid, xid);
    }
  });

  it("does not write when the token is unavailable, and says why", async () => {
    const { uid, xid, xUserId } = await seedAccount();
    try {
      const res = await snapshotFollowerToday(
        mockDeps(1234, { getAccessToken: async () => null }),
        { userId: uid, xAccountId: xid, xUserId },
      );
      expect(res).toEqual({ written: false, reason: "token_unavailable" });
      expect(await readSnapshot(xid)).toBeUndefined();
    } finally {
      await cleanup(uid, xid);
    }
  });

  it("does not write when followers_count is unavailable (null), and says why", async () => {
    const { uid, xid, xUserId } = await seedAccount();
    try {
      const res = await snapshotFollowerToday(mockDeps(null), {
        userId: uid,
        xAccountId: xid,
        xUserId,
      });
      expect(res).toEqual({ written: false, reason: "count_unavailable" });
      expect(await readSnapshot(xid)).toBeUndefined();
    } finally {
      await cleanup(uid, xid);
    }
  });
});
