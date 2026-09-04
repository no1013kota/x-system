import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PLANS } from "@/lib/plans";

import { closePool, getPool, withTransaction } from "../db/pool";
import type { Queryable } from "../x/token-refresh";

import {
  jstDateOf,
  readAdminSummary,
  readEntryFunnel,
  readFunnel,
  readHomeVisitorSeries,
  readKpiSeries,
  readMonthCostBreakdown,
  readRecentCancellations,
  readUsersOverview,
  runDailyKpiSnapshot,
  readTrafficSources,
} from "./kpi";

/**
 * 事業KPIスナップショットの実DB検証（T-M8-373）。
 *
 * ここで守るのは3つ。
 * 1. **実DBに書ける**（列名・型・キーが実物と合っている——文字列組み立ての単体テストでは
 *    CHECK制約や型の不一致を検出できない・CLAUDE.md「DBへ書く値の形式」行）
 * 2. **冪等**（同じ日に2回走っても行が増えない。tickは5分ごとに来るのでclaimが漏れても壊れない）
 * 3. **初回バックフィル**（表が空なら過去の出来事指標を埋める。手作業のコマンドを作らない・原則3）
 *
 * 共有のローカルDBで他のテストが並行して利用者を作るため、**件数の等値は検査しない**
 * （自分が入れた分「以上」と、キーの一意性だけを見る）。
 */
describe("KPIスナップショット（db）", () => {
  let available = false;
  const db: Queryable = {
    query: <T = unknown>(sql: string, params?: unknown[]) =>
      getPool().query(sql, params) as unknown as Promise<{ rows: T[]; rowCount: number | null }>,
  };
  const createdUsers: string[] = [];

  beforeAll(async () => {
    try {
      const c = await getPool().connect();
      c.release();
      available = true;
    } catch {
      available = false;
      if (process.env.REQUIRE_DB) throw new Error("DBに接続できません（REQUIRE_DB=1）");
    }
  });
  afterAll(async () => {
    if (available) {
      for (const uid of createdUsers) {
        await getPool().query(`delete from auth.users where id = $1`, [uid]);
      }
    }
    await closePool();
  });

  /**
   * 利用者を作る。**`created_at` を明示して入れる**——`auth.users.created_at` には
   * defaultが無く（実際のsignupではGoTrueがアプリ側で入れる）、テストfixtureが
   * 入れないローカルDBでは**全員 null** だった。日付で数える指標の検証は
   * 自分で日付を持つ行を作らないと成り立たない。
   */
  async function makeUser(createdDaysAgo = 0): Promise<string> {
    const uid = await withTransaction(async (c: PoolClient) => {
      const id = randomUUID();
      await c.query(
        `insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at)
         values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,
                 now() - make_interval(days => $3), now() - make_interval(days => $3))`,
        [id, `kpi-${id}@example.com`, createdDaysAgo],
      );
      return id;
    });
    createdUsers.push(uid);
    return uid;
  }

  it("書けて、同じ日に2回走っても行が増えない（冪等）", async () => {
    if (!available) return;
    await makeUser();
    const nowIso = new Date().toISOString();

    const first = await runDailyKpiSnapshot(db, nowIso);
    expect(first.ran).toBe(true);
    expect(first.written).toBeGreaterThan(0);

    const countKey = async () =>
      Number(
        (
          await db.query<{ n: string }>(
            `select count(*)::text as n from kpi_daily
              where metric = 'users_total' and dimension = ''`,
          )
        ).rows[0]?.n ?? 0,
      );
    const before = await countKey();
    const second = await runDailyKpiSnapshot(db, nowIso);
    expect(second.ran).toBe(true);
    // upsert なので (日付, 指標, 内訳) のキー数は変わらない。
    expect(await countKey()).toBe(before);
  });

  it("表が空なら過去の出来事指標をバックフィルする（初回だけ）", async () => {
    if (!available) return;
    // このテストだけが kpi_daily を使う（書き手は本番でも scheduler_tick の1経路だけ）。
    await db.query(`delete from kpi_daily`);
    // 5日前に登録した利用者を1人作る（バックフィルが過去日を埋めることの根拠になる行）。
    await makeUser(5);

    const nowIso = new Date().toISOString();
    const result = await runDailyKpiSnapshot(db, nowIso);
    expect(result.backfilled).toBe(true);

    // 5日前の signups が入っている（通常モードは直近3日しか見ないので、これが入るのは
    // バックフィルだけ。日付はJST変換後の値なので「5日前±0日」をSQL側で判定する）。
    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n from kpi_daily
        where metric = 'signups'
          and metric_date < current_date - 3
          and value >= 1`,
    );
    expect(Number(rows[0]?.n ?? 0)).toBeGreaterThanOrEqual(1);

    // 2回目は通常モード（バックフィルしない）。
    const again = await runDailyKpiSnapshot(db, nowIso);
    expect(again.backfilled).toBe(false);
  });

  it("状態指標は「前日」の日付で書かれる（日付が変わった直後のtickが前日の終わりを写す）", async () => {
    if (!available) return;
    const nowIso = new Date().toISOString();
    await runDailyKpiSnapshot(db, nowIso);
    const today = jstDateOf(nowIso);
    /*
      **この実行が書いたはずの行**を直接見る（max() を見ない）。共有DBでは並行テストが
      別の日付（scheduler-tickテストは2098年へ時計を固定して全段を回す）で同じ表へ書くため、
      max() は自分の書き込みの検証にならない（2026-09-01に実際に混線して落ちた）。
    */
    const yesterday = new Date(new Date(nowIso).getTime() + 9 * 3600_000 - 24 * 3600_000)
      .toISOString()
      .slice(0, 10);
    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n from kpi_daily
        where metric = 'users_total' and metric_date = $1`,
      [yesterday],
    );
    expect(Number(rows[0]?.n ?? 0)).toBeGreaterThanOrEqual(1);
    const todayRows = await db.query<{ n: string }>(
      `select count(*)::text as n from kpi_daily
        where metric = 'users_total' and metric_date = $1`,
      [today],
    );
    expect(Number(todayRows.rows[0]?.n ?? 0)).toBe(0);
  });

  /**
   * **「/admin が呼ぶ読み出し」を全部、実DBで1周する**。実装時、`cancellation_surveys` の
   * 列を `reason`（初版migration）と思い込んで書き、実物は `reasons`（配列・後のmigrationで
   * 置換）だったため **管理画面（/admin）が500になった**。列名の思い込みは実DBを通さないと出ない
   * （E2Eで発見。ここに足して単体の段で捕まえる）。
   */
  it("/admin の読み出し関数はすべて実DBで動く", async () => {
    if (!available) return;
    const summary = await readAdminSummary(db);
    expect(summary.usersTotal).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(summary.grossProfitJpy)).toBe(true);
    expect(Array.isArray(await readKpiSeries(db, "mrr_jpy", 400))).toBe(true);
    for (const group of ["provider", "operation", "user"] as const) {
      expect(Array.isArray(await readMonthCostBreakdown(db, group, 5))).toBe(true);
    }
    expect(Array.isArray(await readRecentCancellations(db, 10))).toBe(true);
  });

  /**
   * MRRは**引き止めクーポンの割引を反映**する（運営者の決定 2026-09-04・D-55(1)）。
   * 割引は契約者ごとに率・期限が違うので、`group by plan` の合計では掛けられない——
   * 実際の `profiles.discount_*` 列を持つ行を入れて、サマリと日次スナップショットの両方で確かめる。
   *
   * 共有DBで並行テストが契約者を作るため、**REPEATABLE READ のトランザクション内**で
   * 「入れる前」と「入れた後」を同じスナップショットで読み、差分だけを検査する。
   * 最後は rollback で消す（実DBに active な偽契約を残さない）。
   *
   * **時計は遠い未来（2097-06-15）へ固定する。** RR のまま `runDailyKpiSnapshot` を呼ぶと
   * kpi_daily の「昨日」の状態行と直近3日の出来事行を upsert する。実時計だと、並行して
   * 走る `cron.db.test.ts` の tick（(5.5) の kpi_snapshot は新規DBでは毎回実行される）が
   * **同じ行**を書き、スナップショット取得後に他txが更新した行への upsert は
   * `could not serialize access due to concurrent update`（40001）で落ちる（重なった回だけ）。
   * 誰も書かない日付にすれば行が共有されない（scheduler-tick の route.db.test は 2098年
   * とその3日前＝最短 2097-12-29 なので重ならない）。tx は rollback なので行は残らない。
   * 割引の期限もこの時計を基準に入れる。
   */
  it("MRRは割引後の月額の合計で、終了した割引は掛からない（D-55(1)）", async () => {
    if (!available) return;
    const users = await Promise.all([
      makeUser(),
      makeUser(),
      makeUser(),
      makeUser(),
      makeUser(),
      makeUser(),
    ]);
    const nowIso = "2097-06-15T00:00:00.000Z";
    const yesterday = new Date(new Date(nowIso).getTime() + 9 * 3600_000 - 24 * 3600_000)
      .toISOString()
      .slice(0, 10);
    class Rollback extends Error {}
    await withTransaction(async (c: PoolClient) => {
      await c.query(`set transaction isolation level repeatable read`);
      const tx: Queryable = {
        query: <T = unknown>(sql: string, params?: unknown[]) =>
          c.query(sql, params) as unknown as Promise<{ rows: T[]; rowCount: number | null }>,
      };
      const before = await readAdminSummary(tx, nowIso);

      // 1: プレミアム・50%割引・終了日は未来（掛かる）
      // 2: プレミアム・50%割引・終了日は過去（掛からない）
      // 3: スタンダード・480円引き・終了日なし（ずっと掛かる）
      // 4: エキスパート・割引なし
      // 5: トライアル中・50%割引（MRRにも割引中にも入らない——課金が始まっていない）
      // 6: past_due・スタンダード・480円引き・終了日は未来（課金中として掛かる）
      const [u1, u2, u3, u4, u5, u6] = users;
      await c.query(
        `insert into profiles (id, email, plan, subscription_status,
                               discount_percent_off, discount_amount_off_jpy, discount_ends_at)
         values ($1::uuid, 'kpi-' || $1 || '@example.com', 'premium',  'active',   50,   null, $7::timestamptz + interval '30 days'),
                ($2::uuid, 'kpi-' || $2 || '@example.com', 'premium',  'active',   50,   null, $7::timestamptz - interval '1 day'),
                ($3::uuid, 'kpi-' || $3 || '@example.com', 'standard', 'active',   null, 480,  null),
                ($4::uuid, 'kpi-' || $4 || '@example.com', 'expert',   'active',   null, null, null),
                ($5::uuid, 'kpi-' || $5 || '@example.com', 'premium',  'trialing', 50,   null, null),
                ($6::uuid, 'kpi-' || $6 || '@example.com', 'standard', 'past_due', null, 480,  $7::timestamptz + interval '30 days')
         on conflict (id) do update set
           plan = excluded.plan, subscription_status = excluded.subscription_status,
           discount_percent_off = excluded.discount_percent_off,
           discount_amount_off_jpy = excluded.discount_amount_off_jpy,
           discount_ends_at = excluded.discount_ends_at`,
        [u1, u2, u3, u4, u5, u6, nowIso],
      );
      const expectedDelta =
        PLANS.premium.monthlyPriceJpy / 2 +
        PLANS.premium.monthlyPriceJpy +
        (PLANS.standard.monthlyPriceJpy - 480) +
        PLANS.expert.monthlyPriceJpy +
        (PLANS.standard.monthlyPriceJpy - 480);
      const expectedDiscountJpy = PLANS.premium.monthlyPriceJpy / 2 + 480 + 480;

      const after = await readAdminSummary(tx, nowIso);
      expect(after.paying - before.paying, "active と past_due が課金中").toBe(5);
      expect(after.trialing - before.trialing).toBe(1);
      expect(after.mrrJpy - before.mrrJpy, "サマリのMRRは割引後の合計").toBe(expectedDelta);
      expect(after.discounted - before.discounted, "割引中は期限内の課金中だけ（1・3・6）").toBe(3);
      expect(after.discountJpy - before.discountJpy, "減額の合計").toBe(expectedDiscountJpy);

      // 日次スナップショット（computeStateRows）も同じ数え方で書く。
      await runDailyKpiSnapshot(tx, nowIso);
      const { rows } = await c.query<{ value: string }>(
        `select value::text as value from kpi_daily
          where metric = 'mrr_jpy' and dimension = '' and metric_date = $1`,
        [yesterday],
      );
      expect(Number(rows[0]?.value), "スナップショットのMRRはサマリと一致").toBe(after.mrrJpy);
      throw new Rollback();
    }).catch((error: unknown) => {
      if (!(error instanceof Rollback)) throw error;
    });
  });

  it("利用者一覧は自分の行を代表データ付きで返す（T-M8-374）", async () => {
    if (!available) return;
    const uid = await makeUser(2);
    const rows = await readUsersOverview(db, 500);
    const mine = rows.find((r) => r.email === `kpi-${uid}@example.com`);
    expect(mine, "作った利用者が一覧に出る").toBeTruthy();
    expect(mine?.confirmed).toBe(true);
    expect(mine?.signedUpDate).toBeTruthy();
    expect(mine?.generations).toBe(0);
    expect(mine?.monthCostUsd).toBe(0);
    // 登録の新しい順（created_at が null の行は末尾）。
    const dates = rows.map((r) => r.signedUpDate).filter((d): d is string => d != null);
    const sorted = [...dates].sort((a, b) => (a < b ? 1 : -1));
    expect(dates).toEqual(sorted);
  });

  /**
   * **claimと本処理は同一トランザクションで落ちれば両方消える**（T-M8-373の本番障害の回帰）。
   * 2026-08-30、コードのデプロイが migration 適用より数分早く、claim 後に
   * 「relation kpi_daily does not exist」で落ちて**その日のclaimだけが残り**、
   * 翌日までスナップショットが書かれない状態になった。ここでは cron.ts と同じ形
   * （claim→本処理を1つのtxで）を失敗させ、claimがロールバックされることを固定する。
   */
  it("本処理が失敗したらclaimも消える（同一トランザクション）", async () => {
    if (!available) return;
    const windowKey = `kpi-test-${randomUUID().slice(0, 8)}`;
    await expect(
      withTransaction(async (c: PoolClient) => {
        const res = await c.query(
          `insert into cron_runs (job_name, window_key)
           values ('kpi_snapshot', $1)
           on conflict (job_name, window_key) do nothing`,
          [windowKey],
        );
        expect(res.rowCount).toBe(1);
        // 本処理に相当する失敗（存在しない表を読む＝本番で起きた形）。
        // 例外を握り潰さず tx の外へ伝える——cron.ts の実装と同じ流れ。
        await c.query(`select * from kpi_daily_missing_table`);
      }),
    ).rejects.toThrow();
    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n from cron_runs where job_name = 'kpi_snapshot' and window_key = $1`,
      [windowKey],
    );
    expect(Number(rows[0]?.n ?? 1), "claimが残っていない（次のtickが再試行できる）").toBe(0);
  });

  it("ページ閲覧が日次集計と入口ファネルへ載る（T-M8-378）", async () => {
    if (!available) return;
    // 昨日の閲覧を2人ぶん作る（同じ人の2回目は views が増えるだけで行は増えない）。
    const day = (await db.query<{ d: string }>(`select (current_date - 1)::text as d`)).rows[0].d;
    const h1 = `t378-${randomUUID().slice(0, 8)}`;
    const h2 = `t378-${randomUUID().slice(0, 8)}`;
    try {
      for (const h of [h1, h1, h2]) {
        await db.query(
          `insert into page_views (view_date, path, visitor_hash) values ($1, '/', $2)
           on conflict (view_date, path, visitor_hash, source) do update set views = page_views.views + 1`,
          [day, h],
        );
      }
      const nowIso = new Date().toISOString();
      await runDailyKpiSnapshot(db, nowIso);
      const { rows } = await db.query<{ metric: string; value: string }>(
        `select metric, value::text as value from kpi_daily
          where metric in ('page_views', 'page_uniques') and dimension = '/' and metric_date = $1`,
        [day],
      );
      const views = rows.find((r) => r.metric === "page_views");
      const uniques = rows.find((r) => r.metric === "page_uniques");
      expect(Number(views?.value ?? 0)).toBeGreaterThanOrEqual(3);
      expect(Number(uniques?.value ?? 0)).toBeGreaterThanOrEqual(2);

      const entry = await readEntryFunnel(db);
      // 3段目は「登録完了」（/plans はログイン後にしか開けないので入口から外した・T-M8-422）。
      expect(entry.map((s) => s.label)).toEqual(["ホーム（LP）", "新規登録画面", "登録完了"]);
      expect(entry[2].kind).toBe("event");
      expect(entry[2].views).toBeNull();
      expect(entry[0].views).toBeGreaterThanOrEqual(3);
      expect(entry[0].uniqueVisitorDays).toBeGreaterThanOrEqual(2);

      /*
        来訪者推移は「昨日まで=kpi_daily・今日=生データ」の合成（T-M8-379）。
        昨日ぶんはスナップショットが書いた値、今日ぶんは生から出ることを両方見る。
      */
      const todayHash = `t379-${randomUUID().slice(0, 8)}`;
      await db.query(
        `insert into page_views (view_date, path, visitor_hash)
         values ((now() at time zone 'Asia/Tokyo')::date, '/', $1)
         on conflict do nothing`,
        [todayHash],
      );
      try {
        const series = await readHomeVisitorSeries(db, 30);
        const dates = series.map((p) => p.date);
        expect(dates).toContain(day); // 昨日（kpi_daily由来）
        const today = jstDateOf(new Date().toISOString());
        expect(dates).toContain(today); // 今日（生データ由来）
        // 昇順・日付の重複なし。
        expect([...dates].sort()).toEqual(dates);
        expect(new Set(dates).size).toBe(dates.length);
      } finally {
        await db.query(`delete from page_views where visitor_hash = $1`, [todayHash]);
      }
    } finally {
      await db.query(`delete from page_views where visitor_hash in ($1, $2)`, [h1, h2]);
    }
  });

  /**
   * 「生成」は generation_jobs の成功件数で数える（T-M8-422）。以前は usage_events の
   * `delta = 1` を数えていたが、生成の精算は delta がクレジット量（例 2,720）で1件も一致せず、
   * BYOK は精算行そのものが無い——利用者一覧の「生成」が全員0だった。
   */
  it("生成は generation_jobs の成功件数（精算行の delta やプランに依らない）", async () => {
    if (!available) return;
    const uid = await makeUser(1);
    await withTransaction(async (c: PoolClient) => {
      await c.query(
        `insert into profiles (id, email) values ($1, $2) on conflict (id) do nothing`,
        [uid, `kpi-${uid}@example.com`],
      );
      const xid = (
        await c.query<{ id: string }>(
          `insert into x_accounts (user_id, x_user_id, handle, name, auth_type, status)
           values ($1, $2, 'h', 'n', 'byok', 'active') returning id`,
          [uid, `x-${uid.slice(0, 8)}`],
        )
      ).rows[0].id;
      // post_generation は pattern_spec が必須（generation_jobs_pattern_spec_required）。中身は問わない。
      await c.query(
        `insert into generation_jobs (x_account_id, kind, trigger, status, pattern_spec)
         values ($1, 'post_generation', 'manual', 'succeeded', '{}'::jsonb),
                ($1, 'image_generation', 'manual', 'succeeded', null),
                ($1, 'post_generation', 'manual', 'failed', '{}'::jsonb)`,
        [xid],
      );
    });
    const mine = (await readUsersOverview(db, 500)).find((r) => r.email === `kpi-${uid}@example.com`);
    expect(mine?.generations, "成功した生成ジョブだけを数える").toBe(2);
    const funnel = await readFunnel(db);
    expect(funnel.find((s) => s.label === "初回生成")?.count ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("流入元ごとに、ホーム表示・新規登録画面・登録・課金中を数える（T-M8-423）", async () => {
    if (!available) return;
    const slug = `t423-${randomUUID().slice(0, 8)}`;
    const uid = await makeUser(1);
    const today = jstDateOf(new Date().toISOString());
    const h = `t423-${randomUUID().slice(0, 8)}`;
    try {
      await db.query(`insert into traffic_sources (slug, label) values ($1, 'テスト流入元')`, [slug]);
      await db.query(
        `insert into page_views (view_date, path, visitor_hash, source)
         values ($1, '/', $2, $3), ($1, '/', $2 || '-b', $3), ($1, '/signup', $2, $3)
         on conflict do nothing`,
        [today, h, slug],
      );
      await db.query(`update page_views set views = 3 where visitor_hash = $1 and path = '/'`, [h]);
      await db.query(
        `insert into profiles (id, email, signup_source) values ($1, $2, $3)
         on conflict (id) do update set signup_source = excluded.signup_source`,
        [uid, `kpi-${uid}@example.com`, slug],
      );
      const rows = await readTrafficSources(db);
      const mine = rows.find((r) => r.slug === slug);
      expect(mine?.label).toBe("テスト流入元");
      expect(mine?.homeViews).toBe(4); // 3 + 1
      expect(mine?.homeUniqueVisitorDays).toBe(2);
      expect(mine?.signupUniqueVisitorDays).toBe(1);
      expect(mine?.signups).toBe(1);
      expect(mine?.paying).toBe(0);
      // 直接・不明の行は最後に1つだけ。
      expect(rows[rows.length - 1].slug).toBe("");
      expect(rows.filter((r) => r.slug === "")).toHaveLength(1);
    } finally {
      await db.query(`delete from page_views where source = $1`, [slug]);
      await db.query(`delete from traffic_sources where slug = $1`, [slug]);
    }
  });

  it("ファネルは登録済みの利用者を段階別に数える", async () => {
    if (!available) return;
    await makeUser();
    const funnel = await readFunnel(db);
    const labels = funnel.map((s) => s.label);
    expect(labels).toEqual(["登録", "メール確認", "X連携", "初回生成", "トライアル開始", "課金中"]);
    const total = funnel[0].count;
    const confirmed = funnel[1].count;
    expect(total).toBeGreaterThanOrEqual(1);
    // メール確認は登録以下（auth.users の部分集合なのでDBの状態に依らず成り立つ）。
    // **X連携以降の単調性はここでは検査しない**——共有のテストDBではfixtureが
    // メール未確認のままXアカウントを作るため、本番のフロー（確認→ログイン→連携）が
    // 保証する順序が成り立たない。
    expect(confirmed).toBeLessThanOrEqual(total);
  });
});
