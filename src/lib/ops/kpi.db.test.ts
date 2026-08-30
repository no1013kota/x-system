import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
    const { rows } = await db.query<{ d: string }>(
      `select max(metric_date)::text as d from kpi_daily where metric = 'users_total'`,
    );
    // 前日の日付 < 今日。
    expect(rows[0]?.d ?? "").not.toBe(today);
    expect((rows[0]?.d ?? "") < today).toBe(true);
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
           on conflict (view_date, path, visitor_hash) do update set views = page_views.views + 1`,
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
      expect(entry.map((s) => s.path)).toEqual(["/", "/signup", "/plans"]);
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
