import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  loadAnalyticsForUser,
  loadFollowerSnapshotsForUser,
  loadSuggestionsForUser,
} from "./analytics-server";
import { closePool, getPool, withTransaction } from "./db/pool";

/**
 * DB integration for analytics loader (SC-09, T-M5-15): posted と remaining を持つ failed を期間で選定し、
 * remaining の無い failed / 期間外 / 他ユーザーは除外する。
 */
describe("analytics loader (local DB)", () => {
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

  async function seed(c: PoolClient): Promise<{ uid: string; xid: string }> {
    const uid = randomUUID();
    await c.query(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2)`,
      [uid, `${uid}@example.com`],
    );
    await c.query(`insert into profiles (id, email) values ($1,$2) on conflict (id) do nothing`, [uid, `${uid}@example.com`]);
    const xid = (
      await c.query<{ id: string }>(
        `insert into x_accounts (user_id, x_user_id, handle, name, auth_type, status)
         values ($1,$2,'h','n','byok','active') returning id`,
        [uid, `x-${randomUUID()}`],
      )
    ).rows[0].id;
    return { uid, xid };
  }

  async function insertDraft(
    c: PoolClient,
    xid: string,
    opts: { status: string; tweetIds: string[]; postedDaysAgo: number | null; lastPostError?: unknown },
  ): Promise<string> {
    return (
      await c.query<{ id: string }>(
        `insert into drafts (x_account_id, pattern, thread, initial_thread, status, tweet_ids, last_post_error, posted_at)
         values ($1,'p1','[]'::jsonb,'[]'::jsonb,$2,$3::jsonb,$4::jsonb,
                 case when $5::int is null then null else now() - ($5 || ' days')::interval end)
         returning id`,
        [xid, opts.status, JSON.stringify(opts.tweetIds), opts.lastPostError ? JSON.stringify(opts.lastPostError) : null, opts.postedDaysAgo],
      )
    ).rows[0].id;
  }

  it("selects posted + failed-with-remaining in period; excludes others", async () => {
    const { uid, xid } = await withTransaction((c) => seed(c));
    const ids = await withTransaction(async (c) => ({
      posted: await insertDraft(c, xid, { status: "posted", tweetIds: ["a"], postedDaysAgo: 5 }),
      failedRemaining: await insertDraft(c, xid, {
        status: "failed",
        tweetIds: ["b", "c"],
        postedDaysAgo: 5,
        lastPostError: { remaining_tweet_ids: ["b"], deleted_tweet_ids: ["c"] },
      }),
      failedNoRemaining: await insertDraft(c, xid, {
        status: "failed",
        tweetIds: [],
        postedDaysAgo: 5,
        lastPostError: { remaining_tweet_ids: [], deleted_tweet_ids: ["x"] },
      }),
      draftOnly: await insertDraft(c, xid, { status: "draft", tweetIds: [], postedDaysAgo: null }),
      tooOld: await insertDraft(c, xid, { status: "posted", tweetIds: ["z"], postedDaysAgo: 200 }),
    }));
    try {
      const rows = await loadAnalyticsForUser(uid, xid, 90);
      const got = new Set(rows.map((r) => r.draftId));
      expect(got.has(ids.posted)).toBe(true);
      expect(got.has(ids.failedRemaining)).toBe(true);
      expect(got.has(ids.failedNoRemaining)).toBe(false); // no remaining → excluded
      expect(got.has(ids.draftOnly)).toBe(false); // not posted
      expect(got.has(ids.tooOld)).toBe(false); // outside 90d window
    } finally {
      await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));
    }
  });

  it("does not return another user's drafts", async () => {
    const owner = await withTransaction((c) => seed(c));
    const other = await withTransaction((c) => seed(c));
    await withTransaction((c) => insertDraft(c, owner.xid, { status: "posted", tweetIds: ["a"], postedDaysAgo: 1 }));
    try {
      const rows = await loadAnalyticsForUser(other.uid, owner.xid, 90);
      expect(rows).toHaveLength(0); // ownership mismatch
    } finally {
      await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [owner.uid]));
      await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [other.uid]));
    }
  });

  it("loads suggestions with evidence bodies/links and the generating flag", async () => {
    const { uid, xid } = await withTransaction((c) => seed(c));
    try {
      await withTransaction(async (c: PoolClient) => {
        // posted draft mapping t1 → 本文
        await insertDraft(c, xid, { status: "posted", tweetIds: ["t1"], postedDaysAgo: 3 });
        await c.query(`update drafts set thread = $2::jsonb where x_account_id = $1`, [
          xid,
          JSON.stringify([{ text: "朝9時のノウハウ投稿" }]),
        ]);
        const job = (
          await c.query<{ id: string }>(
            `insert into generation_jobs (x_account_id, kind, trigger, status, finished_at)
             values ($1,'suggestion','manual','succeeded', now()) returning id`,
            [xid],
          )
        ).rows[0].id;
        await c.query(
          `insert into improvement_suggestions (x_account_id, source_job_id, content, evidence)
           values ($1,$2,'朝の投稿を増やす',$3::jsonb)`,
          [
            xid,
            job,
            JSON.stringify({ tweet_ids: ["t1"], metric: "impressions", checkpoint_days: 7, diff_pct: 40, summary: "根拠", window_days: 30 }),
          ],
        );
      });

      const section = await loadSuggestionsForUser(uid, xid);
      expect(section.generating).toBe(false);
      expect(section.suggestions).toHaveLength(1);
      const s = section.suggestions[0];
      expect(s).toMatchObject({ content: "朝の投稿を増やす", metric: "impressions", checkpointDays: 7, diffPct: 40 });
      expect(s.posts[0]).toMatchObject({ tweetId: "t1", body: "朝9時のノウハウ投稿" });
      expect(s.posts[0].url).toContain("/status/t1");

      // queued suggestion job → generating true
      await withTransaction((c) =>
        c.query(`insert into generation_jobs (x_account_id, kind, trigger, status) values ($1,'suggestion','manual','queued')`, [xid]),
      );
      expect((await loadSuggestionsForUser(uid, xid)).generating).toBe(true);
    } finally {
      await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));
    }
  });

  it("loads follower snapshots in period, ascending, owner-scoped", async () => {
    const { uid, xid } = await withTransaction((c) => seed(c));
    await withTransaction(async (c) => {
      await c.query(
        `insert into follower_snapshots (x_account_id, snapshot_date, followers_count) values
           ($1, (now() at time zone 'Asia/Tokyo')::date - 3, 100),
           ($1, (now() at time zone 'Asia/Tokyo')::date - 1, 130),
           ($1, (now() at time zone 'Asia/Tokyo')::date - 200, 10)`,
        [xid],
      );
    });
    try {
      const rows = await loadFollowerSnapshotsForUser(uid, xid, 90);
      expect(rows.map((r) => r.count)).toEqual([100, 130]); // ascending, 200d-ago excluded
      // owner-scoped
      const otherUser = randomUUID();
      expect(await loadFollowerSnapshotsForUser(otherUser, xid, 90)).toHaveLength(0);
    } finally {
      await withTransaction((c) => c.query(`delete from follower_snapshots where x_account_id = $1`, [xid]));
      await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));
    }
  });
});
