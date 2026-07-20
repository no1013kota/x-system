import { randomUUID } from "node:crypto";

import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { connectLocalDb } from "./test-utils";

/**
 * Verifies the core 7 tables (要件02 §3.1〜3.7): their columns/FKs exist and the
 * key constraints reject violating inserts. Each test runs inside a transaction
 * that is rolled back, so the DB is left untouched. Skips when the local
 * Supabase stack is not running.
 */
describe("core tables schema & constraints", () => {
  let db: Client | null = null;

  beforeAll(async () => {
    db = await connectLocalDb();
  });

  afterAll(async () => {
    await db?.end();
  });

  beforeEach(async (ctx) => {
    if (!db) ctx.skip();
  });

  /** Runs `fn` inside a rolled-back transaction so nothing persists. */
  async function inTx<T>(fn: (c: Client) => Promise<T>): Promise<T> {
    const c = db!;
    await c.query("begin");
    try {
      return await fn(c);
    } finally {
      await c.query("rollback");
    }
  }

  /**
   * Asserts `run` violates a DB constraint. A failing statement aborts the whole
   * Postgres transaction, so the failing query is wrapped in a SAVEPOINT and
   * rolled back to it — this keeps the outer transaction usable for further
   * assertions in the same test.
   */
  async function expectViolation(c: Client, run: () => Promise<unknown>) {
    await c.query("savepoint sp");
    let threw = false;
    try {
      await run();
    } catch {
      threw = true;
      await c.query("rollback to savepoint sp");
    }
    await c.query("release savepoint sp").catch(() => {});
    expect(threw, "expected the query to violate a constraint").toBe(true);
  }

  /** Creates an auth user + profile and returns their id. */
  async function makeProfile(c: Client): Promise<string> {
    const id = randomUUID();
    await c.query(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2)`,
      [id, `${id}@example.com`],
    );
    await c.query(`insert into profiles (id, email) values ($1, $2)`, [
      id,
      `${id}@example.com`,
    ]);
    return id;
  }

  async function makeXAccount(c: Client, userId: string): Promise<string> {
    const { rows } = await c.query<{ id: string }>(
      `insert into x_accounts (user_id, x_user_id, handle, name, auth_type)
       values ($1, $2, 'handle', 'name', 'byok') returning id`,
      [userId, `x-${randomUUID()}`],
    );
    return rows[0].id;
  }

  it("has all 7 tables", async () => {
    await inTx(async (c) => {
      const { rows } = await c.query<{ table_name: string }>(
        `select table_name from information_schema.tables
          where table_schema = 'public' and table_name = any($1)`,
        [
          [
            "profiles",
            "user_api_keys",
            "x_accounts",
            "base_md_versions",
            "prompt_templates",
            "learning_sources",
            "news_items",
          ],
        ],
      );
      expect(rows.map((r) => r.table_name).sort()).toEqual([
        "base_md_versions",
        "learning_sources",
        "news_items",
        "profiles",
        "prompt_templates",
        "user_api_keys",
        "x_accounts",
      ]);
    });
  });

  it("updated_at trigger bumps updated_at on update", async () => {
    await inTx(async (c) => {
      const id = await makeProfile(c);
      await c.query(
        `update profiles set updated_at = to_timestamp(0) where id = $1`,
        [id],
      );
      await c.query(`update profiles set display_name = 'x' where id = $1`, [id]);
      const { rows } = await c.query<{ updated_at: Date }>(
        `select updated_at from profiles where id = $1`,
        [id],
      );
      expect(rows[0].updated_at.getFullYear()).toBeGreaterThan(2020);
    });
  });

  it("rejects duplicate (user_id, provider) on user_api_keys", async () => {
    await inTx(async (c) => {
      const uid = await makeProfile(c);
      await c.query(
        `insert into user_api_keys (user_id, provider, credentials_ciphertext)
         values ($1, 'anthropic', 'x')`,
        [uid],
      );
      await expectViolation(c, () =>
        c.query(
          `insert into user_api_keys (user_id, provider, credentials_ciphertext)
           values ($1, 'anthropic', 'y')`,
          [uid],
        ),
      );
    });
  });

  it("rejects duplicate (x_account_id, version) on base_md_versions", async () => {
    await inTx(async (c) => {
      const uid = await makeProfile(c);
      const xid = await makeXAccount(c, uid);
      await c.query(
        `insert into base_md_versions (x_account_id, version, content, change_source)
         values ($1, 1, 'a', 'settings')`,
        [xid],
      );
      await expectViolation(c, () =>
        c.query(
          `insert into base_md_versions (x_account_id, version, content, change_source)
           values ($1, 1, 'b', 'learning')`,
          [xid],
        ),
      );
    });
  });

  it("rejects base_md_version < 0 and version <= 0", async () => {
    await inTx(async (c) => {
      const uid = await makeProfile(c);
      await expectViolation(c, () =>
        c.query(
          `insert into x_accounts (user_id, x_user_id, handle, name, auth_type, base_md_version)
           values ($1, 'x', 'h', 'n', 'byok', -1)`,
          [uid],
        ),
      );
      const xid = await makeXAccount(c, uid);
      await expectViolation(c, () =>
        c.query(
          `insert into base_md_versions (x_account_id, version, content, change_source)
           values ($1, 0, 'a', 'settings')`,
          [xid],
        ),
      );
    });
  });

  it("enforces prompt_templates unique per (x_account_id, kind) and per system kind", async () => {
    await inTx(async (c) => {
      // system default: only one row per kind where x_account_id is null
      await c.query(
        `insert into prompt_templates (x_account_id, kind, content) values (null, 'p1', 'a')`,
      );
      await expectViolation(c, () =>
        c.query(
          `insert into prompt_templates (x_account_id, kind, content) values (null, 'p1', 'b')`,
        ),
      );
      // account override: one per (x_account_id, kind)
      const uid = await makeProfile(c);
      const xid = await makeXAccount(c, uid);
      await c.query(
        `insert into prompt_templates (x_account_id, kind, content) values ($1, 'p1', 'a')`,
        [xid],
      );
      await expectViolation(c, () =>
        c.query(
          `insert into prompt_templates (x_account_id, kind, content) values ($1, 'p1', 'b')`,
          [xid],
        ),
      );
    });
  });

  it("rejects invalid prompt_templates.kind", async () => {
    await inTx(async (c) => {
      await expectViolation(c, () =>
        c.query(
          `insert into prompt_templates (x_account_id, kind, content) values (null, 'p9', 'a')`,
        ),
      );
    });
  });

  it("enforces learning_sources own_posts single row per account", async () => {
    await inTx(async (c) => {
      const uid = await makeProfile(c);
      const xid = await makeXAccount(c, uid);
      await c.query(
        `insert into learning_sources (x_account_id, type) values ($1, 'own_posts')`,
        [xid],
      );
      await expectViolation(c, () =>
        c.query(
          `insert into learning_sources (x_account_id, type) values ($1, 'own_posts')`,
          [xid],
        ),
      );
    });
  });

  it("rejects duplicate news_items.source_url", async () => {
    await inTx(async (c) => {
      await c.query(
        `insert into news_items (category, title, summary, source_url, impact)
         values ('ai', 't', 's', 'https://example.com/a', 'high')`,
      );
      await expectViolation(c, () =>
        c.query(
          `insert into news_items (category, title, summary, source_url, impact)
           values ('web3', 't2', 's2', 'https://example.com/a', 'low')`,
        ),
      );
    });
  });

  it("rejects x_accounts automation consent version/timestamp mismatch", async () => {
    await inTx(async (c) => {
      const uid = await makeProfile(c);
      await expectViolation(c, () =>
        c.query(
          `insert into x_accounts (user_id, x_user_id, handle, name, auth_type, automation_consent_version)
           values ($1, 'x', 'h', 'n', 'byok', 'v1')`,
          [uid],
        ),
      );
    });
  });

  it("sets active_x_account_id to null when the x_account is deleted", async () => {
    await inTx(async (c) => {
      const uid = await makeProfile(c);
      const xid = await makeXAccount(c, uid);
      await c.query(`update profiles set active_x_account_id = $1 where id = $2`, [
        xid,
        uid,
      ]);
      await c.query(`delete from x_accounts where id = $1`, [xid]);
      const { rows } = await c.query<{ active_x_account_id: string | null }>(
        `select active_x_account_id from profiles where id = $1`,
        [uid],
      );
      expect(rows[0].active_x_account_id).toBeNull();
    });
  });
});
