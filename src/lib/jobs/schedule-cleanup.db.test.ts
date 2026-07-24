import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closePool, getPool, withTransaction } from "../db/pool";
import type { Queryable } from "../x/token-refresh";
import { cleanupOldData } from "./schedule-cleanup";

const pooledDb: Queryable = {
  query: <T = unknown>(sql: string, params?: unknown[]) =>
    getPool().query(sql, params) as unknown as Promise<{ rows: T[]; rowCount: number | null }>,
};

/**
 * DB integration tests for scheduler_tick retention cleanup (T-M4-09, 要件04 §14, 要件01 §9).
 * Skips without the local Supabase stack.
 */
describe("cleanupOldData (db)", () => {
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

  async function makeAccount(c: PoolClient): Promise<{ uid: string; xid: string }> {
    const uid = randomUUID();
    await c.query(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2)`,
      [uid, `${uid}@example.com`],
    );
    await c.query(`insert into profiles (id, email) values ($1, $2) on conflict (id) do nothing`, [
      uid,
      `${uid}@example.com`,
    ]);
    const { rows } = await c.query<{ id: string }>(
      `insert into x_accounts (user_id, x_user_id, handle, name, auth_type)
       values ($1, $2, 'h', 'n', 'byok') returning id`,
      [uid, `x-${randomUUID()}`],
    );
    return { uid, xid: rows[0].id };
  }

  async function insertNewsItem(c: PoolClient, ageDays: number): Promise<string> {
    const { rows } = await c.query<{ id: string }>(
      `insert into news_items (category, title, summary, source_url, impact, fetched_at)
       values ('ai', 't', 's', $1, 'high', now() - make_interval(days => $2)) returning id`,
      [`https://example.com/${randomUUID()}`, ageDays],
    );
    return rows[0].id;
  }

  async function insertNewsNotif(
    c: PoolClient,
    uid: string,
    ageDays: number,
    newsItemId: string,
  ): Promise<string> {
    const { rows } = await c.query<{ id: string }>(
      `insert into notifications (user_id, type, dedupe_key, title, body, payload, in_app_enabled, created_at)
       values ($1, 'news', $2, 't', 'b', jsonb_build_object('news_item_ids', jsonb_build_array($3::text)),
               true, now() - make_interval(days => $4)) returning id`,
      [uid, `nd-${randomUUID()}`, newsItemId, ageDays],
    );
    return rows[0].id;
  }

  it("deletes 40日超 retention rows and keeps recent/referenced ones (news notif deleted before news_items)", async () => {
    const seed = await withTransaction(async (c) => {
      const { uid, xid } = await makeAccount(c);
      const itemA = await insertNewsItem(c, 41); // old, only referenced by an old notif → deleted
      const itemB = await insertNewsItem(c, 41); // old, referenced by a draft → kept
      const itemC = await insertNewsItem(c, 41); // old, referenced by a recent notif → kept
      const oldNotif = await insertNewsNotif(c, uid, 41, itemA);
      const recentNotif = await insertNewsNotif(c, uid, 0, itemC);
      await c.query(
        `insert into drafts (x_account_id, pattern, thread, initial_thread, status, source_news_item_id)
         values ($1, 'p1', '[]'::jsonb, '[]'::jsonb, 'draft', $2)`,
        [xid, itemB],
      );
      const usageOld = (
        await c.query<{ id: string }>(
          `insert into external_api_usage_events
             (provider, operation, status, idempotency_key, occurred_at)
           values ('openai', 'text_generation', 'succeeded', $1, now() - make_interval(days => 41)) returning id`,
          [`u-${randomUUID()}`],
        )
      ).rows[0].id;
      const usageNew = (
        await c.query<{ id: string }>(
          `insert into external_api_usage_events
             (provider, operation, status, idempotency_key, occurred_at)
           values ('openai', 'text_generation', 'succeeded', $1, now()) returning id`,
          [`u-${randomUUID()}`],
        )
      ).rows[0].id;
      const cronOld = (
        await c.query<{ id: string }>(
          `insert into cron_runs (job_name, window_key, claimed_at)
           values ('scheduler_tick', $1, now() - make_interval(days => 41)) returning id`,
          [`w-${randomUUID()}`],
        )
      ).rows[0].id;
      const cronNew = (
        await c.query<{ id: string }>(
          `insert into cron_runs (job_name, window_key, claimed_at)
           values ('scheduler_tick', $1, now()) returning id`,
          [`w-${randomUUID()}`],
        )
      ).rows[0].id;
      return { uid, xid, itemA, itemB, itemC, oldNotif, recentNotif, usageOld, usageNew, cronOld, cronNew };
    });

    try {
      await cleanupOldData({ db: pooledDb });

      const alive = async (table: string, id: string): Promise<boolean> => {
        const { rowCount } = await withTransaction((c) =>
          c.query(`select 1 from ${table} where id = $1`, [id]),
        );
        return (rowCount ?? 0) > 0;
      };

      expect(await alive("notifications", seed.oldNotif)).toBe(false);
      expect(await alive("notifications", seed.recentNotif)).toBe(true);
      // news通知を先に消したので itemA は未参照になり削除される。
      expect(await alive("news_items", seed.itemA)).toBe(false);
      expect(await alive("news_items", seed.itemB)).toBe(true); // draft参照
      expect(await alive("news_items", seed.itemC)).toBe(true); // 直近通知payload参照
      expect(await alive("external_api_usage_events", seed.usageOld)).toBe(false);
      expect(await alive("external_api_usage_events", seed.usageNew)).toBe(true);
      expect(await alive("cron_runs", seed.cronOld)).toBe(false);
      expect(await alive("cron_runs", seed.cronNew)).toBe(true);
    } finally {
      await withTransaction(async (c) => {
        // drafts.source_news_item_id は on delete set null。draft を先に消してから news_items を消す。
        await c.query(`delete from auth.users where id = $1`, [seed.uid]);
        await c.query(`delete from news_items where id = any($1)`, [[seed.itemB, seed.itemC]]);
        await c.query(`delete from external_api_usage_events where id = $1`, [seed.usageNew]);
        await c.query(`delete from cron_runs where id = $1`, [seed.cronNew]);
      });
    }
  });
});
