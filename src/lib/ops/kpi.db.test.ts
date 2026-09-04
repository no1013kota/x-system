import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PLANS } from "@/lib/plans";

import { closePool, getPool, withTransaction } from "../db/pool";
import type { Queryable } from "../x/token-refresh";

import {
  JPY_PER_USD,
  forecastMonthCost,
  jstDateOf,
  jstMonthProgress,
  projectToMonthEnd,
  readAdminSummary,
  readCancellationOutcome,
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

  /**
   * 粗利の主値は**月末見込み**（D-55(2)・T-M8-427）。「MRR − 月初からの累積原価」は月初に大きく
   * 月末へ向けて減って見えるので、原価を日割りで月末まで延ばした値を出し、「これまで」も添える。
   * 原価行を**実際に insert** して日割りを検算する（2097-06-15 JST＝経過15日・6月は30日）。
   * MRRテストと同じく RR のトランザクション内で差分を見て rollback する。
   */
  it("粗利は月末見込み（原価の日割り延長）と「これまで」の両方を返す（D-55(2)）", async () => {
    if (!available) return;
    const uid = await makeUser();
    // JST 2097-06-15 09:00 → 当月15日目（今日を含む）・6月は30日。
    const nowIso = "2097-06-15T00:00:00.000Z";
    // JST 2097-06-02 00:00 → 2日目。月初3日間は前月（5月）の実績を仮置きする（反証 2026-09-05）。
    const earlyIso = "2097-06-01T15:00:00.000Z";
    class Rollback extends Error {}
    await withTransaction(async (c: PoolClient) => {
      await c.query(`set transaction isolation level repeatable read`);
      const tx: Queryable = {
        query: <T = unknown>(sql: string, params?: unknown[]) =>
          c.query(sql, params) as unknown as Promise<{ rows: T[]; rowCount: number | null }>,
      };
      const before = await readAdminSummary(tx, nowIso);
      const beforeEarly = await readAdminSummary(tx, earlyIso);
      await c.query(
        `insert into profiles (id, email) values ($1, $2) on conflict (id) do nothing`,
        [uid, `kpi-${uid}@example.com`],
      );
      // 運営負担 $1.50（当月内の別の日に2行）＋ 利用者負担 $9（原価に入らない）＋ 前月の運営負担 $4（窓の外）。
      await c.query(
        `insert into external_api_usage_events
           (user_id, provider, operation, status, estimated_cost_usd, idempotency_key, occurred_at, payer)
         values ($1, 'anthropic', 'text_generation', 'succeeded', 1.0, $2 || ':a', '2097-06-03T03:00:00Z', 'operator'),
                ($1, 'openai',    'image_generation', 'succeeded', 0.5, $2 || ':b', '2097-06-14T03:00:00Z', 'operator'),
                ($1, 'anthropic', 'text_generation', 'succeeded', 9.0, $2 || ':c', '2097-06-10T03:00:00Z', 'user'),
                ($1, 'anthropic', 'text_generation', 'succeeded', 4.0, $2 || ':d', '2097-05-31T03:00:00Z', 'operator')`,
        [uid, `t427-${uid}`],
      );
      const after = await readAdminSummary(tx, nowIso);
      expect(after.monthElapsedDays).toBe(15);
      expect(after.monthDays).toBe(30);
      expect(after.monthCostUsd - before.monthCostUsd, "運営負担の当月分だけ").toBeCloseTo(1.5, 6);
      expect(after.monthUserPaidCostUsd - before.monthUserPaidCostUsd).toBeCloseTo(9, 6);
      expect(after.monthCostJpy).toBe(Math.round(after.monthCostUsd * JPY_PER_USD));
      // 見込み原価 = これまで ÷ 15日 × 30日（before が0なら 240円 → 480円）。
      expect(after.monthCostForecastBasis).toBe("prorated");
      expect(after.monthCostForecastJpy).toBe(Math.round((after.monthCostJpy / 15) * 30));
      expect(after.monthCostForecastJpy - before.monthCostForecastJpy).toBe(480);
      expect(after.previousMonthCostJpy - before.previousMonthCostJpy, "前月（5月）の運営負担 $4").toBe(640);
      expect(after.grossProfitJpy, "これまで＝MRR − 月初からの原価").toBe(after.mrrJpy - after.monthCostJpy);
      expect(after.grossProfitForecastJpy, "見込み＝MRR − 見込み原価").toBe(
        after.mrrJpy - after.monthCostForecastJpy,
      );

      // 月初2日目: 日割り（240円 ÷ 2 × 30 = 3,600円）ではなく前月実績（640円）を仮置きする。
      const early = await readAdminSummary(tx, earlyIso);
      expect(early.monthElapsedDays).toBe(2);
      expect(early.monthCostForecastBasis).toBe("previous_month");
      expect(early.previousMonthCostJpy - beforeEarly.previousMonthCostJpy).toBe(640);
      expect(early.monthCostForecastJpy, "前月実績と今月の累計の大きい方").toBe(
        Math.max(early.previousMonthCostJpy, early.monthCostJpy),
      );
      expect(early.grossProfitForecastJpy).toBe(early.mrrJpy - early.monthCostForecastJpy);
      throw new Rollback();
    }).catch((error: unknown) => {
      if (!(error instanceof Rollback)) throw error;
    });
  });

  /**
   * 解約手続きへ進んだ数は `cancel_intents` の名前で書く（旧 `cancellations`・D-55(3)・T-M8-427）。
   * 値は cancellation_surveys.proceeded=true の件数で、引き止めで残った人も含む（実解約ではない）。
   */
  it("解約手続きへ進んだ数は cancel_intents として書かれる（cancellations では書かない）", async () => {
    if (!available) return;
    const uid = await makeUser();
    const nowIso = new Date().toISOString();
    const yesterday = new Date(new Date(nowIso).getTime() + 9 * 3600_000 - 24 * 3600_000)
      .toISOString()
      .slice(0, 10);
    // 入れる前の値を取っておき、差分が**ちょうど1**（proceeded=false を数えない）ことを見る。
    // 共有DBでも同じ日の行は他テストが作らないので差分なら固定できる（反証 2026-09-05）。
    const readIntents = async () =>
      Number(
        (
          await db.query<{ value: string }>(
            `select value::text as value from kpi_daily
              where metric = 'cancel_intents' and dimension = '' and metric_date = $1`,
            [yesterday],
          )
        ).rows[0]?.value ?? 0,
      );
    await runDailyKpiSnapshot(db, nowIso);
    const before = await readIntents();
    await withTransaction(async (c: PoolClient) => {
      await c.query(
        `insert into profiles (id, email) values ($1, $2) on conflict (id) do nothing`,
        [uid, `kpi-${uid}@example.com`],
      );
      // 昨日（JST）の正午に「進んだ」1件と「引き返した」1件。数えるのは proceeded=true だけ。
      await c.query(
        `insert into cancellation_surveys (user_id, reasons, proceeded, plan, created_at)
         values ($1, array['price'], true,  'premium', ($2::date::timestamp + interval '12 hours') at time zone 'Asia/Tokyo'),
                ($1, array['price'], false, 'premium', ($2::date::timestamp + interval '12 hours') at time zone 'Asia/Tokyo')`,
        [uid, yesterday],
      );
    });
    await runDailyKpiSnapshot(db, nowIso);
    const { rows } = await db.query<{ metric: string; value: string }>(
      `select metric, value::text as value from kpi_daily
        where metric in ('cancel_intents', 'cancellations') and dimension = '' and metric_date = $1`,
      [yesterday],
    );
    const intents = rows.find((r) => r.metric === "cancel_intents");
    expect(Number(intents?.value ?? 0) - before, "進んだ1件だけが cancel_intents に入る（引き返した1件は数えない）").toBe(1);
    expect(rows.find((r) => r.metric === "cancellations"), "旧名では書かない").toBeUndefined();
  });

  /**
   * 旧名 `cancellations` の取り残し（migration→deploy の間に日付を跨ぐと旧コードが直近3日ぶんを書く）は
   * スナップショットが毎回、計算し直す窓だけ消す。窓の外（他の日付）は触らない。
   */
  it("スナップショットは直近3日の窓に残った旧名 cancellations の行を消す（窓の外は触らない）", async () => {
    if (!available) return;
    const nowIso = "2096-09-15T00:00:00.000Z";
    const inWindow = "2096-09-13";
    const outside = "2096-09-01";
    try {
      await db.query(
        `insert into kpi_daily (metric_date, metric, dimension, value)
         values ($1, 'cancellations', '', 1), ($2, 'cancellations', '', 1)
         on conflict do nothing`,
        [inWindow, outside],
      );
      await runDailyKpiSnapshot(db, nowIso);
      const { rows } = await db.query<{ d: string }>(
        `select metric_date::text as d from kpi_daily
          where metric = 'cancellations' and metric_date in ($1, $2)`,
        [inWindow, outside],
      );
      expect(rows.map((r) => r.d)).toEqual([outside]);
    } finally {
      await db.query(`delete from kpi_daily where metric_date in ($1, $2)`, [inWindow, outside]);
      // 状態行（2096-09-14）も消す。
      await db.query(`delete from kpi_daily where metric_date = '2096-09-14'`);
    }
  });

  /**
   * 実解約は日付の記録が無いので**状態指標**で持つ（反証 2026-09-05・T-M8-427）:
   * `users_canceled`＝canceled の人数、`users_cancel_scheduled`＝課金中で期末解約が確定した人数。
   * トライアル中の解約予約は課金が無いので後者に入れない。MRRテストと同じく RR で差分を見て rollback。
   */
  it("解約の状態指標 users_canceled／users_cancel_scheduled を前日の日付で書く", async () => {
    if (!available) return;
    const users = await Promise.all([makeUser(), makeUser(), makeUser(), makeUser(), makeUser(), makeUser()]);
    const nowIso = "2097-08-15T00:00:00.000Z";
    const yesterday = "2097-08-14";
    class Rollback extends Error {}
    await withTransaction(async (c: PoolClient) => {
      await c.query(`set transaction isolation level repeatable read`);
      const tx: Queryable = {
        query: <T = unknown>(sql: string, params?: unknown[]) =>
          c.query(sql, params) as unknown as Promise<{ rows: T[]; rowCount: number | null }>,
      };
      const read = async () => {
        const { rows } = await c.query<{ metric: string; value: string }>(
          `select metric, value::text as value from kpi_daily
            where metric in ('users_canceled', 'users_cancel_scheduled') and metric_date = $1`,
          [yesterday],
        );
        const pick = (m: string) => Number(rows.find((r) => r.metric === m)?.value ?? 0);
        return { canceled: pick("users_canceled"), scheduled: pick("users_cancel_scheduled") };
      };
      await runDailyKpiSnapshot(tx, nowIso);
      const before = await read();
      const [u1, u2, u3, u4, u5, u6] = users;
      // 1・2: 解約済み ／ 3: active＋期末解約 ／ 4: past_due＋期末解約 ／ 5: trialing＋期末解約（数えない）／ 6: active（数えない）
      await c.query(
        `insert into profiles (id, email, plan, subscription_status, cancel_at_period_end)
         values ($1::uuid, 'kpi-' || $1 || '@example.com', 'premium',  'canceled', false),
                ($2::uuid, 'kpi-' || $2 || '@example.com', 'standard', 'canceled', false),
                ($3::uuid, 'kpi-' || $3 || '@example.com', 'premium',  'active',   true),
                ($4::uuid, 'kpi-' || $4 || '@example.com', 'premium',  'past_due', true),
                ($5::uuid, 'kpi-' || $5 || '@example.com', 'premium',  'trialing', true),
                ($6::uuid, 'kpi-' || $6 || '@example.com', 'premium',  'active',   false)
         on conflict (id) do update set
           subscription_status = excluded.subscription_status,
           cancel_at_period_end = excluded.cancel_at_period_end`,
        [u1, u2, u3, u4, u5, u6],
      );
      await runDailyKpiSnapshot(tx, nowIso);
      const after = await read();
      expect(after.canceled - before.canceled, "canceled の人数").toBe(2);
      expect(after.scheduled - before.scheduled, "課金中の期末解約だけ（トライアル中は含めない）").toBe(2);
      throw new Rollback();
    }).catch((error: unknown) => {
      if (!(error instanceof Rollback)) throw error;
    });
  });

  /**
   * 解約手続きへ進んだ人の**いまの状態**（`cancel_intents` と実解約の差を画面で読むための1行・T-M8-427）。
   * 直近30日の proceeded=true の回答者を profiles と突き合わせる。RR で差分を見て rollback。
   */
  it("解約手続きへ進んだ人の現況を、解約済み／期末で解約予定／継続中に分ける", async () => {
    if (!available) return;
    const users = await Promise.all([makeUser(), makeUser(), makeUser(), makeUser()]);
    class Rollback extends Error {}
    await withTransaction(async (c: PoolClient) => {
      await c.query(`set transaction isolation level repeatable read`);
      const tx: Queryable = {
        query: <T = unknown>(sql: string, params?: unknown[]) =>
          c.query(sql, params) as unknown as Promise<{ rows: T[]; rowCount: number | null }>,
      };
      const before = await readCancellationOutcome(tx);
      const [a, b, cUser, d] = users;
      // a: 解約済み（2回進んだ）／ b: active＋期末解約 ／ c: active（引き止めで残った。引き返した回答も1件）／
      // d: active だが進んだのは40日前（窓の外）
      await c.query(
        `insert into profiles (id, email, plan, subscription_status, cancel_at_period_end)
         values ($1::uuid, 'kpi-' || $1 || '@example.com', 'premium', 'canceled', false),
                ($2::uuid, 'kpi-' || $2 || '@example.com', 'premium', 'active',   true),
                ($3::uuid, 'kpi-' || $3 || '@example.com', 'premium', 'active',   false),
                ($4::uuid, 'kpi-' || $4 || '@example.com', 'premium', 'active',   false)
         on conflict (id) do update set
           subscription_status = excluded.subscription_status,
           cancel_at_period_end = excluded.cancel_at_period_end`,
        [a, b, cUser, d],
      );
      await c.query(
        `insert into cancellation_surveys (user_id, reasons, proceeded, plan, created_at)
         values ($1, array['price'], true,  'premium', now() - interval '2 days'),
                ($1, array['price'], true,  'premium', now() - interval '1 day'),
                ($2, array['price'], true,  'premium', now() - interval '3 days'),
                ($3, array['price'], true,  'premium', now() - interval '5 days'),
                ($3, array['price'], false, 'premium', now() - interval '4 days'),
                ($4, array['price'], true,  'premium', now() - interval '40 days')`,
        [a, b, cUser, d],
      );
      const after = await readCancellationOutcome(tx);
      expect(after.intents - before.intents, "直近30日に進んだ回答（引き返した1件・40日前は数えない）").toBe(4);
      expect(after.users - before.users).toBe(3);
      expect(after.canceled - before.canceled).toBe(1);
      expect(after.cancelScheduled - before.cancelScheduled).toBe(1);
      expect(after.continuing - before.continuing).toBe(1);
      throw new Rollback();
    }).catch((error: unknown) => {
      if (!(error instanceof Rollback)) throw error;
    });
  });

  /**
   * migration `20260905000001_kpi_cancel_intents.sql` は既存行を改名し、**2回流しても壊れない**。
   * コードのデプロイが migration より先に来て新名の行が既にある日（T-M8-373 で実際に起きた順序）は、
   * primary key で弾かれずに**新しく書かれた方**を残す。ここでは migration ファイルそのものを実DBで流す。
   */
  it("migration 20260905000001 は cancellations→cancel_intents の改名が冪等で、新名と衝突しても落ちない", async () => {
    if (!available) return;
    const sql = readFileSync(
      path.join(process.cwd(), "supabase/migrations/20260905000001_kpi_cancel_intents.sql"),
      "utf8",
    );
    // 誰も書かない遠い未来の日付（他テストの固定時計 2097/2098 とも重ならない）。
    const d1 = "2095-03-01";
    const d2 = "2095-03-02";
    try {
      await db.query(
        `insert into kpi_daily (metric_date, metric, dimension, value, updated_at)
         values ($1, 'cancellations',  '', 3, now() - interval '1 day'),
                ($2, 'cancellations',  '', 1, now() - interval '1 day'),
                ($2, 'cancel_intents', '', 5, now())
         on conflict (metric_date, metric, dimension) do update set value = excluded.value, updated_at = excluded.updated_at`,
        [d1, d2],
      );
      const read = async () =>
        (
          await db.query<{ metric_date: string; metric: string; value: string }>(
            `select metric_date::text as metric_date, metric, value::text as value from kpi_daily
              where metric_date in ($1, $2) and metric in ('cancellations', 'cancel_intents')
              order by 1, 2`,
            [d1, d2],
          )
        ).rows.map((r) => `${r.metric_date}:${r.metric}=${Number(r.value)}`);
      await db.query(sql);
      const once = await read();
      expect(once).toEqual([`${d1}:cancel_intents=3`, `${d2}:cancel_intents=5`]);
      await db.query(sql);
      expect(await read(), "2回目も同じ（何も壊さない）").toEqual(once);
    } finally {
      await db.query(
        `delete from kpi_daily where metric_date in ($1, $2) and metric in ('cancellations', 'cancel_intents')`,
        [d1, d2],
      );
    }
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
   *
   * **最終操作は利用者自身の操作だけ**（反証 2026-09-05・T-M8-427）。ここで固定するのは3つ:
   * 1. usage_events が無い（BYOK）利用者でも、手動投稿の `posted_at` から入る
   * 2. 予約枠の自動生成（trigger='schedule'）・自動投稿（posted_mode='auto'）を今日作っても進まない
   * 3. 投稿指標の自動収集（metrics-collector と同じ `update drafts set tweet_metrics=…, updated_at=now()`）
   *    を打っても進まない——以前の定義（drafts.updated_at）では最大30日ずれた
   */
  it("生成は generation_jobs の成功件数、最終操作は手動の操作だけ（自動実行・指標収集で進まない）", async () => {
    if (!available) return;
    const uid = await makeUser(1);
    let manualDraftId = "";
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
      // 手動は10日前、予約枠の自動生成（schedule）とその連鎖（system）は**今**——最終操作に入らないことを見る。
      await c.query(
        `insert into generation_jobs (x_account_id, kind, trigger, status, pattern_spec, created_at)
         values ($1, 'post_generation',  'manual',   'succeeded', '{}'::jsonb, now() - interval '10 days'),
                ($1, 'image_generation', 'manual',   'succeeded', null,        now() - interval '10 days'),
                ($1, 'post_generation',  'manual',   'failed',    '{}'::jsonb, now() - interval '10 days'),
                ($1, 'post_generation',  'schedule', 'succeeded', '{}'::jsonb, now()),
                ($1, 'image_generation', 'system',   'succeeded', null,        now())`,
        [xid],
      );
      // 投稿（済み）は drafts.status='posted' の件数（スレッド1本＝1件・D-55(4)）。
      // posted 2件（手動・2日前の3ツイートスレッド／自動・1日前）＋ draft 1件 ＋ discarded 1件。
      const inserted = await c.query<{ id: string; posted_mode: string | null }>(
        `insert into drafts (x_account_id, thread, initial_thread, status, pattern_name, max_posts, max_posts_edit,
                             posted_mode, posted_at, updated_at)
         values ($1, '[{"text":"a"},{"text":"b"},{"text":"c"}]', '[{"text":"a"}]', 'posted',    'p', 3, 3, 'manual', now() - interval '2 days', now() - interval '2 days'),
                ($1, '[{"text":"d"}]', '[{"text":"d"}]', 'posted',    'p', 1, 1, 'auto',   now() - interval '1 day',  now() - interval '1 day'),
                ($1, '[{"text":"e"}]', '[{"text":"e"}]', 'draft',     'p', 1, 1, null,     null,                      now()),
                ($1, '[{"text":"f"}]', '[{"text":"f"}]', 'discarded', 'p', 1, 1, null,     null,                      now())
         returning id, posted_mode::text as posted_mode`,
        [xid],
      );
      manualDraftId = inserted.rows.find((r) => r.posted_mode === "manual")!.id;
    });
    const readMine = async () =>
      (await readUsersOverview(db, 500)).find((r) => r.email === `kpi-${uid}@example.com`);
    const mine = await readMine();
    expect(mine?.generations, "成功した生成ジョブを trigger に依らず数える（直近90日）").toBe(4);
    expect(mine?.posts, "投稿（済み）は posted の下書き件数（ツイート数・posted_mode に依らない）").toBe(2);
    // 最終操作: usage_events が1行も無い（BYOK）利用者でも「—」にならず、手動投稿の posted_at＝2日前。
    // 今日の自動生成・自動投稿・下書きの updated_at は入らない。
    expect(mine?.lastManualActionAt, "usage_events が無くても最終操作が入る").toBeTruthy();
    const expectTwoDaysAgo = (iso: string) => {
      const ageMs = Date.now() - new Date(iso).getTime();
      expect(ageMs).toBeGreaterThan(2 * 86_400_000 - 5 * 60_000);
      expect(ageMs).toBeLessThan(2 * 86_400_000 + 5 * 60_000);
    };
    expectTwoDaysAgo(mine!.lastManualActionAt!);

    // 投稿指標の自動収集（src/lib/jobs/metrics-collector.ts と同じ更新）が updated_at を進めても変わらない。
    await db.query(
      `update drafts
          set tweet_metrics = '{}'::jsonb, next_metrics_at = now() + interval '6 days', updated_at = now()
        where id = $1 and metrics_completed_at is null`,
      [manualDraftId],
    );
    expectTwoDaysAgo((await readMine())!.lastManualActionAt!);

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

  it("月末見込みの日割りは月初・原価0・月末で壊れない（DB不要）", () => {
    // JST 2097-07-01 00:30（UTC 06-30 15:30）→ 1日目・7月は31日。
    expect(jstMonthProgress("2097-06-30T15:30:00.000Z")).toEqual({ elapsedDays: 1, daysInMonth: 31 });
    // JST 2097-06-30 23:59 → 30日目・6月は30日（経過＝当月日数なので見込み＝これまで）。
    expect(jstMonthProgress("2097-06-30T14:59:00.000Z")).toEqual({ elapsedDays: 30, daysInMonth: 30 });
    // うるう年の2月。
    expect(jstMonthProgress("2096-02-10T00:00:00.000Z").daysInMonth).toBe(29);
    expect(projectToMonthEnd(0, { elapsedDays: 1, daysInMonth: 31 })).toBe(0);
    expect(projectToMonthEnd(100, { elapsedDays: 1, daysInMonth: 31 })).toBe(3100);
    expect(projectToMonthEnd(240, { elapsedDays: 15, daysInMonth: 30 })).toBe(480);
    expect(projectToMonthEnd(1000, { elapsedDays: 30, daysInMonth: 30 })).toBe(1000);
    expect(projectToMonthEnd(1000, { elapsedDays: 3, daysInMonth: 31 })).toBe(10333);
  });

  /**
   * 月初（3日未満）は「今日の途中経過 × 当月日数」が時間帯で大きく振れるので前月実績を仮置きする
   * （反証 2026-09-05）。前月が無い初月だけ日割りに戻す。見込みが今月の累計を下回ることはない。
   */
  it("月末見込みは月初3日間だけ前月実績を仮置きし、初月は日割りに戻る（DB不要）", () => {
    const day1 = { elapsedDays: 1, daysInMonth: 31 };
    const day2 = { elapsedDays: 2, daysInMonth: 31 };
    const day3 = { elapsedDays: 3, daysInMonth: 31 };
    expect(forecastMonthCost({ accumulatedJpy: 100, previousMonthJpy: 640, progress: day1 })).toEqual({
      jpy: 640,
      basis: "previous_month",
    });
    // 今月すでに前月を超えていれば今月の累計（見込みが実績を下回らない）。
    expect(forecastMonthCost({ accumulatedJpy: 700, previousMonthJpy: 640, progress: day2 })).toEqual({
      jpy: 700,
      basis: "previous_month",
    });
    // 前月実績が無い初月は日割り。
    expect(forecastMonthCost({ accumulatedJpy: 100, previousMonthJpy: 0, progress: day1 })).toEqual({
      jpy: 3100,
      basis: "prorated",
    });
    // 3日目からは日割り。
    expect(forecastMonthCost({ accumulatedJpy: 300, previousMonthJpy: 640, progress: day3 })).toEqual({
      jpy: 3100,
      basis: "prorated",
    });
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
