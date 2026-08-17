import { randomUUID } from "node:crypto";

import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { connectLocalDb } from "./test-utils";

/**
 * Verifies RLS (要件02 §5): row isolation between users, system-default
 * visibility, service-role-only tables, no direct writes from authenticated,
 * and the active_x_account_id ownership trigger (§3.3). Setup runs as the
 * postgres superuser (RLS bypassed); assertions run as the `authenticated`
 * role with a JWT `sub` claim so auth.uid() resolves. Everything is inside a
 * rolled-back transaction. Skips without the local Supabase stack.
 */
describe("RLS policies & ownership trigger", () => {
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

  async function inTx<T>(fn: (c: Client) => Promise<T>): Promise<T> {
    const c = db!;
    await c.query("begin");
    try {
      return await fn(c);
    } finally {
      await c.query("rollback");
    }
  }

  /** Asserts `run` fails (permission or trigger), keeping the tx usable via a savepoint. */
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
    expect(threw, "expected the query to be rejected").toBe(true);
  }

  /** Switch the current transaction to the authenticated role acting as `uid`. */
  async function actAs(c: Client, uid: string) {
    await c.query(`select set_config('role', 'authenticated', true)`);
    await c.query(
      `select set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify({ sub: uid, role: "authenticated" })],
    );
  }

  /** Back to the transaction's owning superuser role for further setup. */
  async function actAsSuperuser(c: Client) {
    await c.query(`select set_config('role', 'postgres', true)`);
  }

  async function makeUser(c: Client): Promise<{ uid: string; xid: string }> {
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
    const { rows } = await c.query<{ id: string }>(
      `insert into x_accounts (user_id, x_user_id, handle, name, auth_type)
       values ($1, $2, 'h', 'n', 'byok') returning id`,
      [uid, `x-${randomUUID()}`],
    );
    return { uid, xid: rows[0].id };
  }

  it("isolates profiles/x_accounts/drafts per user", async () => {
    await inTx(async (c) => {
      const a = await makeUser(c);
      const b = await makeUser(c);
      await c.query(
        `insert into drafts (x_account_id, pattern, thread, initial_thread)
         values ($1, 'p1', '[]'::jsonb, '[]'::jsonb)`,
        [b.xid],
      );

      await actAs(c, a.uid);
      const profiles = await c.query(`select id from profiles`);
      expect(profiles.rows.map((r) => r.id)).toEqual([a.uid]);

      const xacc = await c.query(`select id from x_accounts`);
      expect(xacc.rows.map((r) => r.id)).toEqual([a.xid]);

      // A cannot see B's draft
      const drafts = await c.query(`select id from drafts`);
      expect(drafts.rows).toHaveLength(0);
    });
  });

  it("lets any authenticated user read news_items but not stripe_events", async () => {
    await inTx(async (c) => {
      const a = await makeUser(c);
      await c.query(
        `insert into news_items (category, title, summary, source_url, impact)
         values ('ai', 't', 's', $1, 'high')`,
        [`https://example.com/${randomUUID()}`],
      );
      await c.query(
        `insert into stripe_events (event_id, type, event_created_at)
         values ($1, 'x', now())`,
        [`evt_${randomUUID()}`],
      );

      await actAs(c, a.uid);
      const news = await c.query(`select count(*)::int as n from news_items`);
      expect(news.rows[0].n).toBeGreaterThanOrEqual(1);
      // stripe_events is not granted to authenticated → access denied entirely
      await expectViolation(c, () =>
        c.query(`select count(*) from stripe_events`),
      );
    });
  });

  it("denies authenticated access to cron_runs (service-role only)", async () => {
    await inTx(async (c) => {
      const a = await makeUser(c);
      // service-role side can write the dedup marker
      await c.query(
        `insert into cron_runs (job_name, window_key) values ('scheduler_tick', $1)`,
        [`rls-${randomUUID()}`],
      );

      await actAs(c, a.uid);
      // cron_runs has no policy/GRANT for authenticated → access denied entirely
      await expectViolation(c, () =>
        c.query(`select count(*) from cron_runs`),
      );
    });
  });

  it("shows system-default prompt_templates to all but account overrides only to owner", async () => {
    await inTx(async (c) => {
      const a = await makeUser(c);
      const b = await makeUser(c);
      // (null, 'image') system default is seeded; add B's account override.
      // 型プロンプト（p1〜p6）は `post_patterns` へ移したので画像で確かめる（T-M8-129 U2）。
      await c.query(
        `insert into prompt_templates (x_account_id, kind, content) values ($1, 'image', 'b-override')`,
        [b.xid],
      );

      await actAs(c, a.uid);
      const rows = await c.query<{ x_account_id: string | null }>(
        `select x_account_id from prompt_templates where kind = 'image'`,
      );
      // A sees only the system default (x_account_id null), not B's override
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0].x_account_id).toBeNull();
    });
  });

  it("denies direct writes from the authenticated role", async () => {
    await inTx(async (c) => {
      const a = await makeUser(c);
      await actAs(c, a.uid);
      // authenticated has no INSERT grant/policy → denied
      await expectViolation(c, () =>
        c.query(
          `insert into drafts (x_account_id, pattern, thread, initial_thread)
           values ($1, 'p1', '[]'::jsonb, '[]'::jsonb)`,
          [a.xid],
        ),
      );
      // authenticated has no UPDATE grant/policy → denied
      await expectViolation(c, () =>
        c.query(`update profiles set cancel_at_period_end = true where id = $1`, [a.uid]),
      );
    });
  });

  it("enforces active_x_account_id ownership via trigger", async () => {
    await inTx(async (c) => {
      const a = await makeUser(c);
      const b = await makeUser(c);
      // setup as superuser: assigning B's x_account to A's profile must fail
      await expectViolation(c, () =>
        c.query(`update profiles set active_x_account_id = $1 where id = $2`, [
          b.xid,
          a.uid,
        ]),
      );
      // assigning A's own x_account succeeds
      await c.query(`update profiles set active_x_account_id = $1 where id = $2`, [
        a.xid,
        a.uid,
      ]);
      const { rows } = await c.query(
        `select active_x_account_id from profiles where id = $1`,
        [a.uid],
      );
      expect(rows[0].active_x_account_id).toBe(a.xid);
      await actAsSuperuser(c); // no-op guard; keeps helper referenced
    });
  });

  // 全般（要件02 §5, T-M6-20）: 個別tableのポリシーだけでなく、全public tableに横断で不変条件を課す。
  it("enables row-level security on every public table (別ユーザーのselectを構造的に遮断)", async () => {
    const { rows } = await db!.query<{ relname: string }>(
      `select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = false
        order by 1`,
    );
    // RLS未有効のtableが1つでもあれば、そのtableは別ユーザーの行が見えてしまう。
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it("grants the authenticated role no direct write on any public table (writeはservice-role経由のみ)", async () => {
    const { rows } = await db!.query<{ table_name: string; privilege_type: string }>(
      `select table_name, privilege_type from information_schema.role_table_grants
        where grantee = 'authenticated' and table_schema = 'public'
          and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
        order by 1, 2`,
    );
    // authenticated に直接write権限を持つtableは無い（別ユーザーへの書込みも構造的に不可）。
    expect(rows).toEqual([]);
  });
});
