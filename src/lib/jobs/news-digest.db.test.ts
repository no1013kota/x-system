import { randomUUID } from "node:crypto";

import { uniqueTestHourWindow } from "../db/test-window";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closePool, getPool, withTransaction } from "../db/pool";
import type { Queryable } from "../x/token-refresh";
import { fanOutNewsDigest, newsDigestDedupeKey } from "./news-digest";

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
      /** ニュースのメール通知（T-M8-407）。省略はOFF。 */
      newsEmail?: boolean;
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
        opts.newsEmail ?? false,
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
      });
      const userB = await makeUser(c, {
        status: "active",
        categories: ["ai"],
        impact: ["high"],
        newsInApp: true,
      });
      const userOff = await makeUser(c, {
        status: "trialing",
        categories: ["ai"],
        impact: ["high"],
        newsInApp: false, // 両channel off → excluded
      });
      // メールだけON（T-M8-407）: 行は作る（in_app_enabled=false）＋メールの宛先になる。
      const userEmailOnly = await makeUser(c, {
        status: "active",
        categories: ["ai"],
        impact: ["high"],
        newsInApp: false,
        newsEmail: true,
      });
      const userCanceled = await makeUser(c, {
        status: "canceled",
        categories: ["ai"],
        impact: ["high"],
        newsInApp: true, // non-contract → excluded
      });
      const userNoMatch = await makeUser(c, {
        status: "trialing",
        categories: ["sns"],
        impact: ["high"],
        newsInApp: true, // no matching items → excluded
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
      return { userA, userB, userOff, userEmailOnly, userCanceled, userNoMatch, aiHigh, web3Mid };
    });

    try {
      const res = await fanOutNewsDigest({ db: pooledDb, windowStart });
      // matchedUsers/notified はグローバル集計で、並行テストの news_config 一致ユーザーを含みうるため
      // 下限のみを検査する。厳密な対象（A/Bのみ・Off/Canceled/NoMatch除外）は下の per-user load で担保。
      //
      // 稀に落ちるため、失敗時に状態を出す（T-M8-11）。並列実行で何が食い違ったのかを
      // 次の occurrence で特定できるようにする。推測で直さない。
      const ctx = await withTransaction(async (c) => {
        const items = await c.query(
          `select count(*)::int as n from news_items
            where fetched_at >= $1::timestamptz
              and fetched_at < $1::timestamptz + interval '1 hour'`,
          [windowStart.toISOString()],
        );
        const users = await c.query(
          `select id, subscription_status, news_config, notification_config
             from profiles where id = any($1::uuid[])`,
          [[seed.userA, seed.userB]],
        );
        return { 窓: windowStart.toISOString(), 窓内のnews_items: items.rows[0]?.n, 対象利用者: users.rows, 結果: res };
      });
      const detail = JSON.stringify(ctx);
      expect(res.matchedUsers, `対象が2人未満。状態: ${detail}`).toBeGreaterThanOrEqual(2);
      expect(res.notified, `配信が2件未満。状態: ${detail}`).toBeGreaterThanOrEqual(2);

      /*
        **この窓の行だけを見る**（2026-08-24）。ローカルDBは共有で、同じ「ニュースの配信」を検査する
        別ファイル（tenant-isolation.db.test.ts）が**別の窓で全利用者へ配る**ため、
        user_id だけで絞ると相手の配信も数えて「1件のはずが2件」で落ちる。
        並列実行の順番で出たり出なかったりする＝flakyではなく、絞り込み漏れ。
      */
      const load = async (uid: string) =>
        (
          await withTransaction((c) =>
            c.query<{ total_count: number; news_item_ids: string[]; in_app_enabled: boolean }>(
              `select (payload->>'total_count')::int as total_count,
                      payload->'news_item_ids' as news_item_ids,
                      in_app_enabled
                 from notifications
                where user_id = $1 and type = 'news' and dedupe_key = $2`,
              [uid, newsDigestDedupeKey(windowStart)],
            ),
          )
        ).rows;

      const a = await load(seed.userA);
      expect(a).toHaveLength(1);
      expect(a[0].total_count).toBe(2); // ai/high + web3/mid
      expect(a[0].news_item_ids[0]).toBe(seed.aiHigh); // high ranked before mid
      expect(a[0].in_app_enabled).toBe(true);

      const b = await load(seed.userB);
      expect(b).toHaveLength(1);
      expect(b[0].total_count).toBe(1); // ai/high only
      expect(b[0].in_app_enabled).toBe(true);

      expect(await load(seed.userOff)).toHaveLength(0);
      expect(await load(seed.userCanceled)).toHaveLength(0);
      expect(await load(seed.userNoMatch)).toHaveLength(0);

      // メールだけの人: 行はあるがアプリ内一覧には出ない。宛先は本人のメールアドレス（T-M8-407）。
      const e = await load(seed.userEmailOnly);
      expect(e).toHaveLength(1);
      expect(e[0].in_app_enabled).toBe(false);
      const target = res.emailTargets.find((t) => t.userId === seed.userEmailOnly);
      expect(target?.to).toBe(`${seed.userEmailOnly}@example.com`);
      expect(target?.totalCount).toBe(1);
      // アプリ内だけの人（A/B）はメールの宛先にならない。
      expect(res.emailTargets.some((t) => t.userId === seed.userA)).toBe(false);

      // re-run: dedupe_key prevents new rows。`matchedUsers`/`notified` はDB全体の集計で、
      // 並行して走る他のDBテストがこの窓のnews_items・ユーザーを増減させるため値を固定できない。
      // dedupeの検査は「対象ユーザーの行数が増えない」ことで行う。
      const rerun = await fanOutNewsDigest({ db: pooledDb, windowStart });
      expect(await load(seed.userA)).toHaveLength(1); // 重複行が作られない
      expect(await load(seed.userB)).toHaveLength(1);
      // 再実行ではメールの宛先も作らない（二重送信しない）。
      expect(rerun.emailTargets.some((t) => t.userId === seed.userEmailOnly)).toBe(false);
    } finally {
      // **通知は窓のdedupe keyで消す**（T-M8-64・bug）。fan-outは条件が合う全利用者へ配るので、
      // テスト用ユーザーの行だけ消すと、共有ローカルDBの**実アカウントに未来窓の偽ダイジェスト
      // が残り続ける**（通知を押しても常に0件のニュース画面になり、利用者が実際に踏んだ）。
      await withTransaction((c) =>
        c.query(`delete from notifications where dedupe_key = $1`, [
          newsDigestDedupeKey(windowStart),
        ]),
      );
      await withTransaction((c) =>
        c.query(`delete from auth.users where id = any($1)`, [
          [seed.userA, seed.userB, seed.userOff, seed.userEmailOnly, seed.userCanceled, seed.userNoMatch],
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
      });
      const alive = await makeUser(c, {
        status: "active",
        categories: ["ai"],
        impact: ["high"],
        newsInApp: true,
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
      // 失敗したとき原因が分かるように状態を添える（並列実行で稀に落ちるため・T-M8-11）。
      // 何が食い違ったのかを次の失敗で特定できるようにする。
      const ctx = await withTransaction(async (c) => {
        const items = await c.query(
          `select count(*)::int as n from news_items
            where fetched_at >= $1::timestamptz
              and fetched_at < $1::timestamptz + interval '1 hour'`,
          [windowStart.toISOString()],
        );
        const alive = await c.query(
          `select subscription_status, news_config, notification_config from profiles where id = $1`,
          [seed.alive],
        );
        const gone = await c.query(`select 1 from profiles where id = $1`, [seed.gone]);
        return {
          窓内のnews_items: items.rows[0]?.n,
          残る利用者: alive.rows[0] ?? "profiles に居ない",
          退会した利用者がまだ居るか: gone.rows.length > 0,
          結果: res,
        };
      });
      expect(res.notified, `配信されなかった。状態: ${JSON.stringify(ctx)}`).toBeGreaterThanOrEqual(1);
      const alive = await withTransaction((c) =>
        // この窓の行だけを見る（他ファイルの fan-out が別の窓で同じ利用者へ配るため・2026-08-24）。
        c.query(
          `select 1 from notifications
            where user_id = $1 and type = 'news' and dedupe_key = $2`,
          [seed.alive, newsDigestDedupeKey(windowStart)],
        ),
      );
      expect(alive.rows, "残っている利用者へは届く").toHaveLength(1);
    } finally {
      await withTransaction(async (c) => {
        // 窓のkeyで消す（テスト用ユーザー以外へ配られた分も含めて）。理由は上のテストの後片付け参照。
        await c.query(`delete from notifications where dedupe_key = $1`, [
          newsDigestDedupeKey(windowStart),
        ]);
        await c.query(`delete from auth.users where id = $1`, [seed.alive]);
        await c.query(`delete from news_items where title like $1`, [`%-${tag}`]);
      });
    }
  });

  it("配信の**最中**に退会がコミットされても外部キー違反で全体が落ちない（T-M8-19）", async () => {
    // 2026-08-03、`npm test` の並列実行で3回に1回ほど notifications_user_id_fkey 違反で落ちていた。
    // T-M7-54 の `select ... from profiles` は「抽出済みの対象が既に消えていたら0行」にする修正で、
    // **同じ文の中で SELECT と外部キー検査が別のスナップショットを見る**ことまでは塞げていなかった。
    // SELECT の直後に退会がコミットされると検査時点で親行が無く、例外＝**その利用者以降の配信が全滅**。
    //
    // 並列実行の運任せにせず順序を固定して再現する。退会トランザクションを開いたまま fan-out を走らせ、
    // 挿入がロック待ちに入ったことを確認してから commit する。
    const windowStart = uniqueTestHourWindow();
    const tag = randomUUID().slice(0, 8);

    const seed = await withTransaction(async (c) => {
      const opts = {
        status: "active",
        categories: ["ai"],
        impact: ["high"],
        newsInApp: true,
        newsEmail: false,
      };
      const gone = await makeUser(c, opts);
      const alive = await makeUser(c, opts);
      await c.query(
        `insert into news_items (category, title, summary, source_url, impact, fetched_at)
         values ('ai', $1, 's', $2, 'high', $3::timestamptz + interval '30 minutes')`,
        [`ai-high-${tag}`, `https://ex.com/${randomUUID()}`, windowStart.toISOString()],
      );
      return { gone, alive };
    });

    // 退会を「コミットせずに」保持する専用接続。この間、当該行はロックされている。
    const blocker = await getPool().connect();
    let fanOut: Promise<unknown> | null = null;
    try {
      await blocker.query("begin");
      await blocker.query(`delete from auth.users where id = $1`, [seed.gone]);

      fanOut = fanOutNewsDigest({ db: pooledDb, windowStart });

      // 挿入が親行のロック待ちに入るまで待つ。**ここを待たずに commit すると競合が起きず、
      // 修正前のコードでも通ってしまう**（＝再現しないテストになる）。
      await expect
        .poll(
          async () =>
            (
              await withTransaction((c) =>
                c.query<{ n: number }>(
                  `select count(*)::int as n from pg_stat_activity
                    where wait_event_type = 'Lock'
                      and query ilike '%insert into notifications%'`,
                ),
              )
            ).rows[0].n,
          { timeout: 15_000, message: "通知の挿入が親行のロック待ちに入ること" },
        )
        .toBeGreaterThan(0);

      await blocker.query("commit");

      // 例外にならず、残っている利用者へは届く。
      await fanOut;
      fanOut = null;
      const alive = await withTransaction((c) =>
        // この窓の行だけを見る（他ファイルの fan-out が別の窓で同じ利用者へ配るため・2026-08-24）。
        c.query(
          `select 1 from notifications
            where user_id = $1 and type = 'news' and dedupe_key = $2`,
          [seed.alive, newsDigestDedupeKey(windowStart)],
        ),
      );
      expect(alive.rows, "退会の巻き添えにならず配信される").toHaveLength(1);
    } finally {
      // 失敗経路で開いたままのトランザクションを残さない（後続テストがロック待ちで固まる）。
      await blocker.query("rollback").catch(() => {});
      blocker.release();
      await fanOut?.catch(() => {});
      await withTransaction(async (c) => {
        // 窓のkeyで消す（テスト用ユーザー以外へ配られた分も含めて）。理由は最初のテストの後片付け参照。
        await c.query(`delete from notifications where dedupe_key = $1`, [
          newsDigestDedupeKey(windowStart),
        ]);
        await c.query(`delete from auth.users where id = any($1)`, [[seed.alive, seed.gone]]);
        await c.query(`delete from news_items where title like $1`, [`%-${tag}`]);
      });
    }
  });
});
