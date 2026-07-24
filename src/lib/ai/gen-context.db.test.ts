import { randomBytes, randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { encryptWithKey } from "../crypto/envelope";
import { closePool, getPool, withTransaction } from "../db/pool";
import { X_SCOPES } from "../x/oauth";
import { fetchNewsDigest, fetchRecentPostBodies } from "./gen-context";
import type { Queryable } from "../x/token-refresh";

/**
 * DB integration for GEN context sources (T-M3-04, プロンプト設計書 §4.1):
 * recent_posts from posted drafts (newest, max 10, first post) and the P-6 news digest
 * (last 7 days, impact-priority, category-scoped). Skips without the local stack.
 */
describe("gen-context DB sources (local DB)", () => {
  let available = false;
  const testKey = randomBytes(32);
  const encrypt = (p: string) => encryptWithKey(p, testKey);
  const db: Queryable = {
    query: <T = unknown>(sql: string, params?: unknown[]) =>
      getPool().query(sql, params) as unknown as Promise<{
        rows: T[];
        rowCount: number | null;
      }>,
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

  async function makeAccount(c: PoolClient): Promise<string> {
    const uid = randomUUID();
    await c.query(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2)`,
      [uid, `${uid}@example.com`],
    );
    await c.query(
      `insert into profiles (id, email) values ($1,$2) on conflict (id) do nothing`,
      [uid, `${uid}@example.com`],
    );
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
    return xid;
  }

  async function insertDraft(
    c: PoolClient,
    xid: string,
    opts: { text: string; status: string; postedAgoMin?: number },
  ): Promise<void> {
    const thread = JSON.stringify([{ text: opts.text }]);
    await c.query(
      `insert into drafts (x_account_id, pattern, thread, initial_thread, status, posted_at)
       values ($1,'p1',$2::jsonb,$2::jsonb,$3,
               case when $4::int is null then null else now() - ($4 || ' minutes')::interval end)`,
      [xid, thread, opts.status, opts.postedAgoMin ?? null],
    );
  }

  it("fetchRecentPostBodies returns only posted drafts, newest first, first-post text", async () => {
    const xid = await withTransaction(async (c) => {
      const xid = await makeAccount(c);
      await insertDraft(c, xid, { text: "古い投稿", status: "posted", postedAgoMin: 120 });
      await insertDraft(c, xid, { text: "新しい投稿", status: "posted", postedAgoMin: 10 });
      await insertDraft(c, xid, { text: "未投稿の下書き", status: "draft" });
      return xid;
    });
    try {
      const bodies = await fetchRecentPostBodies(db, xid);
      expect(bodies).toEqual(["新しい投稿", "古い投稿"]); // newest first, no draft
    } finally {
      await withTransaction((c) =>
        c.query(
          `delete from auth.users where id = (select user_id from x_accounts where id = $1)`,
          [xid],
        ),
      );
    }
  });

  it("fetchNewsDigest applies category scope, 7-day window, and impact priority", async () => {
    const tag = `genctx-${randomUUID()}`;
    const url = (s: string) => `https://news.example/${tag}/${s}`;
    await withTransaction(async (c) => {
      const rows: Array<[string, string, string, string]> = [
        // [category, impact, ago, key]
        ["ai", "high", "1 day", "high-old"],
        ["ai", "high", "2 hours", "high-new"],
        ["ai", "mid", "3 hours", "mid"],
        ["ai", "high", "10 days", "too-old"], // outside 7d
        ["web3", "high", "1 hour", "other-cat"], // wrong category
      ];
      for (const [cat, impact, ago, key] of rows) {
        await c.query(
          `insert into news_items (category, title, summary, source_url, impact, published_at)
           values ($1,$2,'s',$3,$4, now() - ($5)::interval)`,
          [cat, key, url(key), impact, ago],
        );
      }
    });
    try {
      const digest = await fetchNewsDigest(db, ["ai"]);
      const mine = digest.filter((d) => d.source_url.includes(tag));
      expect(mine.map((d) => d.title)).toEqual(["high-new", "high-old", "mid"]);
      expect(mine.every((d) => d.source_url.includes(tag))).toBe(true);
    } finally {
      await withTransaction((c) =>
        c.query(`delete from news_items where source_url like $1`, [`https://news.example/${tag}/%`]),
      );
    }
  });

  it("fetchNewsDigest returns [] for no categories", async () => {
    expect(await fetchNewsDigest(db, [])).toEqual([]);
  });
});
