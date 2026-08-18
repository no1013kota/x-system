import { randomUUID } from "node:crypto";

import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { connectLocalDb } from "./test-utils";

/**
 * Verifies the 10 job/draft/ledger tables (要件02 §3.8〜3.17): existence, the
 * generation_jobs partial unique indexes, schedule_run_key/request_key unique,
 * usage_events integrity checks, usage_counters premium limits, and
 * schedule_slots CHECKs. Runs inside rolled-back transactions; skips without
 * the local Supabase stack.
 */
describe("jobs/draft/ledger tables schema & constraints", () => {
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

  async function makeAccount(c: Client): Promise<{ uid: string; xid: string }> {
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

  async function makeDraft(c: Client, xid: string): Promise<string> {
    const { rows } = await c.query<{ id: string }>(
      `insert into drafts (x_account_id, pattern_id, thread, initial_thread)
       values ($1, (select id from post_patterns where x_account_id = $1 and seed_key = 'p1'), '[]'::jsonb, '[]'::jsonb) returning id`,
      [xid],
    );
    return rows[0].id;
  }

  it("has all 10 tables", async () => {
    await inTx(async (c) => {
      const expected = [
        "drafts",
        "external_api_usage_events",
        "follower_snapshots",
        "generation_jobs",
        "improvement_suggestions",
        "notifications",
        "schedule_slots",
        "stripe_events",
        "usage_counters",
        "usage_events",
      ];
      const { rows } = await c.query<{ table_name: string }>(
        `select table_name from information_schema.tables
          where table_schema = 'public' and table_name = any($1)`,
        [expected],
      );
      expect(rows.map((r) => r.table_name).sort()).toEqual(expected);
    });
  });

  it("enforces generation_jobs post_publish active partial-unique per draft", async () => {
    await inTx(async (c) => {
      const { xid } = await makeAccount(c);
      const did = await makeDraft(c, xid);
      const ins = () =>
        c.query(
          `insert into generation_jobs (x_account_id, kind, trigger, draft_id, status)
           values ($1, 'post_publish', 'manual', $2, 'queued')`,
          [xid, did],
        );
      await ins();
      await expectViolation(c, ins); // 2件目のqueued post_publishは不可
    });
  });

  it("allows a second post_publish once the first is terminal", async () => {
    await inTx(async (c) => {
      const { xid } = await makeAccount(c);
      const did = await makeDraft(c, xid);
      await c.query(
        `insert into generation_jobs (x_account_id, kind, trigger, draft_id, status)
         values ($1, 'post_publish', 'manual', $2, 'succeeded')`,
        [xid, did],
      );
      // succeededは部分unique対象外なので新たなqueuedを作れる
      await c.query(
        `insert into generation_jobs (x_account_id, kind, trigger, draft_id, status)
         values ($1, 'post_publish', 'manual', $2, 'queued')`,
        [xid, did],
      );
    });
  });

  it("enforces suggestion active partial-unique per account", async () => {
    await inTx(async (c) => {
      const { xid } = await makeAccount(c);
      const ins = () =>
        c.query(
          `insert into generation_jobs (x_account_id, kind, trigger, status)
           values ($1, 'suggestion', 'manual', 'running')`,
          [xid],
        );
      await ins();
      await expectViolation(c, ins);
    });
  });

  it("enforces schedule_run_key and request_key uniqueness", async () => {
    await inTx(async (c) => {
      const { xid } = await makeAccount(c);
      await c.query(
        `insert into generation_jobs (x_account_id, kind, trigger, pattern_id, schedule_run_key, request_key)
         values ($1, 'post_generation', 'schedule', (select id from post_patterns where x_account_id = $1 and seed_key = 'p1'), 'srk-1', 'rk-1')`,
        [xid],
      );
      await expectViolation(c, () =>
        c.query(
          `insert into generation_jobs (x_account_id, kind, trigger, pattern_id, schedule_run_key)
           values ($1, 'post_generation', 'schedule', (select id from post_patterns where x_account_id = $1 and seed_key = 'p1'), 'srk-1')`,
          [xid],
        ),
      );
      await expectViolation(c, () =>
        c.query(
          `insert into generation_jobs (x_account_id, kind, trigger, pattern_id, request_key)
           values ($1, 'post_generation', 'manual', (select id from post_patterns where x_account_id = $1 and seed_key = 'p1'), 'rk-1')`,
          [xid],
        ),
      );
    });
  });

  it("enforces schedule_slots CHECKs (p5 forbidden, time, weekdays)", async () => {
    await inTx(async (c) => {
      const { xid } = await makeAccount(c);
      // valid baseline
      await c.query(
        `insert into schedule_slots (x_account_id, pattern_id, weekdays, time_jst, mode, theme)
         values ($1, (select id from post_patterns where x_account_id = $1 and seed_key = 'p1'), '{1,3,5}', '09:30', 'draft', 'other')`,
        [xid],
      );
      // p5 forbidden
      await expectViolation(c, () =>
        c.query(
          `insert into schedule_slots (x_account_id, pattern_id, weekdays, time_jst, mode, theme)
           values ($1, (select id from post_patterns where x_account_id = $1 and seed_key = 'p5'), '{1}', '09:00', 'draft', 'other')`,
          [xid],
        ),
      );
      // time out of range
      await expectViolation(c, () =>
        c.query(
          `insert into schedule_slots (x_account_id, pattern_id, weekdays, time_jst, mode, theme)
           values ($1, (select id from post_patterns where x_account_id = $1 and seed_key = 'p1'), '{1}', '22:30', 'draft', 'other')`,
          [xid],
        ),
      );
      // minute not 00/30
      await expectViolation(c, () =>
        c.query(
          `insert into schedule_slots (x_account_id, pattern_id, weekdays, time_jst, mode, theme)
           values ($1, (select id from post_patterns where x_account_id = $1 and seed_key = 'p1'), '{1}', '09:15', 'draft', 'other')`,
          [xid],
        ),
      );
      // weekday out of range
      await expectViolation(c, () =>
        c.query(
          `insert into schedule_slots (x_account_id, pattern_id, weekdays, time_jst, mode, theme)
           values ($1, (select id from post_patterns where x_account_id = $1 and seed_key = 'p1'), '{7}', '09:00', 'draft', 'other')`,
          [xid],
        ),
      );
      // 分野は必須で、値は選択肢マスタ＋other に限る（T-M8-29）
      await expectViolation(c, () =>
        c.query(
          `insert into schedule_slots (x_account_id, pattern_id, weekdays, time_jst, mode, theme)
           values ($1, (select id from post_patterns where x_account_id = $1 and seed_key = 'p1'), '{1}', '09:00', 'draft', 'bogus')`,
          [xid],
        ),
      );
      await expectViolation(c, () =>
        c.query(
          `insert into schedule_slots (x_account_id, pattern_id, weekdays, time_jst, mode)
           values ($1, (select id from post_patterns where x_account_id = $1 and seed_key = 'p1'), '{1}', '09:00', 'draft')`,
          [xid],
        ),
      );
      // 画像ONにproviderの指定は不要（D-6 案B: AI設定のAI用途を正とする）
      await c.query(
        `insert into schedule_slots (x_account_id, pattern_id, weekdays, time_jst, mode, theme, image_enabled)
         values ($1, (select id from post_patterns where x_account_id = $1 and seed_key = 'p1'), '{1}', '09:00', 'draft', 'other', true)`,
        [xid],
      );
    });
  });

  it("enforces usage_events integrity (delta/reason, refund ref, post op, idempotency)", async () => {
    await inTx(async (c) => {
      const { uid } = await makeAccount(c);
      // valid reserve
      await c.query(
        `insert into usage_events (user_id, month, counter_type, operation, delta, reason, idempotency_key)
         values ($1, '2026-07', 'generation', 'generation', 1, 'reserve', 'k1')`,
        [uid],
      );
      // duplicate idempotency_key
      await expectViolation(c, () =>
        c.query(
          `insert into usage_events (user_id, month, counter_type, operation, delta, reason, idempotency_key)
           values ($1, '2026-07', 'generation', 'generation', 1, 'reserve', 'k1')`,
          [uid],
        ),
      );
      // refund must be delta -1
      await expectViolation(c, () =>
        c.query(
          `insert into usage_events (user_id, month, counter_type, operation, delta, reason, idempotency_key)
           values ($1, '2026-07', 'generation', 'generation', 1, 'refund', 'k2')`,
          [uid],
        ),
      );
      // refund requires ref_event_id
      await expectViolation(c, () =>
        c.query(
          `insert into usage_events (user_id, month, counter_type, operation, delta, reason, idempotency_key)
           values ($1, '2026-07', 'generation', 'generation', -1, 'refund', 'k3')`,
          [uid],
        ),
      );
      // post_create must be post_normal/post_url + consume
      await expectViolation(c, () =>
        c.query(
          `insert into usage_events (user_id, month, counter_type, operation, delta, reason, idempotency_key)
           values ($1, '2026-07', 'generation', 'post_create', 1, 'consume', 'k4')`,
          [uid],
        ),
      );
      // bad month format
      await expectViolation(c, () =>
        c.query(
          `insert into usage_events (user_id, month, counter_type, operation, delta, reason, idempotency_key)
           values ($1, '202607', 'generation', 'generation', 1, 'reserve', 'k5')`,
          [uid],
        ),
      );
    });
  });

  it("enforces usage_counters premium limits and PK", async () => {
    await inTx(async (c) => {
      const { uid } = await makeAccount(c);
      await c.query(
        `insert into usage_counters (user_id, month, normal_posts_count) values ($1, '2026-07', 200)`,
        [uid],
      );
      // over premium normal limit
      await expectViolation(c, () =>
        c.query(
          `insert into usage_counters (user_id, month, normal_posts_count) values ($1, '2026-08', 201)`,
          [uid],
        ),
      );
      // duplicate PK (user, month)
      await expectViolation(c, () =>
        c.query(
          `insert into usage_counters (user_id, month) values ($1, '2026-07')`,
          [uid],
        ),
      );
    });
  });

  it("enforces follower_snapshots unique per day and non-negative count", async () => {
    await inTx(async (c) => {
      const { xid } = await makeAccount(c);
      await c.query(
        `insert into follower_snapshots (x_account_id, snapshot_date, followers_count)
         values ($1, '2026-07-20', 100)`,
        [xid],
      );
      await expectViolation(c, () =>
        c.query(
          `insert into follower_snapshots (x_account_id, snapshot_date, followers_count)
           values ($1, '2026-07-20', 110)`,
          [xid],
        ),
      );
      await expectViolation(c, () =>
        c.query(
          `insert into follower_snapshots (x_account_id, snapshot_date, followers_count)
           values ($1, '2026-07-21', -1)`,
          [xid],
        ),
      );
    });
  });

  it("enforces drafts.source_job_id uniqueness", async () => {
    await inTx(async (c) => {
      const { xid } = await makeAccount(c);
      const { rows } = await c.query<{ id: string }>(
        `insert into generation_jobs (x_account_id, kind, trigger, pattern_id)
         values ($1, 'post_generation', 'manual', (select id from post_patterns where x_account_id = $1 and seed_key = 'p1')) returning id`,
        [xid],
      );
      const jid = rows[0].id;
      await c.query(
        `insert into drafts (x_account_id, pattern_id, thread, initial_thread, source_job_id)
         values ($1, (select id from post_patterns where x_account_id = $1 and seed_key = 'p1'), '[]'::jsonb, '[]'::jsonb, $2)`,
        [xid, jid],
      );
      await expectViolation(c, () =>
        c.query(
          `insert into drafts (x_account_id, pattern_id, thread, initial_thread, source_job_id)
           values ($1, (select id from post_patterns where x_account_id = $1 and seed_key = 'p1'), '[]'::jsonb, '[]'::jsonb, $2)`,
          [xid, jid],
        ),
      );
    });
  });

  it("enforces external_api_usage_events checks (operation, status, quantity)", async () => {
    await inTx(async (c) => {
      await c.query(
        `insert into external_api_usage_events (provider, operation, status, quantity, idempotency_key)
         values ('anthropic', 'text_generation', 'succeeded', 1, 'e1')`,
      );
      await expectViolation(c, () =>
        c.query(
          `insert into external_api_usage_events (provider, operation, status, quantity, idempotency_key)
           values ('anthropic', 'bogus_op', 'succeeded', 1, 'e2')`,
        ),
      );
      // quantity=0 は許可（X読取の0件応答を$0で正直に記録する・20260815000002）。負値は違反。
      await c.query(
        `insert into external_api_usage_events (provider, operation, status, quantity, idempotency_key)
         values ('x', 'x_post_read', 'succeeded', 0, 'e3')`,
      );
      await expectViolation(c, () =>
        c.query(
          `insert into external_api_usage_events (provider, operation, status, quantity, idempotency_key)
           values ('anthropic', 'web_search', 'succeeded', -1, 'e4')`,
        ),
      );
    });
  });
});
