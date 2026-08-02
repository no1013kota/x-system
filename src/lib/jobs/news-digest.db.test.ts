import { randomUUID } from "node:crypto";

import { uniqueTestHourWindow } from "../db/test-window";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closePool, getPool, withTransaction } from "../db/pool";
import type { Queryable } from "../x/token-refresh";
import { fanOutNewsDigest } from "./news-digest";

const pooledDb: Queryable = {
  query: <T = unknown>(sql: string, params?: unknown[]) =>
    getPool().query(sql, params) as unknown as Promise<{ rows: T[]; rowCount: number | null }>,
};

/**
 * DB integration tests for the hourly news digest fan-out (T-M4-12, 要件04 §14, 要件02 §4.2/§4.3).
 * Skips without the local Supabase stack.
 */
describe("fanOutNewsDigest (db)", () => {
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

  async function makeUser(
    c: PoolClient,
    opts: {
      status: string;
      categories: string[];
      impact: string[];
      newsInApp: boolean;
      newsEmail: boolean;
    },
  ): Promise<string> {
    const uid = randomUUID();
    await c.query(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2)`,
      [uid, `${uid}@example.com`],
    );
    await c.query(
      `insert into profiles (id, email, subscription_status, news_config, notification_config)
       values ($1, $2, $3::subscription_status,
               jsonb_build_object('categories', $4::jsonb, 'impact_filter', $5::jsonb, 'max_items', 20),
               jsonb_build_object('news', jsonb_build_object('in_app', $6::boolean, 'email', $7::boolean)))
       on conflict (id) do update set
         subscription_status = excluded.subscription_status,
         news_config = excluded.news_config,
         notification_config = excluded.notification_config`,
      [
        uid,
        `${uid}@example.com`,
        opts.status,
        JSON.stringify(opts.categories),
        JSON.stringify(opts.impact),
        opts.newsInApp,
        opts.newsEmail,
      ],
    );
    return uid;
  }

  it("fans out digests only to eligible, matching users and is idempotent per window", async () => {
    // 共有ローカルDBには実データのニュースがあり、遠い過去は cleanup に消される。**未来の窓**なら
    // どちらも避けられ、この窓には本テストの行しか存在しない（T-M7-54）。
    const windowStart = uniqueTestHourWindow();
    const tag = randomUUID().slice(0, 8);

    const seed = await withTransaction(async (c) => {
      const userA = await makeUser(c, {
        status: "trialing",
        categories: ["ai", "web3"],
        impact: ["high", "mid"],
        newsInApp: true,
        newsEmail: false,
      });
      const userB = await makeUser(c, {
        status: "active",
        categories: ["ai"],
        impact: ["high"],
        newsInApp: false,
        newsEmail: true,
      });
      const userOff = await makeUser(c, {
        status: "trialing",
        categories: ["ai"],
        impact: ["high"],
        newsInApp: false,
        newsEmail: false, // both channels off → excluded
      });
      const userCanceled = await makeUser(c, {
        status: "canceled",
        categories: ["ai"],
        impact: ["high"],
        newsInApp: true,
        newsEmail: true, // non-contract → excluded
      });
      const userNoMatch = await makeUser(c, {
        status: "trialing",
        categories: ["sns"],
        impact: ["high"],
        newsInApp: true,
        newsEmail: true, // no matching items → excluded
      });

      // items inside the window (fetched_at = windowStart + 30min)
      const mk = async (category: string, impact: string): Promise<string> => {
        const { rows } = await c.query<{ id: string }>(
          `insert into news_items (category, title, summary, source_url, impact, fetched_at)
           values ($1::news_category, $2, 's', $3, $4::impact_level, $5::timestamptz + interval '30 minutes')
           returning id`,
          [category, `${category}-${impact}-${tag}`, `https://ex.com/${randomUUID()}`, impact, windowStart.toISOString()],
        );
        return rows[0].id;
      };
      const aiHigh = await mk("ai", "high");
      const web3Mid = await mk("web3", "mid");
      await mk("ai", "low"); // excluded by impact_filter for both A and B
      await mk("business", "high"); // excluded by category for both
      return { userA, userB, userOff, userCanceled, userNoMatch, aiHigh, web3Mid };
    });

    try {
      const res = await fanOutNewsDigest({ db: pooledDb, windowStart });
      // matchedUsers/notified はグローバル集計で、並行テストの news_config 一致ユーザーを含みうるため
      // 下限のみを検査する。厳密な対象（A/Bのみ・Off/Canceled/NoMatch除外）は下の per-user load で担保。
      expect(res.matchedUsers).toBeGreaterThanOrEqual(2); // A and B (+ 並行ユーザーの可能性)
      expect(res.notified).toBeGreaterThanOrEqual(2);

      const load = async (uid: string) =>
        (
          await withTransaction((c) =>
            c.query<{ total_count: number; news_item_ids: string[]; email_status: string; in_app_enabled: boolean }>(
              `select (payload->>'total_count')::int as total_count,
                      payload->'news_item_ids' as news_item_ids,
                      email_status, in_app_enabled
                 from notifications where user_id = $1 and type = 'news'`,
              [uid],
            ),
          )
        ).rows;

      const a = await load(seed.userA);
      expect(a).toHaveLength(1);
      expect(a[0].total_count).toBe(2); // ai/high + web3/mid
      expect(a[0].news_item_ids[0]).toBe(seed.aiHigh); // high ranked before mid
      expect(a[0].in_app_enabled).toBe(true);
      expect(a[0].email_status).toBe("not_requested"); // email off

      const b = await load(seed.userB);
      expect(b).toHaveLength(1);
      expect(b[0].total_count).toBe(1); // ai/high only
      expect(b[0].email_status).toBe("queued"); // email on

      expect(await load(seed.userOff)).toHaveLength(0);
      expect(await load(seed.userCanceled)).toHaveLength(0);
      expect(await load(seed.userNoMatch)).toHaveLength(0);

      // re-run: dedupe_key prevents new rows。`matchedUsers`/`notified` はDB全体の集計で、
      // 並行して走る他のDBテストがこの窓のnews_items・ユーザーを増減させるため値を固定できない。
      // dedupeの検査は「対象ユーザーの行数が増えない」ことで行う。
      await fanOutNewsDigest({ db: pooledDb, windowStart });
      expect(await load(seed.userA)).toHaveLength(1); // 重複行が作られない
      expect(await load(seed.userB)).toHaveLength(1);
    } finally {
      await withTransaction((c) =>
        c.query(`delete from auth.users where id = any($1)`, [
          [seed.userA, seed.userB, seed.userOff, seed.userCanceled, seed.userNoMatch],
        ]),
      );
      await withTransaction((c) =>
        c.query(`delete from news_items where title like $1`, [`%-${tag}`]),
      );
    }
  });

  it("配信の途中で利用者が退会しても、他の利用者への配信は止まらない（T-M7-54）", async () => {
    // 対象を選んでから挿入するまでの間に退会されると、`values` 版では外部キー違反で例外になり、
    // **まだ配信していない利用者の分まで巻き添えで止まっていた**。並列テストで実際に再現した。
    const windowStart = uniqueTestHourWindow();
    const tag = randomUUID().slice(0, 8);

    const seed = await withTransaction(async (c) => {
      const gone = await makeUser(c, {
        status: "active",
        categories: ["ai"],
        impact: ["high"],
        newsInApp: true,
        newsEmail: false,
      });
      const alive = await makeUser(c, {
        status: "active",
        categories: ["ai"],
        impact: ["high"],
        newsInApp: true,
        newsEmail: false,
      });
      await c.query(
        `insert into news_items (category, title, summary, source_url, impact, fetched_at)
         values ('ai', $1, 's', $2, 'high', $3::timestamptz + interval '30 minutes')`,
        [`ai-high-${tag}`, `https://ex.com/${randomUUID()}`, windowStart.toISOString()],
      );
      return { gone, alive };
    });

    // 対象の抽出後・挿入前に片方が消える状況を、抽出前の削除で等価に再現する
    // （挿入時点で user_id が存在しない、という同じ条件になる）。
    await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [seed.gone]));

    try {
      const res = await fanOutNewsDigest({ db: pooledDb, windowStart });
      expect(res.notified).toBeGreaterThanOrEqual(1);
      const alive = await withTransaction((c) =>
        c.query(`select 1 from notifications where user_id = $1 and type = 'news'`, [seed.alive]),
      );
      expect(alive.rows, "残っている利用者へは届く").toHaveLength(1);
    } finally {
      await withTransaction(async (c) => {
        await c.query(`delete from notifications where user_id = $1`, [seed.alive]);
        await c.query(`delete from auth.users where id = $1`, [seed.alive]);
        await c.query(`delete from news_items where title like $1`, [`%-${tag}`]);
      });
    }
  });
});
