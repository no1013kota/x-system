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
const COST = {
  contentCreateUsd: 0.01,
  contentCreateWithUrlUsd: 0.02,
  interactionDeleteUsd: 0.005,
  postReadUsd: 0.005,
  userReadUsd: 0.01,
};

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
  // 原価台帳（X API）を idempotency_key 順で取得する（T-M6-10）。
  async function ledger(
    uid: string,
  ): Promise<
    Array<{ operation: string; status: string; unit_cost_usd: string | null; estimated_cost_usd: string | null; idempotency_key: string }>
  > {
    return withTransaction(async (c) => {
      const r = await c.query<{
        operation: string;
        status: string;
        unit_cost_usd: string | null;
        estimated_cost_usd: string | null;
        idempotency_key: string;
      }>(
        `select operation, status, unit_cost_usd, estimated_cost_usd, idempotency_key
           from external_api_usage_events where user_id = $1 and provider = 'x'
          order by idempotency_key`,
        [uid],
      );
      return r.rows;
    });
  }
  const cleanup = async (uid: string) => {
    await withTransaction((c) => c.query(`delete from usage_events where user_id = $1`, [uid]));
    await withTransaction((c) => c.query(`delete from usage_counters where user_id = $1`, [uid]));
    await withTransaction((c) => c.query(`delete from external_api_usage_events where user_id = $1`, [uid]));
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

  it("premium+live: insufficient monthly slots fail before any X call, no consume, notify (T-M6-07)", async () => {
    const { uid, jobId, draftId } = await withTransaction((c) =>
      seed(c, { plan: "premium", thread: [post("p1", "本文1"), post("p2", "本文2")] }),
    );
    try {
      // error.in_app を有効化して通知を受け取れるようにする。
      await withTransaction((c) =>
        c.query(`update profiles set notification_config = '{"error":{"in_app":true}}'::jsonb where id = $1`, [uid]),
      );
      // 月次counterを上限直下までseed（通常199/200）。2件投稿の required normal = 2 なので不足。
      await withTransaction((c) =>
        c.query(
          `insert into usage_counters (user_id, month, normal_posts_count)
           values ($1, to_char((now() at time zone 'Asia/Tokyo'), 'YYYY-MM'), 199)`,
          [uid],
        ),
      );
      let called = 0;
      const createPost = async (): Promise<XCreatePostResult> => {
        called += 1;
        throw new Error("must not post when slots are insufficient");
      };
      await expect(executePostPublish(deps(jobId, { createPost }))).rejects.toMatchObject({
        code: "usage_limit_exceeded",
      });
      expect(called).toBe(0); // X API を一切呼ばない
      const u = await usage(uid);
      expect(u.creates).toBe(0); // consume event なし
      expect(u.deletes).toBe(0);
      expect(u.normal).toBe(199); // counter 不変
      const notif = await withTransaction((c) =>
        c.query(`select 1 from notifications where user_id = $1 and type = 'error'`, [uid]),
      );
      expect(notif.rowCount).toBe(1); // error 通知
      const d = await withTransaction((c) =>
        c.query<{ status: string }>(`select status from drafts where id = $1`, [draftId]),
      );
      expect(d.rows[0].status).toBe("draft"); // 未投稿へ戻す
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
      // T-M6-10: rollback削除は x_post_delete を削除単価snapshotで記録する。
      const del = (await ledger(uid)).filter((r) => r.operation === "x_post_delete");
      expect(del).toHaveLength(1);
      expect(Number(del[0].unit_cost_usd)).toBeCloseTo(0.005, 6);
      expect(Number(del[0].estimated_cost_usd)).toBeCloseTo(0.005, 6);
    } finally {
      await cleanup(uid);
    }
  });

  it("premium+live records x_post_create with URL-based unit-cost snapshot; media upload adds no ledger row (T-M6-10)", async () => {
    const { uid, draftId, jobId } = await withTransaction((c) =>
      seed(c, { plan: "premium", thread: [post("p1", "本文1"), post("p2", "詳細は https://example.com/x")] }),
    );
    try {
      // ready画像を付与し、media upload が走っても台帳に載らないことを確認する。
      await withTransaction((c) =>
        c.query(`update drafts set images = $2::jsonb where id = $1`, [
          draftId,
          JSON.stringify([
            { local_id: "i1", post_local_id: "p1", storage_path: "u/x/d/i1.webp", mime_type: "image/webp", status: "ready" },
          ]),
        ]),
      );
      let mediaCalls = 0;
      const res = await executePostPublish(
        deps(jobId, {
          uploadMedia: async () => {
            mediaCalls += 1;
            return { mediaId: "m", requestId: null, quantity: 1, dryRun: false };
          },
        }),
      );
      expect(res.status).toBe("posted");
      expect(mediaCalls).toBe(1); // media upload は実行された

      const rows = await ledger(uid);
      const creates = rows.filter((r) => r.operation === "x_post_create");
      expect(creates).toHaveLength(2);
      // 台帳には x_post_create のみ（media upload 行は作られない・要件04 §10）。
      expect(rows.every((r) => r.operation === "x_post_create")).toBe(true);
      // URL有無に応じた単価snapshot（p1=通常0.01・p2=URL0.02）。ledger は idempotency_key 昇順。
      expect(Number(creates[0].unit_cost_usd)).toBeCloseTo(0.01, 6);
      expect(Number(creates[1].unit_cost_usd)).toBeCloseTo(0.02, 6);
      expect(Number(creates[1].estimated_cost_usd)).toBeCloseTo(0.02, 6);
      // 冪等keyは index ベースで安定（reconcile/再処理でも unique 制約で重複しない）。
      expect(creates.map((r) => r.idempotency_key)).toEqual([
        `draft:${draftId}:x_post_create:0`,
        `draft:${draftId}:x_post_create:1`,
      ]);
    } finally {
      await cleanup(uid);
    }
  });

  it("dry_run records nothing in the cost ledger (T-M6-10)", async () => {
    const { uid, jobId } = await withTransaction((c) =>
      seed(c, { plan: "premium", thread: [post("p1", "本文1"), post("p2", "本文2")] }),
    );
    try {
      let k = 0;
      const dryCreate = async (): Promise<XCreatePostResult> => ({
        tweetId: `tw-dry-${++k}`,
        requestId: null,
        quantity: 1,
        dryRun: true,
      });
      await executePostPublish(deps(jobId, { createPost: dryCreate }));
      const rows = await ledger(uid);
      expect(rows).toHaveLength(0); // dry_run は実原価が無いため記録しない
    } finally {
      await cleanup(uid);
    }
  });
});
