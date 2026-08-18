import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closePool, getPool, withTransaction } from "../db/pool";
import { finalizeFailedJob } from "./terminal";

/**
 * DB integration tests for the stale terminal handler (T-M4-08, 要件04 §4, 要件03 §7.3/§7.5).
 * Skips without the local Supabase stack.
 */
describe("finalizeFailedJob (db)", () => {
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
    await c.query(
      `insert into profiles (id, email, notification_config)
       values ($1, $2, '{"error":{"in_app":true},"draft_created":{"in_app":true}}'::jsonb)
       on conflict (id) do update set notification_config = excluded.notification_config`,
      [uid, `${uid}@example.com`],
    );
    const { rows } = await c.query<{ id: string }>(
      `insert into x_accounts (user_id, x_user_id, handle, name, auth_type)
       values ($1, $2, 'h', 'n', 'byok') returning id`,
      [uid, `x-${randomUUID()}`],
    );
    return { uid, xid: rows[0].id };
  }

  async function insertJob(
    c: PoolClient,
    xid: string,
    kind: string,
    over: { draftId?: string; sourceId?: string; parentId?: string; input?: object } = {},
  ): Promise<string> {
    // `post_generation` はパターンを必須にする（T-M8-129 U2）。
    const { rows } = await c.query<{ id: string }>(
      `insert into generation_jobs
         (x_account_id, kind, trigger, pattern_id, status, draft_id, learning_source_id, parent_job_id, input)
       values ($1, $2::job_kind, 'manual', (select id from post_patterns where x_account_id = $1 and seed_key = $7), 'failed', $3, $4, $5, $6::jsonb)
       returning id`,
      [
        xid,
        kind,
        over.draftId ?? null,
        over.sourceId ?? null,
        over.parentId ?? null,
        JSON.stringify(over.input ?? {}),
        kind === "post_generation" ? "p1" : null,
      ],
    );
    return rows[0].id;
  }

  it("refunds a generation reserve exactly once across two tick runs (idempotent)", async () => {
    const { uid, xid } = await withTransaction((c) => makeAccount(c));
    try {
      const jobId = await withTransaction((c) => insertJob(c, xid, "post_generation"));
      const month = await withTransaction(async (c) => {
        const { rows } = await c.query<{ m: string }>(
          `select to_char((now() at time zone 'Asia/Tokyo'), 'YYYY-MM') as m`,
        );
        return rows[0].m;
      });
      // Simulate an M6 reserve: usage_events + usage_counters=1.
      await withTransaction(async (c) => {
        await c.query(
          `insert into usage_events
             (user_id, x_account_id, job_id, month, counter_type, operation, delta, reason, idempotency_key)
           values ($1, $2, $3, $4, 'generation', 'generation', 1, 'reserve', $5)`,
          [uid, xid, jobId, month, `job:${jobId}:generation:reserve`],
        );
        await c.query(
          `insert into usage_counters (user_id, month, ai_credits_used) values ($1, $2, 1)`,
          [uid, month],
        );
      });

      await withTransaction((c) => finalizeFailedJob(c, jobId, "post_generation"));
      await withTransaction((c) => finalizeFailedJob(c, jobId, "post_generation"));

      const { refunds, count } = await withTransaction(async (c) => {
        const r = await c.query<{ n: number }>(
          `select count(*)::int as n from usage_events
            where job_id = $1 and reason = 'refund'`,
          [jobId],
        );
        const cc = await c.query<{ ai_credits_used: number }>(
          `select ai_credits_used from usage_counters where user_id = $1 and month = $2`,
          [uid, month],
        );
        return { refunds: r.rows[0].n, count: cc.rows[0].ai_credits_used };
      });
      expect(refunds).toBe(1); // 二重返還されない
      expect(count).toBe(0); // 1 → 0
    } finally {
      // usage_events.user_id / usage_counters.user_id は on delete restrict のため先に消す。
      await withTransaction((c) => c.query(`delete from usage_events where user_id = $1`, [uid]));
      await withTransaction((c) => c.query(`delete from usage_counters where user_id = $1`, [uid]));
      await withTransaction((c) => c.query(`delete from x_accounts where id = $1`, [xid]));
      await withTransaction((c) => c.query(`delete from profiles where id = $1`, [uid]));
    }
  });

  it("suggestion stale: refunds the generation reserve (premium) and notifies", async () => {
    const { uid, xid } = await withTransaction((c) => makeAccount(c));
    try {
      const jobId = await withTransaction((c) => insertJob(c, xid, "suggestion"));
      const month = await withTransaction(async (c) => {
        const { rows } = await c.query<{ m: string }>(
          `select to_char((now() at time zone 'Asia/Tokyo'), 'YYYY-MM') as m`,
        );
        return rows[0].m;
      });
      await withTransaction(async (c) => {
        await c.query(
          `insert into usage_events
             (user_id, x_account_id, job_id, month, counter_type, operation, delta, reason, idempotency_key)
           values ($1, $2, $3, $4, 'generation', 'generation', 1, 'reserve', $5)`,
          [uid, xid, jobId, month, `job:${jobId}:generation:reserve`],
        );
        await c.query(`insert into usage_counters (user_id, month, ai_credits_used) values ($1, $2, 1)`, [uid, month]);
      });

      await withTransaction((c) => finalizeFailedJob(c, jobId, "suggestion"));

      const count = (
        await withTransaction((c) =>
          c.query<{ ai_credits_used: number }>(
            `select ai_credits_used from usage_counters where user_id = $1 and month = $2`,
            [uid, month],
          ),
        )
      ).rows[0].ai_credits_used;
      expect(count).toBe(0); // reserve refunded (1 → 0), no leak
    } finally {
      await withTransaction((c) => c.query(`delete from usage_events where user_id = $1`, [uid]));
      await withTransaction((c) => c.query(`delete from usage_counters where user_id = $1`, [uid]));
      await withTransaction((c) => c.query(`delete from x_accounts where id = $1`, [xid]));
      await withTransaction((c) => c.query(`delete from profiles where id = $1`, [uid]));
    }
  });

  it("post_publish stale: reverts draft posting→failed with last_post_error", async () => {
    const { uid, xid } = await withTransaction((c) => makeAccount(c));
    try {
      const { jobId } = await withTransaction(async (c) => {
        const { rows } = await c.query<{ id: string }>(
          `insert into drafts (x_account_id, pattern_id, thread, initial_thread, status)
           values ($1, (select id from post_patterns where x_account_id = $1 and seed_key = 'p1'), '[]'::jsonb, '[]'::jsonb, 'posting') returning id`,
          [xid],
        );
        const draftId = rows[0].id;
        const jobId = await insertJob(c, xid, "post_publish", { draftId });
        return { draftId, jobId };
      });

      await withTransaction((c) => finalizeFailedJob(c, jobId, "post_publish"));

      const draft = await withTransaction(async (c) => {
        const { rows } = await c.query<{ status: string; last_post_error: { code: string } | null }>(
          `select d.status, d.last_post_error from drafts d
             join generation_jobs gj on gj.draft_id = d.id where gj.id = $1`,
          [jobId],
        );
        return rows[0];
      });
      expect(draft.status).toBe("failed");
      expect(draft.last_post_error?.code).toBe("stale_timeout");
    } finally {
      await withTransaction((c) => c.query(`delete from x_accounts where id = $1`, [xid]));
      await withTransaction((c) => c.query(`delete from profiles where id = $1`, [uid]));
    }
  });

  it("image_generation auto stale: marks image failed and creates a post_publish child", async () => {
    const { uid, xid } = await withTransaction((c) => makeAccount(c));
    try {
      const { draftId, imageJobId } = await withTransaction(async (c) => {
        const { rows } = await c.query<{ id: string }>(
          `insert into drafts (x_account_id, pattern_id, thread, initial_thread, status, images)
           values ($1, (select id from post_patterns where x_account_id = $1 and seed_key = 'p1'), '[]'::jsonb, '[]'::jsonb, 'draft', '[]'::jsonb) returning id`,
          [xid],
        );
        const draftId = rows[0].id;
        // parent post_generation carries mode=auto (schedule origin)
        const parentId = await insertJob(c, xid, "post_generation", { draftId, input: { mode: "auto" } });
        const imageJobId = await insertJob(c, xid, "image_generation", { draftId, parentId });
        return { draftId, imageJobId };
      });

      await withTransaction((c) => finalizeFailedJob(c, imageJobId, "image_generation"));

      const res = await withTransaction(async (c) => {
        const d = await c.query<{ images: { status: string }[] }>(
          `select images from drafts where id = $1`,
          [draftId],
        );
        const pub = await c.query<{ input: { mode: string }; request_key: string }>(
          `select input, request_key from generation_jobs
            where draft_id = $1 and kind = 'post_publish'`,
          [draftId],
        );
        return { images: d.rows[0].images, pub: pub.rows[0] };
      });
      expect(res.images[0]?.status).toBe("failed");
      expect(res.pub?.input.mode).toBe("auto");
      expect(res.pub?.request_key).toBe(`job:${draftId}:post_publish:auto`);
    } finally {
      await withTransaction((c) => c.query(`delete from x_accounts where id = $1`, [xid]));
      await withTransaction((c) => c.query(`delete from profiles where id = $1`, [uid]));
    }
  });

  it("md_merge stale: reverts source removing→analyzed and creates a job:{id}:failed notification", async () => {
    const { uid, xid } = await withTransaction((c) => makeAccount(c));
    try {
      const { sourceId, jobId } = await withTransaction(async (c) => {
        const { rows } = await c.query<{ id: string }>(
          `insert into learning_sources (x_account_id, type, status)
           values ($1, 'ref_post', 'removing') returning id`,
          [xid],
        );
        const sourceId = rows[0].id;
        const jobId = await insertJob(c, xid, "md_merge", { sourceId });
        return { sourceId, jobId };
      });

      await withTransaction((c) => finalizeFailedJob(c, jobId, "md_merge"));

      const res = await withTransaction(async (c) => {
        const s = await c.query<{ status: string }>(
          `select status from learning_sources where id = $1`,
          [sourceId],
        );
        const n = await c.query<{ dedupe_key: string }>(
          `select dedupe_key from notifications where user_id = $1 and type = 'error'`,
          [uid],
        );
        return { status: s.rows[0].status, dedupe: n.rows[0]?.dedupe_key };
      });
      expect(res.status).toBe("analyzed");
      expect(res.dedupe).toBe(`job:${jobId}:failed`);
    } finally {
      await withTransaction((c) => c.query(`delete from x_accounts where id = $1`, [xid]));
      await withTransaction((c) => c.query(`delete from profiles where id = $1`, [uid]));
    }
  });
});
