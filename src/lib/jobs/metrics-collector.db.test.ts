import { randomBytes, randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { encryptWithKey } from "../crypto/envelope";
import { closePool, getPool, withTransaction } from "../db/pool";
import type { XTweetMetrics } from "../x/client";
import { X_SCOPES } from "../x/oauth";
import type { Queryable } from "../x/token-refresh";
import {
  executeMetricsCollection,
  type MetricsCollectorDeps,
  type TweetMetricsMap,
} from "./metrics-collector";

/**
 * DB integration for metrics_collector (K-1, 要件04 §13, 要件02 §4.9, T-M5-12): due選定・checkpoint保存・
 * next_metrics_at前進・null保存・再取得上書き・上限/deferred。X読取は mock を注入（原価台帳は経由しない）。
 */
const DAY = 86_400_000;

describe("metrics_collector (local DB)", () => {
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

  async function seedAccount(): Promise<{ uid: string; xid: string }> {
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
          `insert into x_accounts
             (user_id, x_user_id, handle, name, auth_type, status,
              access_token_ciphertext, refresh_token_ciphertext, oauth_scopes, token_expires_at)
           values ($1,$2,'h','n','byok','active',$3,$3,$4, now() + interval '1 hour')
           returning id`,
          [uid, `x-${randomUUID()}`, encrypt("t"), X_SCOPES],
        )
      ).rows[0].id;
      return { uid, xid };
    });
  }

  async function seedPostedDraft(
    xid: string,
    tweetIds: string[],
    opts: { postedDaysAgo: number; nextDueDaysAgo: number },
  ): Promise<string> {
    return withTransaction(async (c: PoolClient) => {
      const id = (
        await c.query<{ id: string }>(
          `insert into drafts
             (x_account_id, pattern, thread, initial_thread, status, tweet_ids, posted_at, next_metrics_at)
           values ($1,'p1','[]'::jsonb,'[]'::jsonb,'posted',$2::jsonb,
                   now() - ($3 || ' days')::interval, now() - ($4 || ' minutes')::interval)
           returning id`,
          [xid, JSON.stringify(tweetIds), String(opts.postedDaysAgo), String(opts.nextDueDaysAgo * 1440)],
        )
      ).rows[0].id;
      return id;
    });
  }

  function mockDeps(
    xid: string,
    tweetsById: Record<string, XTweetMetrics>,
    over: Partial<MetricsCollectorDeps> = {},
  ): MetricsCollectorDeps {
    return {
      db,
      runInTx: (fn) => withTransaction((c) => fn(c as unknown as Queryable)),
      now: new Date(),
      isPastDeadline: () => false,
      getAccessToken: async (id) => (id === xid ? "tok" : null), // 他テストのアカウントはskip
      readTweetMetrics: async ({ tweetIds }) => tweetIds.map((t) => tweetsById[t]).filter(Boolean),
      ...over,
    };
  }

  async function readDraft(id: string): Promise<{ tweet_metrics: TweetMetricsMap; next_metrics_at: string | null }> {
    return (
      await db.query<{ tweet_metrics: TweetMetricsMap; next_metrics_at: string | null }>(
        `select tweet_metrics, next_metrics_at from drafts where id = $1`,
        [id],
      )
    ).rows[0];
  }

  const cleanup = (uid: string) =>
    withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));

  it("collects checkpoint 1, saves values (0 vs null), advances next_metrics_at to +7d", async () => {
    const { uid, xid } = await seedAccount();
    const t1 = `t-${randomUUID()}`;
    const t2 = `t-${randomUUID()}`;
    const draftId = await seedPostedDraft(xid, [t1, t2], { postedDaysAgo: 2, nextDueDaysAgo: 1 });
    try {
      const tweets: Record<string, XTweetMetrics> = {
        [t1]: { id: t1, text: null, publicMetrics: { impression_count: 100, like_count: 0, retweet_count: 3 }, nonPublicMetrics: { user_profile_clicks: 7 } },
        // t2 omitted from response → unavailable this round → no checkpoint saved (T-M5-13 confirms unavailable)
      };
      const res = await executeMetricsCollection(mockDeps(xid, tweets));
      expect(res.draftsProcessed).toBeGreaterThanOrEqual(1);

      const d = await readDraft(draftId);
      expect(d.tweet_metrics[t1].checkpoints["1"]).toMatchObject({
        impressions: 100,
        likes: 0,
        reposts: 3,
        profile_clicks: 7,
      });
      expect(d.tweet_metrics[t2]).toBeUndefined(); // missing tweet → no checkpoint
      // next_metrics_at advanced to posted_at + 7d (posted ~2d ago → ~+5d from now)
      const next = new Date(d.next_metrics_at!).getTime();
      expect(next).toBeGreaterThan(Date.now() + 4 * DAY);
      expect(next).toBeLessThan(Date.now() + 6 * DAY);
    } finally {
      await cleanup(uid);
    }
  });

  it("collects remaining_tweet_ids for a status=failed draft (partial failure) using posted_at anchor", async () => {
    const { uid, xid } = await seedAccount();
    const live = `t-${randomUUID()}`;
    const deleted = `t-${randomUUID()}`;
    // post-publish の部分失敗と同じ状態: status=failed・posted_at設定済み・remaining=live・deleted除外。
    const draftId = await withTransaction(async (c: PoolClient) => {
      return (
        await c.query<{ id: string }>(
          `insert into drafts
             (x_account_id, pattern, thread, initial_thread, status, tweet_ids, last_post_error,
              posted_at, next_metrics_at)
           values ($1,'p1','[]'::jsonb,'[]'::jsonb,'failed','[]'::jsonb,$2::jsonb,
                   now() - interval '2 days', now() - interval '1 day')
           returning id`,
          [xid, JSON.stringify({ remaining_tweet_ids: [live], deleted_tweet_ids: [deleted] })],
        )
      ).rows[0].id;
    });
    try {
      const tweets = {
        [live]: { id: live, text: null, publicMetrics: { impression_count: 42 }, nonPublicMetrics: null },
        [deleted]: { id: deleted, text: null, publicMetrics: { impression_count: 999 }, nonPublicMetrics: null },
      };
      await executeMetricsCollection(mockDeps(xid, tweets));
      const d = await readDraft(draftId);
      expect(d.tweet_metrics[live].checkpoints["1"]?.impressions).toBe(42); // remaining collected
      expect(d.tweet_metrics[deleted]).toBeUndefined(); // rollback-deleted excluded, never read
      const next = new Date(d.next_metrics_at!).getTime();
      expect(next).toBeGreaterThan(Date.now() + 4 * DAY); // advanced to posted_at + 7d
    } finally {
      await cleanup(uid);
    }
  });

  it("re-running after advance does not re-collect (not due) and keeps checkpoint", async () => {
    const { uid, xid } = await seedAccount();
    const t1 = `t-${randomUUID()}`;
    const draftId = await seedPostedDraft(xid, [t1], { postedDaysAgo: 2, nextDueDaysAgo: 1 });
    try {
      const tweets = { [t1]: { id: t1, text: null, publicMetrics: { impression_count: 10 }, nonPublicMetrics: null } };
      await executeMetricsCollection(mockDeps(xid, tweets));
      const after1 = await readDraft(draftId);
      // second run: next_metrics_at now in the future → not selected → unchanged
      await executeMetricsCollection(mockDeps(xid, { [t1]: { id: t1, text: null, publicMetrics: { impression_count: 999 }, nonPublicMetrics: null } }));
      const after2 = await readDraft(draftId);
      expect(after2.tweet_metrics[t1].checkpoints["1"]?.impressions).toBe(10); // not overwritten (not due)
      expect(new Date(after2.next_metrics_at!).getTime()).toBe(new Date(after1.next_metrics_at!).getTime());
    } finally {
      await cleanup(uid);
    }
  });

  it("defers remaining drafts once the Function deadline is hit", async () => {
    const { uid, xid } = await seedAccount();
    const ta = `t-${randomUUID()}`;
    const tb = `t-${randomUUID()}`;
    // dA is more overdue → processed first within the account.
    const dA = await seedPostedDraft(xid, [ta], { postedDaysAgo: 2, nextDueDaysAgo: 2 });
    const dB = await seedPostedDraft(xid, [tb], { postedDaysAgo: 2, nextDueDaysAgo: 1 });
    try {
      const tweets = {
        [ta]: { id: ta, text: null, publicMetrics: { impression_count: 1 }, nonPublicMetrics: null },
        [tb]: { id: tb, text: null, publicMetrics: { impression_count: 2 }, nonPublicMetrics: null },
      };
      // Deadline hit after the first read (per-run closure, isolated from other test files).
      let reads = 0;
      const res = await executeMetricsCollection(
        mockDeps(xid, tweets, {
          isPastDeadline: () => reads >= 1,
          readTweetMetrics: async ({ tweetIds }) => {
            reads += 1;
            return tweetIds.map((t) => tweets[t as keyof typeof tweets]).filter(Boolean);
          },
        }),
      );
      expect(res.deferred).toBe(true);
      expect(Boolean((await readDraft(dA)).tweet_metrics[ta]?.checkpoints["1"])).toBe(true);
      expect(Boolean((await readDraft(dB)).tweet_metrics[tb]?.checkpoints["1"])).toBe(false);
    } finally {
      await cleanup(uid);
    }
  });
});
