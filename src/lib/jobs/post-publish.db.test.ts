import { randomBytes, randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { encryptWithKey } from "../crypto/envelope";
import { closePool, getPool, withTransaction } from "../db/pool";
import type { XCreatePostResult, XDeletePostResult } from "../x/client";
import { X_SCOPES } from "../x/oauth";
import type { Queryable } from "../x/token-refresh";
import { executePostPublish, type PostPublishDeps } from "./post-publish";

/**
 * DB integration for 投稿枠 consume/counter（T-M6-06, 要件03 §7.1/§7.4, 要件04 §10）。
 * X client は mock、DBは実ローカル。全プランで post_create/post_delete consume event を作り、premium かつ
 * live のときだけ月次counter（normal/url_posts_count）を加算することを検証する。
 */
const COST = { contentCreateUsd: 0.01, contentCreateWithUrlUsd: 0.02, interactionDeleteUsd: 0.005 };

describe("post_publish 投稿枠 consume/counter (local DB)", () => {
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

  function post(localId: string, text: string) {
    return { local_id: localId, text, weighted_length: text.length, sources: [], warnings: [] };
  }
  async function seed(
    c: PoolClient,
    opts: { plan: string; thread: ReturnType<typeof post>[] },
  ): Promise<{ uid: string; xid: string; jobId: string; draftId: string }> {
    const uid = randomUUID();
    await c.query(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2)`,
      [uid, `${uid}@example.com`],
    );
    await c.query(
      `insert into profiles (id, email, plan, subscription_status) values ($1,$2,$3::plan_type,'active')
       on conflict (id) do update set plan = excluded.plan, subscription_status = 'active'`,
      [uid, `${uid}@example.com`, opts.plan],
    );
    const xid = (
      await c.query<{ id: string }>(
        `insert into x_accounts (user_id, x_user_id, handle, name, auth_type, status,
            access_token_ciphertext, refresh_token_ciphertext, oauth_scopes, token_expires_at)
         values ($1,$2,'h','n','byok','active',$3,$3,$4, now()+interval '1 hour') returning id`,
        [uid, `x-${randomUUID()}`, encrypt("t"), X_SCOPES],
      )
    ).rows[0].id;
    const draftId = (
      await c.query<{ id: string }>(
        `insert into drafts (x_account_id, pattern, thread, initial_thread, status)
         values ($1,'p1',$2::jsonb,$2::jsonb,'draft') returning id`,
        [xid, JSON.stringify(opts.thread)],
      )
    ).rows[0].id;
    const jobId = (
      await c.query<{ id: string }>(
        `insert into generation_jobs (x_account_id, kind, trigger, draft_id, status)
         values ($1,'post_publish','manual',$2,'running') returning id`,
        [xid, draftId],
      )
    ).rows[0].id;
    return { uid, xid, jobId, draftId };
  }

  function deps(jobId: string, over: Partial<PostPublishDeps> = {}): PostPublishDeps {
    let seq = 0;
    return {
      db,
      jobId,
      runInTx: (fn) => withTransaction((c) => fn(c as unknown as Queryable)),
      getAccessToken: async () => "tok",
      createPost: async (): Promise<XCreatePostResult> => ({
        tweetId: `tw-${++seq}`,
        requestId: null,
        quantity: 1,
        dryRun: false,
      }),
      deletePost: async (): Promise<XDeletePostResult> => ({ deleted: true, requestId: null, quantity: 1, dryRun: false }),
      uploadMedia: async () => ({ mediaId: "m", requestId: null, quantity: 1, dryRun: false }),
      downloadImage: async () => ({ data: Buffer.from("x"), mimeType: "image/webp" }),
      getRecentPosts: async () => [],
      checkTweetExists: async () => true,
      costConfig: COST,
      dailyLimit: 50,
      postingLive: true,
      now: () => Date.now(),
      recordStage: async () => {},
      ...over,
    };
  }

  async function usage(uid: string): Promise<{ normal: number; url: number; creates: number; deletes: number }> {
    return withTransaction(async (c) => {
      const cnt = await c.query<{ normal_posts_count: number; url_posts_count: number }>(
        `select normal_posts_count, url_posts_count from usage_counters where user_id = $1`,
        [uid],
      );
      const ev = await c.query<{ operation: string; n: number }>(
        `select operation, count(*)::int as n from usage_events
          where user_id = $1 and reason = 'consume' group by operation`,
        [uid],
      );
      const by = new Map(ev.rows.map((r) => [r.operation, r.n]));
      return {
        normal: cnt.rows[0]?.normal_posts_count ?? 0,
        url: cnt.rows[0]?.url_posts_count ?? 0,
        creates: by.get("post_create") ?? 0,
        deletes: by.get("post_delete") ?? 0,
      };
    });
  }
  const cleanup = async (uid: string) => {
    await withTransaction((c) => c.query(`delete from usage_events where user_id = $1`, [uid]));
    await withTransaction((c) => c.query(`delete from usage_counters where user_id = $1`, [uid]));
    await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));
  };

  it("premium+live: 3 URL-less posts create 3 post_normal consumes and +3 to normal_posts_count", async () => {
    const { uid, jobId } = await withTransaction((c) =>
      seed(c, { plan: "premium", thread: [post("p1", "本文1"), post("p2", "本文2"), post("p3", "本文3")] }),
    );
    try {
      const res = await executePostPublish(deps(jobId));
      expect(res.status).toBe("posted");
      const u = await usage(uid);
      expect(u.creates).toBe(3);
      expect(u.normal).toBe(3);
      expect(u.url).toBe(0);
    } finally {
      await cleanup(uid);
    }
  });

  it("standard: records consume events only, no counter update", async () => {
    const { uid, jobId } = await withTransaction((c) =>
      seed(c, { plan: "standard", thread: [post("p1", "本文1"), post("p2", "本文2")] }),
    );
    try {
      await executePostPublish(deps(jobId));
      const u = await usage(uid);
      expect(u.creates).toBe(2); // events for all plans
      expect(u.normal).toBe(0); // no counter for BYOK
    } finally {
      await cleanup(uid);
    }
  });

  it("dry_run: records consume events but does not bump the premium counter (要件04 §10)", async () => {
    const { uid, jobId } = await withTransaction((c) =>
      seed(c, { plan: "premium", thread: [post("p1", "本文1"), post("p2", "本文2")] }),
    );
    try {
      await executePostPublish(deps(jobId, { postingLive: false }));
      const u = await usage(uid);
      expect(u.creates).toBe(2); // events recorded (daily-limit validation)
      expect(u.normal).toBe(0); // counter not bumped in dry_run
    } finally {
      await cleanup(uid);
    }
  });

  it("premium+live rollback: create+delete of the same tweet consume the same slot twice", async () => {
    const { uid, jobId } = await withTransaction((c) =>
      seed(c, { plan: "premium", thread: [post("p1", "本文1"), post("p2", "本文2")] }),
    );
    try {
      let n = 0;
      const createPost = async (): Promise<XCreatePostResult> => {
        n += 1;
        if (n >= 2) throw new Error("index1 always fails"); // 1件成功→2件目は両passで失敗
        return { tweetId: "tw-1", requestId: null, quantity: 1, dryRun: false };
      };
      await expect(executePostPublish(deps(jobId, { createPost }))).rejects.toMatchObject({
        code: "post_create_failed",
      });
      const u = await usage(uid);
      expect(u.creates).toBe(1); // 1 create (tw-1)
      expect(u.deletes).toBe(1); // rollback deleted tw-1
      expect(u.normal).toBe(2); // same slot consumed twice (create + delete)
    } finally {
      await cleanup(uid);
    }
  });
});
