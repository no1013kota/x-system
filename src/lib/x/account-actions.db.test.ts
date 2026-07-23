import { randomBytes, randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { encryptWithKey } from "../crypto/envelope";
import { closePool, getPool, withTransaction } from "../db/pool";
import {
  disconnectXAccount,
  enableXAccount,
  listXAccountsForUser,
} from "./account-actions";
import { X_SCOPES } from "./oauth";
import type { Queryable } from "./token-refresh";

/**
 * DB integration tests for X account management (T-M2-16, 要件05 §4.3):
 * disconnect disables the account + its auto slots without deleting draft slots
 * (schedule_slots fixture), list is scoped to the owner, enable honors the plan limit.
 * Skips without the local Supabase stack.
 */
describe("X account management actions (local DB)", () => {
  let available = false;
  const testKey = randomBytes(32);
  const encrypt = (p: string) => encryptWithKey(p, testKey);

  const db: Queryable = {
    query: <T = unknown>(sql: string, params?: unknown[]) =>
      getPool().query(sql, params) as unknown as Promise<{
        rows: T[];
        rowCount: number | null;
      }>,
  };
  const runInTx = <T>(fn: (tx: Queryable) => Promise<T>): Promise<T> =>
    withTransaction((c) => fn(c as unknown as Queryable));

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

  async function makeUser(
    c: PoolClient,
    plan = "standard",
  ): Promise<string> {
    const uid = randomUUID();
    await c.query(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2)`,
      [uid, `${uid}@example.com`],
    );
    await c.query(
      `insert into profiles (id, email, plan, subscription_status) values ($1,$2,$3,'active')
       on conflict (id) do update set plan = excluded.plan, subscription_status = 'active'`,
      [uid, `${uid}@example.com`, plan],
    );
    return uid;
  }

  async function makeAccount(
    c: PoolClient,
    uid: string,
    opts: { status?: string; authType?: string } = {},
  ): Promise<string> {
    const { rows } = await c.query<{ id: string }>(
      `insert into x_accounts
         (user_id, x_user_id, handle, name, auth_type, status,
          access_token_ciphertext, refresh_token_ciphertext, oauth_scopes, token_expires_at)
       values ($1,$2,'h','n',$3,$4,$5,$6,$7, now() + interval '1 hour')
       returning id`,
      [
        uid,
        `x-${randomUUID()}`,
        opts.authType ?? "byok",
        opts.status ?? "active",
        encrypt("access"),
        encrypt("refresh"),
        X_SCOPES,
      ],
    );
    return rows[0].id;
  }

  it("listXAccountsForUser returns only the caller's accounts", async () => {
    const { uidA, uidB, aId } = await withTransaction(async (c) => {
      const uidA = await makeUser(c);
      const uidB = await makeUser(c);
      const aId = await makeAccount(c, uidA);
      await makeAccount(c, uidB);
      return { uidA, uidB, aId };
    });
    try {
      const listA = await listXAccountsForUser(db, uidA);
      expect(listA).toHaveLength(1);
      expect(listA[0].id).toBe(aId);
    } finally {
      await withTransaction(async (c) => {
        await c.query(`delete from auth.users where id = any($1)`, [[uidA, uidB]]);
      });
    }
  });

  it("disconnectXAccount disables the account + auto slots and keeps draft slots and data", async () => {
    const { uid, xid, autoSlot, draftSlot } = await withTransaction(async (c) => {
      const uid = await makeUser(c);
      const xid = await makeAccount(c, uid);
      // account is the active one and has automation consent
      await c.query(`update profiles set active_x_account_id = $2 where id = $1`, [uid, xid]);
      await c.query(
        `update x_accounts set automation_consent_version = 'v1', automation_consented_at = now()
          where id = $1`,
        [xid],
      );
      const auto = (
        await c.query<{ id: string }>(
          `insert into schedule_slots (x_account_id, pattern, weekdays, time_jst, mode, enabled)
           values ($1,'p1','{1,2,3}','09:00','auto',true) returning id`,
          [xid],
        )
      ).rows[0].id;
      const draft = (
        await c.query<{ id: string }>(
          `insert into schedule_slots (x_account_id, pattern, weekdays, time_jst, mode, enabled)
           values ($1,'p1','{4,5}','10:00','draft',true) returning id`,
          [xid],
        )
      ).rows[0].id;
      return { uid, xid, autoSlot: auto, draftSlot: draft };
    });
    try {
      const res = await disconnectXAccount(xid, uid, {
        db,
        runInTx,
        revoke: async () => {}, // no-op (real revoke is HTTP best-effort)
      });
      expect(res.status).toBe("disabled");

      const acct = (
        await db.query<{
          status: string;
          access_token_ciphertext: string | null;
          refresh_token_ciphertext: string | null;
          automation_consented_at: string | null;
          automation_disabled_at: string | null;
        }>(
          `select status, access_token_ciphertext, refresh_token_ciphertext,
                  automation_consented_at, automation_disabled_at
             from x_accounts where id = $1`,
          [xid],
        )
      ).rows[0];
      expect(acct.status).toBe("disabled");
      expect(acct.access_token_ciphertext).toBeNull();
      expect(acct.refresh_token_ciphertext).toBeNull();
      expect(acct.automation_consented_at).toBeNull(); // consent stopped
      expect(acct.automation_disabled_at).not.toBeNull();

      // auto slot disabled, draft slot untouched, BOTH rows still exist (not deleted)
      const slots = (
        await db.query<{ id: string; enabled: boolean; mode: string }>(
          `select id, enabled, mode from schedule_slots where x_account_id = $1 order by mode`,
          [xid],
        )
      ).rows;
      expect(slots).toHaveLength(2);
      const auto = slots.find((s) => s.id === autoSlot)!;
      const draft = slots.find((s) => s.id === draftSlot)!;
      expect(auto.enabled).toBe(false);
      expect(draft.enabled).toBe(true);

      // active pointer cleared
      const prof = (
        await db.query<{ active_x_account_id: string | null }>(
          `select active_x_account_id from profiles where id = $1`,
          [uid],
        )
      ).rows[0];
      expect(prof.active_x_account_id).toBeNull();
    } finally {
      await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));
    }
  });

  it("enableXAccount blocks re-activating past the plan limit (standard=1)", async () => {
    const { uid, disabledId } = await withTransaction(async (c) => {
      const uid = await makeUser(c, "standard");
      await makeAccount(c, uid, { status: "active" }); // occupies the single slot
      const disabledId = await makeAccount(c, uid, { status: "disabled" });
      return { uid, disabledId };
    });
    try {
      let err: { code?: string; details?: Record<string, unknown> } = {};
      try {
        await enableXAccount(disabledId, uid, {
          db,
          runInTx,
          getAccessToken: async () => "tok",
          fetchMe: async () => ({ id: "x", username: "u", name: "n", profileImageUrl: null }),
        });
      } catch (e) {
        err = e as { code?: string; details?: Record<string, unknown> };
      }
      expect(err.code).toBe("forbidden");
      expect(err.details?.reason).toBe("x_account_limit_reached");
      const row = (
        await db.query<{ status: string }>(`select status from x_accounts where id = $1`, [
          disabledId,
        ])
      ).rows[0];
      expect(row.status).toBe("disabled"); // not activated
    } finally {
      await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));
    }
  });
});
