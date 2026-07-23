import { randomBytes, randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { decryptWithKey, encryptWithKey } from "../crypto/envelope";
import { closePool, getPool, withTransaction } from "../db/pool";
import {
  X_SCOPES,
  type FetchLike,
  type FetchResponseLike,
  type OAuthClient,
} from "./oauth";
import {
  createXRelinkNotification,
  getValidAccessToken,
  XTokenExpiredError,
  type GetValidAccessTokenDeps,
  type Queryable,
} from "./token-refresh";

/**
 * DB integration tests for X token single-flight refresh (T-M0-21, 要件05 §4.3):
 * concurrent runs trigger exactly one refresh HTTP call, stale leases are
 * reclaimed, rotated tokens/expiry are written under the lock, and invalid_grant
 * expires the account. Skips without the local Supabase stack.
 */
describe("getValidAccessToken (local DB)", () => {
  let available = false;
  const testKey = randomBytes(32);
  const decrypt = (c: string) => decryptWithKey(c, testKey);
  const encrypt = (p: string) => encryptWithKey(p, testKey);

  // pool.query = 都度取得・即解放。並行呼び出しは別接続を使う。
  const db: Queryable = {
    query: <T = unknown>(sql: string, params?: unknown[]) =>
      getPool().query(sql, params) as unknown as Promise<{
        rows: T[];
        rowCount: number | null;
      }>,
  };
  const resolveClient = (): OAuthClient => ({ clientId: "cid", redirectUri: "https://cb" });

  function okTokenFetch(): { fetch: FetchLike; calls: () => number } {
    let n = 0;
    const fetch: FetchLike = async () => {
      n += 1;
      await new Promise((r) => setTimeout(r, 20)); // widen the concurrency window
      const body = {
        access_token: "access-new",
        refresh_token: "refresh-new",
        expires_in: 7200,
        scope: X_SCOPES.join(" "),
      };
      return { ok: true, status: 200, text: async () => JSON.stringify(body) } satisfies FetchResponseLike;
    };
    return { fetch, calls: () => n };
  }

  function deps(fetch: FetchLike, onExpired?: GetValidAccessTokenDeps["onExpired"]): GetValidAccessTokenDeps {
    return { db, fetch, decrypt, encrypt, resolveClient, sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5))), onExpired };
  }

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

  /** Creates an active x_account with a (stale by default) token. Returns {uid, xid}. */
  async function makeAccount(
    c: PoolClient,
    opts: {
      expiresInSec?: number; // relative to now; negative = already stale
      lockId?: string | null;
      lockedAgoSec?: number | null;
      refresh?: string | null;
    } = {},
  ): Promise<{ uid: string; xid: string }> {
    const uid = randomUUID();
    await c.query(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2)`,
      [uid, `${uid}@example.com`],
    );
    await c.query(
      `insert into profiles (id, email) values ($1, $2) on conflict (id) do nothing`,
      [uid, `${uid}@example.com`],
    );
    const expiresInSec = opts.expiresInSec ?? -60; // default: already stale
    const refresh = opts.refresh === undefined ? "refresh-old" : opts.refresh;
    const { rows } = await c.query<{ id: string }>(
      `insert into x_accounts
         (user_id, x_user_id, handle, name, auth_type, status,
          access_token_ciphertext, refresh_token_ciphertext, oauth_scopes,
          token_expires_at, token_refresh_lock_id, token_refresh_locked_at)
       values ($1,$2,'h','n','managed','active',$3,$4,$5,
               now() + ($6 || ' seconds')::interval,
               $7,
               case when $8::int is null then null else now() - ($8 || ' seconds')::interval end)
       returning id`,
      [
        uid,
        `x-${randomUUID()}`,
        encrypt("access-old"),
        refresh === null ? null : encrypt(refresh),
        X_SCOPES,
        String(expiresInSec),
        opts.lockId ?? null,
        opts.lockedAgoSec == null ? null : String(opts.lockedAgoSec),
      ],
    );
    return { uid, xid: rows[0].id };
  }

  async function readAccount(xid: string) {
    const { rows } = await withTransaction((c) =>
      c.query<{
        status: string;
        token_refresh_lock_id: string | null;
        refresh_token_ciphertext: string | null;
        token_expires_at: Date | null;
      }>(
        `select status, token_refresh_lock_id, refresh_token_ciphertext, token_expires_at
           from x_accounts where id = $1`,
        [xid],
      ),
    );
    return rows[0];
  }

  it("concurrent runs trigger exactly one refresh and both get the new token", async () => {
    const { uid, xid } = await withTransaction((c) => makeAccount(c));
    const f = okTokenFetch();
    try {
      const [t1, t2] = await Promise.all([
        getValidAccessToken(xid, deps(f.fetch)),
        getValidAccessToken(xid, deps(f.fetch)),
      ]);
      expect(f.calls()).toBe(1); // single-flight
      expect(t1).toBe("access-new");
      expect(t2).toBe("access-new");
      const row = await readAccount(xid);
      expect(row.status).toBe("active");
      expect(row.token_refresh_lock_id).toBeNull(); // lease released
      expect(decrypt(row.refresh_token_ciphertext!)).toBe("refresh-new"); // rotated
      expect(row.token_expires_at!.getTime()).toBeGreaterThan(Date.now());
    } finally {
      await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));
    }
  });

  it("reclaims a stale (>1min) lease held by a dead run and refreshes", async () => {
    const { uid, xid } = await withTransaction((c) =>
      makeAccount(c, { lockId: randomUUID(), lockedAgoSec: 120 }), // stale lease
    );
    const f = okTokenFetch();
    try {
      const token = await getValidAccessToken(xid, deps(f.fetch));
      expect(f.calls()).toBe(1);
      expect(token).toBe("access-new");
      const row = await readAccount(xid);
      expect(row.token_refresh_lock_id).toBeNull();
      expect(decrypt(row.refresh_token_ciphertext!)).toBe("refresh-new");
    } finally {
      await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));
    }
  });

  it("does not refresh when the token is still fresh", async () => {
    const { uid, xid } = await withTransaction((c) => makeAccount(c, { expiresInSec: 3600 }));
    const f = okTokenFetch();
    try {
      const token = await getValidAccessToken(xid, deps(f.fetch));
      expect(f.calls()).toBe(0);
      expect(token).toBe("access-old");
    } finally {
      await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));
    }
  });

  it("marks the account expired and releases the lease on invalid_grant", async () => {
    const { uid, xid } = await withTransaction((c) => makeAccount(c));
    let expiredReason: string | null = null;
    const fetch: FetchLike = async () => ({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: "invalid_grant" }),
    });
    try {
      await expect(
        getValidAccessToken(xid, deps(fetch, (_id, reason) => {
          expiredReason = reason;
        })),
      ).rejects.toBeInstanceOf(XTokenExpiredError);
      const row = await readAccount(xid);
      expect(row.status).toBe("expired");
      expect(row.token_refresh_lock_id).toBeNull();
      expect(expiredReason).toBe("invalid_grant");
    } finally {
      await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));
    }
  });

  // T-M2-15: 再連携通知（要件05 §4.3・要件02 §3.15）。type='error' で所有者へ1件、payload に理由を残す。
  it("createXRelinkNotification writes a type=error re-link notification honoring notification_config", async () => {
    const { uid, xid } = await withTransaction((c) => makeAccount(c));
    try {
      await withTransaction((c) =>
        c.query(
          `update profiles set notification_config = '{"error":{"in_app":true,"email":true}}'::jsonb where id = $1`,
          [uid],
        ),
      );
      await createXRelinkNotification(db, xid, "invalid_grant");

      const { rows } = await withTransaction((c) =>
        c.query<{
          type: string;
          link: string;
          in_app_enabled: boolean;
          email_status: string;
          reason: string;
          account: string;
        }>(
          `select type, link, in_app_enabled, email_status,
                  payload->>'reason' as reason, payload->>'x_account_id' as account
             from notifications where user_id = $1`,
          [uid],
        ),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].type).toBe("error");
      expect(rows[0].link).toBe("/app/settings?tab=api-keys");
      expect(rows[0].in_app_enabled).toBe(true);
      expect(rows[0].email_status).toBe("queued"); // error.email = true
      expect(rows[0].reason).toBe("invalid_grant");
      expect(rows[0].account).toBe(xid);
    } finally {
      await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));
    }
  });

  it("createXRelinkNotification writes nothing when both error channels are off", async () => {
    const { uid, xid } = await withTransaction((c) => makeAccount(c));
    try {
      await withTransaction((c) =>
        c.query(
          `update profiles set notification_config = '{"error":{"in_app":false,"email":false}}'::jsonb where id = $1`,
          [uid],
        ),
      );
      await createXRelinkNotification(db, xid, "insufficient_scope");
      const { rows } = await withTransaction((c) =>
        c.query<{ n: number }>(
          `select count(*)::int as n from notifications where user_id = $1`,
          [uid],
        ),
      );
      expect(rows[0].n).toBe(0);
    } finally {
      await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));
    }
  });
});
