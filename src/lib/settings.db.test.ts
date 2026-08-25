import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closePool, getPool, withTransaction } from "./db/pool";
import {
  readSettings,
  saveNewsConfig,
  saveNotificationConfig,
} from "./settings";
import type { Queryable } from "./x/token-refresh";

/**
 * DB integration tests for profile/notification/news settings (T-M2-22, 要件05 §4.1):
 * unset jsonb falls back to §3.4 defaults, and writes round-trip. Skips without the stack.
 */
describe("settings (local DB)", () => {
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

  it("falls back to defaults for an unset ('{}') profile", async () => {
    const uid = await withTransaction((c) => makeUser(c));
    try {
      const settings = await readSettings(db, uid);
      expect(settings?.newsConfig.categories).toContain("ai");
      expect(settings?.notificationConfig.posted).toEqual({ in_app: true });
    } finally {
      await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));
    }
  });

  it("round-trips saved notification / news settings", async () => {
    const uid = await withTransaction((c) => makeUser(c));
    try {
      await saveNotificationConfig(db, uid, {
        news: { in_app: true },
        draft_created: { in_app: true },
        posted: { in_app: false },
        error: { in_app: true },
        billing: { in_app: true },
        usage: { in_app: true },
        summary: { in_app: true },
      });
      await saveNewsConfig(db, uid, {
        categories: ["ai", "sns"],
        impact_filter: ["high"],
      });

      const settings = await readSettings(db, uid);
      expect(settings?.notificationConfig.news).toEqual({ in_app: true });
      expect(settings?.newsConfig).toEqual({
        categories: ["ai", "sns"],
        impact_filter: ["high"],
      });
    } finally {
      await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));
    }
  });
});
