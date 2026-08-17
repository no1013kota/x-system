import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closePool, getPool, withTransaction } from "../db/pool";
import type { Queryable } from "../x/token-refresh";
import {
  loadDraftTagRows,
  loadStoredTimeline,
  newestStoredPostedAt,
  upsertTimelinePosts,
} from "./suggestion-timeline-store";

/**
 * `x_timeline_posts` の読み書き（T-M8-94・実DB）。
 * 増分取得の要は upsert の振る舞い——重なり分でメトリクスが更新されること、
 * 型/テーマが一度付いたら保持されること、読み出しが新しい順であること。
 */
const pooledDb: Queryable = {
  query: <T = unknown>(sql: string, params?: unknown[]) =>
    getPool().query(sql, params) as unknown as Promise<{ rows: T[]; rowCount: number | null }>,
};

function xPost(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    text: `本文 ${id}`,
    createdAt: "2026-08-10T03:00:00.000Z",
    inReplyToId: null,
    impressions: 100,
    likes: 5,
    reposts: 1,
    replies: 0,
    hasMedia: false,
    hasUrl: false,
    ...over,
  };
}

describe("suggestion-timeline-store (local DB)", () => {
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

  async function seed(): Promise<{ uid: string; xid: string }> {
    return withTransaction(async (c: PoolClient) => {
      const uid = randomUUID();
      await c.query(
        `insert into auth.users (id, instance_id, aud, role, email)
         values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2)`,
        [uid, `${uid}@example.com`],
      );
      await c.query(`insert into profiles (id, email) values ($1,$2) on conflict (id) do nothing`, [
        uid,
        `${uid}@example.com`,
      ]);
      const xid = (
        await c.query<{ id: string }>(
          `insert into x_accounts (user_id, x_user_id, handle, name, auth_type, status)
           values ($1,$2,'h','n','byok','active') returning id`,
          [uid, `x-${randomUUID()}`],
        )
      ).rows[0].id;
      return { uid, xid };
    });
  }

  const cleanup = (uid: string) =>
    withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));

  it("loadDraftTagRows が実スキーマで動き、テーマを生成job（source_job_id）から引く", async () => {
    // 2026-08-15、`d.input`（存在しない列）を参照していて実アカウントの初回実行まで発覚しなかった。
    // SQLの列参照は実DBでしか守れないので、このテストが正本。
    const { uid, xid } = await seed();
    try {
      await withTransaction(async (c) => {
        const jobId = (
          await c.query<{ id: string }>(
            `insert into generation_jobs (x_account_id, kind, trigger, pattern, status, input, finished_at)
             values ($1,'post_generation','manual','p1','succeeded','{"theme":"ai"}','2026-08-01') returning id`,
            [xid],
          )
        ).rows[0].id;
        await c.query(
          `insert into drafts (x_account_id, pattern, thread, initial_thread, status, source_job_id, tweet_ids)
           values ($1,'p3','[]','[]','posted',$2,'["9100000000000001","9100000000000002"]')`,
          [xid, jobId],
        );
        // source_job_id の無い下書き（テーマnullでも行は返る）。
        await c.query(
          `insert into drafts (x_account_id, pattern, thread, initial_thread, status, tweet_ids)
           values ($1,'p1','[]','[]','posted','["9100000000000003"]')`,
          [xid],
        );
        // tweet_ids が空の行は対象外。
        await c.query(
          `insert into drafts (x_account_id, pattern, thread, initial_thread, status)
           values ($1,'p2','[]','[]','draft')`,
          [xid],
        );
      });

      const rows = await loadDraftTagRows(pooledDb, xid);
      expect(rows).toHaveLength(2);
      const tagged = rows.find((r) => r.pattern === "p3");
      expect(tagged?.theme).toBe("ai");
      expect(tagged?.tweet_ids).toEqual(["9100000000000001", "9100000000000002"]);
      const untagged = rows.find((r) => r.pattern === "p1");
      expect(untagged?.theme).toBeNull();
    } finally {
      await cleanup(uid);
    }
  });

  it("初回insert→重なり再取得のupsertでメトリクスが更新される（増分取得の要）", async () => {
    const { uid, xid } = await seed();
    try {
      await upsertTimelinePosts(pooledDb, xid, [xPost("t1", { impressions: 100 })], new Map());
      // 翌朝の重なり再取得: 同じ投稿の伸びたメトリクスで上書きされる。
      await upsertTimelinePosts(pooledDb, xid, [xPost("t1", { impressions: 2500, likes: 40 })], new Map());
      const rows = await loadStoredTimeline(pooledDb, xid);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ tweet_id: "t1", impressions: 2500, likes: 40 });
    } finally {
      await cleanup(uid);
    }
  });

  it("型/テーマは一度付いたら保持される（後からnullで上書きしない）", async () => {
    const { uid, xid } = await seed();
    try {
      await upsertTimelinePosts(
        pooledDb,
        xid,
        [xPost("t1")],
        new Map([["t1", { pattern: "p3", theme: "ai" }]]),
      );
      // 再取得時にdraftsの行が消えていてタグが引けなくても、保存済みのタグを失わない。
      await upsertTimelinePosts(pooledDb, xid, [xPost("t1", { impressions: 500 })], new Map());
      const rows = await loadStoredTimeline(pooledDb, xid);
      expect(rows[0]).toMatchObject({ pattern: "p3", theme: "ai", impressions: 500 });
    } finally {
      await cleanup(uid);
    }
  });

  it("newestStoredPostedAt が増分の基準を返す（無ければ null＝初回30日）", async () => {
    const { uid, xid } = await seed();
    try {
      expect(await newestStoredPostedAt(pooledDb, xid)).toBeNull();
      await upsertTimelinePosts(
        pooledDb,
        xid,
        [
          xPost("t1", { createdAt: "2026-08-01T00:00:00.000Z" }),
          xPost("t2", { createdAt: "2026-08-10T00:00:00.000Z" }),
        ],
        new Map(),
      );
      const newest = await newestStoredPostedAt(pooledDb, xid);
      expect(newest).toContain("2026-08-10");
    } finally {
      await cleanup(uid);
    }
  });

  it("読み出しは新しい順（分析はこの順でLLMへ渡る）", async () => {
    const { uid, xid } = await seed();
    try {
      await upsertTimelinePosts(
        pooledDb,
        xid,
        [
          xPost("old", { createdAt: "2026-08-01T00:00:00.000Z" }),
          xPost("new", { createdAt: "2026-08-12T00:00:00.000Z" }),
        ],
        new Map(),
      );
      const rows = await loadStoredTimeline(pooledDb, xid);
      expect(rows.map((r) => r.tweet_id)).toEqual(["new", "old"]);
    } finally {
      await cleanup(uid);
    }
  });
});
