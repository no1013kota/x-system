import { randomBytes, randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { encryptWithKey } from "../crypto/envelope";
import { closePool, getPool, withTransaction } from "../db/pool";
import { X_SCOPES } from "../x/oauth";
import type { Queryable } from "../x/token-refresh";
import {
  executeFollowerSnapshot,
  type FollowerSnapshotDeps,
} from "./follower-snapshot";

/**
 * DB integration for follower_snapshot (K-3, 要件04 §13, 要件02 §3.11, T-M5-14): JST当日分の選定・upsert・
 * 重複防止・token失効/取得不能skip。X読取は mock を注入（原価台帳は経由しない）。
 */
describe("follower_snapshot (local DB)", () => {
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
    counts: Record<string, number | null>,
    over: Partial<FollowerSnapshotDeps> = {},
  ): FollowerSnapshotDeps {
    return {
      db,
      isPastDeadline: () => false,
      // 他テストのアカウントは token=null で skip（グローバル選定の巻き込み回避）。
      getAccessToken: async (xid) => (xid in counts ? "tok" : null),
      readFollowersCount: async ({ xAccountId }) => counts[xAccountId] ?? null,
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

  it("writes today's snapshot for an active account, no duplicate on same-day rerun", async () => {
    const { uid, xid } = await seedAccount();
    try {
      const res = await executeFollowerSnapshot(mockDeps({ [xid]: 1234 }));
      expect(res.snapshotsWritten).toBeGreaterThanOrEqual(1);
      expect((await readSnapshot(xid))?.followers_count).toBe(1234);

      // same-day rerun: account already has today's snapshot → not selected → count unchanged
      await executeFollowerSnapshot(mockDeps({ [xid]: 9999 }));
      const rows = (
        await db.query<{ n: string }>(
          `select count(*) as n from follower_snapshots
            where x_account_id = $1 and snapshot_date = (now() at time zone 'Asia/Tokyo')::date`,
          [xid],
        )
      ).rows[0];
      expect(Number(rows.n)).toBe(1); // no duplicate row
      expect((await readSnapshot(xid))?.followers_count).toBe(1234); // unchanged (not re-read)
    } finally {
      await cleanup(uid, xid);
    }
  });

  it("skips accounts with no valid token (left for next window)", async () => {
    const { uid, xid } = await seedAccount();
    try {
      // token resolves to null for this account
      const res = await executeFollowerSnapshot(mockDeps({}, { getAccessToken: async () => null }));
      expect(res.snapshotsWritten).toBe(0);
      expect(await readSnapshot(xid)).toBeUndefined();
    } finally {
      await cleanup(uid, xid);
    }
  });

  it("does not write when followers_count is unavailable (null), reports deferred", async () => {
    const { uid, xid } = await seedAccount();
    try {
      const res = await executeFollowerSnapshot(mockDeps({ [xid]: null }));
      expect(res.deferred).toBe(true);
      expect(await readSnapshot(xid)).toBeUndefined();
    } finally {
      await cleanup(uid, xid);
    }
  });
});
