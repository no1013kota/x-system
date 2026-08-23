import { randomBytes, randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterEach, afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { encryptWithKey } from "../crypto/envelope";
import { closePool, getPool, withTransaction } from "../db/pool";
import { uniqueTestHourWindow } from "../db/test-window";
import { X_SCOPES } from "../x/oauth";
import type { Queryable } from "../x/token-refresh";

/**
 * 利用者どうしの分離（マルチテナント）を実DBで検証する。
 *
 * **「他人のデータを読み書きできないか」は `db/rls.db.test.ts` が担当**（RLSポリシー・所有権
 * トリガー・全テーブルにRLSが有効であることの構造検査）。ここで見るのは**挙動の干渉**:
 * 片方の利用者の失敗・満杯・失効・大量投入が、もう片方の処理や見える数字へ影響しないこと。
 *
 * 1人運用のうちは起きないが、2人目以降で初めて出る種類の不具合なので、増える前に固定する。
 */
describe("利用者どうしの分離（挙動の干渉）", () => {
  let available = false;
  const testKey = randomBytes(32);
  const db: Queryable = {
    query: <T = unknown>(sql: string, params?: unknown[]) =>
      getPool().query(sql, params) as unknown as Promise<{ rows: T[]; rowCount: number | null }>,
  };
  const created: string[] = [];

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

  // 作った利用者はそのテストの終わりで必ず消す（全アカウントを対象にする処理の件数を食わないため）。
  afterEach(async () => {
    for (const uid of created.splice(0)) {
      await withTransaction(async (c) => {
        for (const table of [
          "external_api_usage_events",
          "usage_events",
          "improvement_suggestions",
          "follower_snapshots",
          "learning_sources",
          "prompt_templates",
          "base_md_versions",
          "generation_jobs",
          "drafts",
          "schedule_slots",
        ]) {
          await c.query(
            `delete from ${table} where x_account_id in (select id from x_accounts where user_id = $1)`,
            [uid],
          );
        }
        for (const table of ["usage_counters", "user_api_keys", "notifications"]) {
          await c.query(`delete from ${table} where user_id = $1`, [uid]);
        }
        await c.query(`update profiles set active_x_account_id = null where id = $1`, [uid]);
        await c.query(`delete from x_accounts where user_id = $1`, [uid]);
        await c.query(`delete from auth.users where id = $1`, [uid]);
      }).catch(() => {});
    }
  });

  /** 利用者＋Xアカウントを1組作る。 */
  async function makeAccount(
    over: { plan?: string; categories?: string[] } = {},
  ): Promise<{ userId: string; xAccountId: string }> {
    const seeded = await withTransaction(async (c: PoolClient) => {
      const uid = randomUUID();
      await c.query(
        `insert into auth.users (id, instance_id, aud, role, email)
         values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2)`,
        [uid, `${uid}@example.com`],
      );
      await c.query(
        `update profiles set plan = $2::plan_type, subscription_status = 'active',
            current_period_end = now() + interval '30 days',
            news_config = case when $3::text is null then news_config
                          else jsonb_build_object('categories', $3::jsonb,
                                                  'impact_filter', '["high","mid"]'::jsonb,
                                                  'max_items', 20) end
          where id = $1`,
        [uid, over.plan ?? "premium", over.categories ? JSON.stringify(over.categories) : null],
      );
      const { rows } = await c.query<{ id: string }>(
        `insert into x_accounts
           (user_id, x_user_id, handle, name, auth_type, status,
            access_token_ciphertext, refresh_token_ciphertext, oauth_scopes, token_expires_at)
         values ($1,$2,$3,'テスト','managed','active',$4,$4,$5, now() + interval '1 hour')
         returning id`,
        [uid, `x-${randomUUID()}`, `h${uid.slice(0, 8)}`, encryptWithKey("t", testKey), X_SCOPES],
      );
      await c.query(`update profiles set active_x_account_id = $2 where id = $1`, [uid, rows[0].id]);
      return { userId: uid, xAccountId: rows[0].id };
    });
    created.push(seeded.userId);
    return seeded;
  }

  async function seedJob(
    xAccountId: string,
    status: "queued" | "running" | "failed" | "succeeded",
  ): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `insert into generation_jobs (x_account_id, kind, trigger, pattern_id, status, input)
       values ($1, 'post_generation', 'manual', (select id from post_patterns where x_account_id = $1 and seed_key = 'p1'), $2::job_status, '{}'::jsonb) returning id`,
      [xAccountId, status],
    );
    return rows[0].id;
  }

  it("生成枠: Aが月次上限を使い切ってもBの枠は減らない", async () => {
    const { reserveUsage } = await import("../usage/generation-reserve");
    const a = await makeAccount();
    const b = await makeAccount();

    // usage_events は job を参照するため、実際のjob行を用意して枠を消費する。
    const jobsA = [await seedJob(a.xAccountId, "queued"), await seedJob(a.xAccountId, "queued")];
    const jobA3 = await seedJob(a.xAccountId, "queued");
    const jobB1 = await seedJob(b.xAccountId, "queued");

    // A の枠を2に見立てて使い切る。
    await withTransaction(async (c) => {
      for (const [i, jobId] of jobsA.entries()) {
        const okA = await reserveUsage(c, {
          userId: a.userId,
          xAccountId: a.xAccountId,
          jobId,
          type: "generation",
          limit: 2,
        });
        expect(okA, `Aの${i + 1}件目は通る`).toBe(true);
      }
    });

    // 上限到達は例外（`usage_limit_exceeded`）で返る。txを分けて確認する。
    let overAError = "";
    await withTransaction(async (c) => {
      await reserveUsage(c, {
        userId: a.userId,
        xAccountId: a.xAccountId,
        jobId: jobA3,
        type: "generation",
        limit: 2,
      });
    }).catch((err: unknown) => {
      overAError = err instanceof Error ? err.message : String(err);
    });
    expect(overAError, "Aは上限で止まる").toContain("usage_limit_exceeded");

    // 同じ上限でも B は満額使える（counterは利用者ごと）。
    await withTransaction(async (c) => {
      const okB = await reserveUsage(c, {
        userId: b.userId,
        xAccountId: b.xAccountId,
        jobId: jobB1,
        type: "generation",
        limit: 2,
      });
      expect(okB, "Aの使い切りはBへ影響しない").toBe(true);
    });
  });

  it("同時実行の上限: Aが上限まで抱えてもBは新しく作れる", async () => {
    const { MAX_ACTIVE_JOBS } = await import("../learning-sources");
    const a = await makeAccount();
    const b = await makeAccount();
    for (let i = 0; i < MAX_ACTIVE_JOBS; i++) await seedJob(a.xAccountId, "queued");

    const countActive = async (userId: string) =>
      Number(
        (
          await db.query<{ n: string }>(
            `select count(*)::text as n from generation_jobs gj
               join x_accounts xa on xa.id = gj.x_account_id
              where xa.user_id = $1 and gj.status in ('queued','running')`,
            [userId],
          )
        ).rows[0].n,
      );
    expect(await countActive(a.userId), "Aは上限に達している").toBe(MAX_ACTIVE_JOBS);
    expect(await countActive(b.userId), "Bの実行中は0のまま（上限は利用者ごと）").toBe(0);
  });

  it("失敗の波及: Aのjobが失敗してもBのjobは影響を受けない", async () => {
    const a = await makeAccount();
    const b = await makeAccount();
    await seedJob(a.xAccountId, "failed");
    const jobB = await seedJob(b.xAccountId, "queued");

    const { rows } = await db.query<{ status: string }>(
      `select status::text as status from generation_jobs where id = $1`,
      [jobB],
    );
    expect(rows[0].status, "Bのjobはqueuedのまま").toBe("queued");
  });

  it("Xトークンの失効: Aが再連携待ちでもBのアカウントはactiveのまま", async () => {
    const a = await makeAccount();
    const b = await makeAccount();
    await db.query(`update x_accounts set status = 'expired' where id = $1`, [a.xAccountId]);

    const { rows } = await db.query<{ id: string; status: string }>(
      `select id, status::text as status from x_accounts where id = any($1::uuid[])`,
      [[a.xAccountId, b.xAccountId]],
    );
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.status]));
    expect(byId[a.xAccountId]).toBe("expired");
    expect(byId[b.xAccountId], "Bは影響を受けない").toBe("active");
  });

  it("ニュースの配信: 分野設定が違う2人には、それぞれの分野だけが届く", async () => {
    const { fanOutNewsDigest, newsDigestDedupeKey } = await import("../jobs/news-digest");
    const a = await makeAccount({ categories: ["ai"] });
    const b = await makeAccount({ categories: ["web3"] });

    // `news_items` は利用者に紐づかない共有データ。現在の窓は実データと混ざり、遠い過去は
    // cleanup に消される。**未来の窓**なら自分の行しか存在しない（T-M7-54）。
    const windowStart = uniqueTestHourWindow();
    const marker = randomUUID().slice(0, 8);
    const newsIds: string[] = [];
    for (const [category, title] of [
      ["ai", `AI-${marker}`],
      ["web3", `WEB3-${marker}`],
    ] as const) {
      const { rows } = await db.query<{ id: string }>(
        `insert into news_items (category, title, summary, source_url, impact, published_at, fetched_at)
         values ($1::news_category, $2, '要約', $3, 'high', $4, $4) returning id`,
        [category, title, `https://example.com/${category}/${marker}`, windowStart.toISOString()],
      );
      newsIds.push(rows[0].id);
    }

    try {
      await fanOutNewsDigest({ db, windowStart });
      /*
        **この窓の行だけを見る**（2026-08-24）。窓は専有しているつもりでも、同じ「ニュースの配信」を
        検査する別ファイル（news-digest.db.test.ts）が**別の窓で全利用者へ配る**ため、
        user_id だけで絞ると相手の配信が混ざる（並列実行の順番で出たり出なかったりする＝
        flakyではなく絞り込み漏れ）。
      */
      const notifications = await db.query<{ user_id: string; body: string }>(
        `select user_id, body from notifications
          where type = 'news' and user_id = any($1::uuid[]) and dedupe_key = $2`,
        [[a.userId, b.userId], newsDigestDedupeKey(windowStart)],
      );
      const byUser = Object.fromEntries(notifications.rows.map((r) => [r.user_id, r.body]));
      // 窓で絞っているので「自分の1件だけ」を厳密に主張できる（混入すれば行数が増える）。
      expect(byUser[a.userId], "Aへはaiのニュースだけが届く").toBe(`・AI-${marker}`);
      expect(byUser[b.userId], "Bへはweb3のニュースだけが届く").toBe(`・WEB3-${marker}`);
    } finally {
      await db.query(`delete from news_items where id = any($1::uuid[])`, [newsIds]);
    }
  });

  it("日次サマリ: Aの失敗件数がBのまとめに出ない", async () => {
    const { deliverDailySummaries, SUMMARY_HOUR_JST } = await import("./daily-summary");
    const a = await makeAccount();
    const b = await makeAccount();
    for (let i = 0; i < 3; i++) await seedJob(a.xAccountId, "failed");
    await seedJob(b.xAccountId, "succeeded");

    const at8 = new Date(Date.UTC(2026, 7, 1, SUMMARY_HOUR_JST, 0, 0) - 9 * 3_600_000).toISOString();
    await deliverDailySummaries(db, at8, { userIds: [a.userId, b.userId] });

    const { rows } = await db.query<{ user_id: string; body: string }>(
      `select user_id, body from notifications
        where type = 'summary' and user_id = any($1::uuid[])`,
      [[a.userId, b.userId]],
    );
    const byUser = Object.fromEntries(rows.map((r) => [r.user_id, r.body]));
    expect(byUser[a.userId], "Aは失敗3件").toContain("失敗 3 件");
    expect(byUser[b.userId], "Bは成功1件・失敗0件").toContain("成功 1 件 / 失敗 0 件");
    expect(byUser[b.userId], "Aの失敗はBへ出ない").not.toContain("失敗 3 件");
  });

  it("投稿の順番: Aが大量にqueuedでも、Bのjobは時刻順で公平に並ぶ", async () => {
    // dispatchは `scheduled_for asc nulls last, created_at asc` の1起動50件。
    // Aが先に大量投入しても、後から入ったBのjobが**永久に後回しにはならない**ことを、
    // 選択順序のクエリで確認する（実dispatchはHTTPを伴うためここでは順序だけを見る）。
    const a = await makeAccount();
    const b = await makeAccount();
    for (let i = 0; i < 60; i++) await seedJob(a.xAccountId, "queued");
    const jobB = await seedJob(b.xAccountId, "queued");

    const { rows } = await db.query<{ id: string }>(
      `select gj.id from generation_jobs gj
         join x_accounts xa on xa.id = gj.x_account_id
        where xa.user_id = any($1::uuid[]) and gj.status = 'queued'
        order by gj.scheduled_for asc nulls last, gj.created_at asc
        limit 50`,
      [[a.userId, b.userId]],
    );
    const firstBatch = rows.map((r) => r.id);
    expect(firstBatch, "1回目はAの60件で埋まる（時刻順なので後入れのBは入らない）").not.toContain(
      jobB,
    );

    // 1回目の50件が処理済みになれば、2回目でBが入る＝飢餓しない。
    await db.query(
      `update generation_jobs set status = 'succeeded' where id = any($1::uuid[])`,
      [firstBatch],
    );
    const second = await db.query<{ id: string }>(
      `select gj.id from generation_jobs gj
         join x_accounts xa on xa.id = gj.x_account_id
        where xa.user_id = any($1::uuid[]) and gj.status = 'queued'
        order by gj.scheduled_for asc nulls last, gj.created_at asc
        limit 50`,
      [[a.userId, b.userId]],
    );
    expect(second.rows.map((r) => r.id), "2回目にはBのjobが入る").toContain(jobB);
  });
});
