import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closePool, getPool, withTransaction } from "./db/pool";
import {
  countUnreadNotifications,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "./notifications";
import type { Queryable } from "./x/token-refresh";

/**
 * DB integration tests for in-app notifications (T-M2-20, 要件05 §10):
 * owner-scoped + in_app_enabled=true listing, keyset cursor paging, idempotent
 * read marking, and unread counts. Skips without the local Supabase stack.
 */
describe("notifications (local DB)", () => {
  let available = false;
  const db: Queryable = {
    query: <T = unknown>(sql: string, params?: unknown[]) =>
      getPool().query(sql, params) as unknown as Promise<{
        rows: T[];
        rowCount: number | null;
      }>,
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

  async function makeUser(c: PoolClient): Promise<string> {
    const uid = randomUUID();
    await c.query(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2)`,
      [uid, `${uid}@example.com`],
    );
    await c.query(
      `insert into profiles (id, email) values ($1,$2) on conflict (id) do nothing`,
      [uid, `${uid}@example.com`],
    );
    return uid;
  }

  async function insertNotif(
    c: PoolClient,
    uid: string,
    opts: {
      inApp?: boolean;
      read?: boolean;
      link?: string | null;
      createdAt?: string;
      title?: string;
    } = {},
  ): Promise<string> {
    const { rows } = await c.query<{ id: string }>(
      `insert into notifications
         (user_id, type, title, body, link, in_app_enabled, read_at, created_at)
       values ($1,'error',$2,'body',$3,$4, case when $5 then now() else null end,
               coalesce($6::timestamptz, now()))
       returning id`,
      [
        uid,
        opts.title ?? "title",
        opts.link ?? null,
        opts.inApp ?? true,
        opts.read ?? false,
        opts.createdAt ?? null,
      ],
    );
    return rows[0].id;
  }

  it("lists only the owner's in_app notifications, newest first, and pages by cursor", async () => {
    const { uid, other } = await withTransaction(async (c) => {
      const uid = await makeUser(c);
      const other = await makeUser(c);
      await insertNotif(c, uid, { createdAt: "2026-01-01T00:00:00Z", title: "a" });
      await insertNotif(c, uid, { createdAt: "2026-01-02T00:00:00Z", title: "b" });
      await insertNotif(c, uid, { createdAt: "2026-01-03T00:00:00Z", title: "c" });
      await insertNotif(c, uid, { inApp: false, title: "hidden" }); // email-only
      await insertNotif(c, other, { title: "other-user" });
      return { uid, other };
    });
    try {
      const page1 = await listNotifications(db, uid, { limit: 2 });
      expect(page1.items.map((i) => i.title)).toEqual(["c", "b"]); // newest first
      expect(page1.nextCursor).not.toBeNull();

      const page2 = await listNotifications(db, uid, {
        cursor: page1.nextCursor,
        limit: 2,
      });
      expect(page2.items.map((i) => i.title)).toEqual(["a"]); // in_app only, no "hidden"/other
      expect(page2.nextCursor).toBeNull();
    } finally {
      await withTransaction((c) =>
        c.query(`delete from auth.users where id = any($1)`, [[uid, other]]),
      );
    }
  });

  it("marks one read (owner only, idempotent) and reflects the unread count", async () => {
    const { uid, other, nId, otherNId } = await withTransaction(async (c) => {
      const uid = await makeUser(c);
      const other = await makeUser(c);
      const nId = await insertNotif(c, uid, { link: "/app/settings?tab=x-accounts" });
      await insertNotif(c, uid);
      const otherNId = await insertNotif(c, other);
      return { uid, other, nId, otherNId };
    });
    try {
      expect(await countUnreadNotifications(db, uid)).toBe(2);

      const first = await markNotificationRead(db, uid, nId);
      expect(await countUnreadNotifications(db, uid)).toBe(1);
      // idempotent: read_at does not move on a second call
      const second = await markNotificationRead(db, uid, nId);
      expect(second.readAt).toBe(first.readAt);

      // cannot read another user's notification
      await expect(markNotificationRead(db, uid, otherNId)).rejects.toMatchObject({
        code: "not_found",
      });

      // link is preserved for navigation (完了条件3)
      const listed = await listNotifications(db, uid);
      expect(listed.items.find((i) => i.id === nId)?.link).toBe(
        "/app/settings?tab=x-accounts",
      );
    } finally {
      await withTransaction((c) =>
        c.query(`delete from auth.users where id = any($1)`, [[uid, other]]),
      );
    }
  });

  it("marks all in_app notifications read for the owner", async () => {
    const uid = await withTransaction(async (c) => {
      const uid = await makeUser(c);
      await insertNotif(c, uid);
      await insertNotif(c, uid);
      await insertNotif(c, uid, { inApp: false }); // email-only, not counted/affected
      return uid;
    });
    try {
      const count = await markAllNotificationsRead(db, uid);
      expect(count).toBe(2);
      expect(await countUnreadNotifications(db, uid)).toBe(0);
    } finally {
      await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));
    }
  });
});
