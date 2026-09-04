import { PLANS, type PlanId } from "@/lib/plans";

import type { Queryable } from "../x/token-refresh";

/**
 * 事業KPIの日次スナップショットと読み出し（T-M8-373・運営者の指示 2026-08-29）。
 *
 * ## なぜスナップショットか
 *
 * 元データは消えるか、現在の状態しか持たない。
 * - 原価台帳（external_api_usage_events）は400日で消える
 * - generation_jobs は90日で消える
 * - profiles.plan / subscription_status は**変わると前の値が消える**（履歴が無い）
 *
 * 「その日の契約者数・MRR・原価」を毎日1行ずつ書き出しておけば、
 * 元データが消えても推移が残る。書くのは scheduler_tick（1日1回・冪等）、
 * 読むのは /admin だけ。保持は400日（ANALYTICS_RETENTION_DAYS と同じ幅）。
 *
 * ## 指標の分類
 *
 * - **出来事（event）**: その日に起きた件数。元データの日付列から日ごとに数えられるので、
 *   **直近数日を毎回計算し直す**（遅れて届いたStripeイベント・原価も拾える）。
 *   初回実行時は残っている元データの全期間をバックフィルする。
 * - **状態（state）**: その時点の契約者数・MRRなど。過去の状態は復元できないので、
 *   **日付が変わった直後に「前日の終わり」として1回だけ**書く。
 */

/** 円換算レート。PRD §6.1 の事業計画上の仮定（1ドル=160円）と同じ値を使う。 */
export const JPY_PER_USD = 160;

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** nowIso をJSTの日付（YYYY-MM-DD）にする。 */
export function jstDateOf(nowIso: string): string {
  return new Date(new Date(nowIso).getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** JST日付の day 日前（YYYY-MM-DD）。 */
function jstDaysAgo(nowIso: string, days: number): string {
  const t = new Date(nowIso).getTime() + JST_OFFSET_MS - days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** 遅れて届く元データ（Stripe・原価）を拾うため、毎回計算し直す日数。 */
const EVENT_RECOMPUTE_DAYS = 3;

/** 初回バックフィルで遡る最大日数（保持期間と同じ）。 */
const BACKFILL_MAX_DAYS = 400;

interface KpiRow {
  metric_date: string;
  metric: string;
  dimension: string;
  value: number;
}

async function upsertRows(db: Queryable, rows: KpiRow[]): Promise<number> {
  let written = 0;
  for (const row of rows) {
    await db.query(
      `insert into kpi_daily (metric_date, metric, dimension, value, updated_at)
       values ($1, $2, $3, $4, now())
       on conflict (metric_date, metric, dimension)
       do update set value = excluded.value, updated_at = now()`,
      [row.metric_date, row.metric, row.dimension, row.value],
    );
    written += 1;
  }
  return written;
}

/**
 * 出来事指標を [from, to]（JST日付・両端含む）で計算する。
 *
 * **日付の区切りはJST**。`timestamptz` を 'Asia/Tokyo' へ変換してから date に落とす。
 * UTCで区切ると日本の「今日」が2日に割れて、日次の数字が実感と合わなくなる。
 */
async function computeEventRows(db: Queryable, from: string, to: string): Promise<KpiRow[]> {
  const rows: KpiRow[] = [];
  const range = [from, to];

  const day = (col: string) => `(${col} at time zone 'Asia/Tokyo')::date`;

  // 登録・メール確認（auth.users は削除で行ごと消えるが、消えた人を数え直さないための
  // スナップショットなので、その時点で残っている行から数えるしかない——ここが上書きで
  // 減り得るのは既知の限界として受け入れる）。
  const signups = await db.query<{ d: string; n: string }>(
    `select ${day("created_at")}::text as d, count(*)::text as n
       from auth.users
      where ${day("created_at")} between $1 and $2
      group by 1`,
    range,
  );
  for (const r of signups.rows) {
    rows.push({ metric_date: r.d, metric: "signups", dimension: "", value: Number(r.n) });
  }
  const confirmed = await db.query<{ d: string; n: string }>(
    `select ${day("email_confirmed_at")}::text as d, count(*)::text as n
       from auth.users
      where email_confirmed_at is not null
        and ${day("email_confirmed_at")} between $1 and $2
      group by 1`,
    range,
  );
  for (const r of confirmed.rows) {
    rows.push({ metric_date: r.d, metric: "email_confirmed", dimension: "", value: Number(r.n) });
  }

  // X連携（その日に初めて連携した利用者の数。2アカウント目は数えない）。
  const connected = await db.query<{ d: string; n: string }>(
    `select d::text, count(*)::text as n from (
       select user_id, min(${day("created_at")}) as d from x_accounts group by user_id
     ) firsts
      where d between $1 and $2
      group by 1`,
    range,
  );
  for (const r of connected.rows) {
    rows.push({ metric_date: r.d, metric: "x_connected_users", dimension: "", value: Number(r.n) });
  }

  // トライアル開始（trial_used_at はトライアルを使った瞬間に1度だけ入る）。
  const trials = await db.query<{ d: string; n: string }>(
    `select ${day("trial_used_at")}::text as d, count(*)::text as n
       from profiles
      where trial_used_at is not null
        and ${day("trial_used_at")} between $1 and $2
      group by 1`,
    range,
  );
  for (const r of trials.rows) {
    rows.push({ metric_date: r.d, metric: "trials_started", dimension: "", value: Number(r.n) });
  }

  // 生成・投稿の実行数（usage_events の consume の**行数**。予約→精算の reserve は数えない）。
  // 生成の精算は delta がクレジット量（例 2,720）なので `delta = 1` では1件も一致しなかった（T-M8-422）。
  const usage = await db.query<{ d: string; op: string; n: string }>(
    `select ${day("created_at")}::text as d, operation::text as op, count(*)::text as n
       from usage_events
      where reason = 'consume' and delta > 0
        and ${day("created_at")} between $1 and $2
      group by 1, 2`,
    range,
  );
  for (const r of usage.rows) {
    rows.push({ metric_date: r.d, metric: "usage_consumed", dimension: r.op, value: Number(r.n) });
  }

  // 原価（provider別・USD・**運営負担だけ**）。円換算は読む側が JPY_PER_USD で行う（レート変更に強くする）。
  // 利用者負担（BYOK・payer='user'）は原価ではない（PRD §6.1・T-M8-422）。
  const cost = await db.query<{ d: string; provider: string; usd: string }>(
    `select ${day("occurred_at")}::text as d, provider::text as provider,
            coalesce(sum(estimated_cost_usd), 0)::text as usd
       from external_api_usage_events
      where payer = 'operator' and ${day("occurred_at")} between $1 and $2
      group by 1, 2`,
    range,
  );
  for (const r of cost.rows) {
    rows.push({ metric_date: r.d, metric: "cost_usd", dimension: r.provider, value: Number(r.usd) });
  }

  // 公開ページの閲覧（T-M8-378）。行そのものは40日で消えるので、日次の集計を残す。
  const pv = await db.query<{ d: string; path: string; views: string; uniques: string }>(
    `select view_date::text as d, path, sum(views)::text as views, count(*)::text as uniques
       from page_views
      where view_date between $1 and $2
      group by 1, 2`,
    range,
  );
  for (const r of pv.rows) {
    rows.push({ metric_date: r.d, metric: "page_views", dimension: r.path, value: Number(r.views) });
    rows.push({ metric_date: r.d, metric: "page_uniques", dimension: r.path, value: Number(r.uniques) });
  }

  // 解約アンケート（proceeded=true が実際に解約へ進んだ数）。
  const cancels = await db.query<{ d: string; n: string }>(
    `select ${day("created_at")}::text as d, count(*)::text as n
       from cancellation_surveys
      where proceeded = true
        and ${day("created_at")} between $1 and $2
      group by 1`,
    range,
  );
  for (const r of cancels.rows) {
    rows.push({ metric_date: r.d, metric: "cancellations", dimension: "", value: Number(r.n) });
  }

  return rows;
}

/**
 * 状態指標を「いまの値」として計算する（metric_date は呼び出し側が決める）。
 *
 * MRRは **active（課金中）× プラン月額** で数える。トライアル中は課金が始まっていないので
 * 含めない（別指標 users_trialing で見る）。プラン月額の正本は `src/lib/plans.ts`。
 */
async function computeStateRows(db: Queryable, metricDate: string): Promise<KpiRow[]> {
  const rows: KpiRow[] = [];

  const users = await db.query<{ total: string; confirmed: string }>(
    `select count(*)::text as total,
            count(*) filter (where email_confirmed_at is not null)::text as confirmed
       from auth.users`,
  );
  rows.push({
    metric_date: metricDate,
    metric: "users_total",
    dimension: "",
    value: Number(users.rows[0]?.total ?? 0),
  });

  /*
    **`plan` は null があり得る**（未契約のまま status だけ動いた行。ローカルの実DBで
    558行が plan=null・status=active だった——このdbテストが無ければ本番の夜間tickで
    初めて not-null 制約に落ちていた）。null は 'unknown' として数え、単価は0円扱い。
  */
  const subs = await db.query<{ plan: string | null; status: string; n: string }>(
    `select plan::text as plan, subscription_status::text as status, count(*)::text as n
       from profiles
      where subscription_status in ('trialing', 'active', 'past_due')
      group by 1, 2`,
  );
  let mrrJpy = 0;
  let paying = 0;
  let trialing = 0;
  for (const r of subs.rows) {
    const n = Number(r.n);
    const planKey = r.plan ?? "unknown";
    if (r.status === "trialing") {
      trialing += n;
      rows.push({ metric_date: metricDate, metric: "users_trialing", dimension: planKey, value: n });
      continue;
    }
    // active / past_due は課金中として数える（past_due は支払い再試行中でまだ契約が生きている）。
    paying += n;
    rows.push({ metric_date: metricDate, metric: "users_paying", dimension: planKey, value: n });
    const price = r.plan ? (PLANS[r.plan as PlanId]?.monthlyPriceJpy ?? 0) : 0;
    mrrJpy += price * n;
  }
  rows.push({ metric_date: metricDate, metric: "users_paying", dimension: "total", value: paying });
  rows.push({ metric_date: metricDate, metric: "users_trialing", dimension: "total", value: trialing });
  rows.push({ metric_date: metricDate, metric: "mrr_jpy", dimension: "", value: mrrJpy });

  const xAccounts = await db.query<{ n: string }>(
    `select count(*)::text as n from x_accounts where status = 'active'`,
  );
  rows.push({
    metric_date: metricDate,
    metric: "x_accounts_active",
    dimension: "",
    value: Number(xAccounts.rows[0]?.n ?? 0),
  });

  return rows;
}

export interface KpiSnapshotResult {
  ran: boolean;
  written: number;
  backfilled: boolean;
}

/**
 * 日次スナップショット本体。scheduler_tick から1日1回呼ばれる（claimは呼び出し側）。
 *
 * - 状態指標: 「前日の終わり」として前日の日付で書く（日付が変わった直後のtickが担う）
 * - 出来事指標: 直近 EVENT_RECOMPUTE_DAYS 日を計算し直す（遅延データを拾う）
 * - 初回（表が空）: 残っている元データから出来事指標を最大400日ぶんバックフィルする。
 *   **手作業のバックフィルコマンドを作らない**（原則3——忘れると穴が開く手順を残さない）
 */
export async function runDailyKpiSnapshot(
  db: Queryable,
  nowIso: string,
): Promise<KpiSnapshotResult> {
  const yesterday = jstDaysAgo(nowIso, 1);

  const existing = await db.query<{ n: string }>(`select count(*)::text as n from kpi_daily`);
  const isFirstRun = Number(existing.rows[0]?.n ?? 0) === 0;

  const eventFrom = isFirstRun
    ? jstDaysAgo(nowIso, BACKFILL_MAX_DAYS)
    : jstDaysAgo(nowIso, EVENT_RECOMPUTE_DAYS);

  const eventRows = await computeEventRows(db, eventFrom, yesterday);
  const stateRows = await computeStateRows(db, yesterday);
  const written = await upsertRows(db, [...eventRows, ...stateRows]);
  return { ran: true, written, backfilled: isFirstRun };
}

// --- 読み出し（/admin 用） ---

export interface KpiSeriesPoint {
  date: string;
  value: number;
}

/** 指標の時系列（内訳は合算）。 */
export async function readKpiSeries(
  db: Queryable,
  metric: string,
  days: number,
): Promise<KpiSeriesPoint[]> {
  const { rows } = await db.query<{ d: string; v: string }>(
    `select metric_date::text as d, sum(value)::text as v
       from kpi_daily
      where metric = $1
        and metric_date > (now() at time zone 'Asia/Tokyo')::date - make_interval(days => $2)
      group by 1 order by 1`,
    [metric, days],
  );
  return rows.map((r) => ({ date: r.d, value: Number(r.v) }));
}

/**
 * ホーム（LP）来訪者の日次推移（T-M8-379・運営者の指示 2026-08-30）。
 *
 * 過去分は `kpi_daily`（400日）、**今日の途中経過は生の `page_views`** から足す——
 * スナップショットは「前日まで」しか書かないので、kpi_dailyだけだと今日が常に0に見える。
 * 出来事指標は昨日までしか書かれないため日付の重複は起きないが、念のためJS側でも
 * 同日が2つ来たら後勝ち（生データ優先）にする。
 */
export async function readHomeVisitorSeries(
  db: Queryable,
  days: number,
): Promise<KpiSeriesPoint[]> {
  const { rows } = await db.query<{ d: string; v: string }>(
    `select d, v from (
       select metric_date::text as d, sum(value)::text as v
         from kpi_daily
        where metric = 'page_uniques' and dimension = '/'
          and metric_date > (now() at time zone 'Asia/Tokyo')::date - make_interval(days => $1)
        group by 1
       union all
       select view_date::text as d, count(*)::text as v
         from page_views
        where path = '/' and view_date = (now() at time zone 'Asia/Tokyo')::date
        group by 1
     ) merged
     order by d`,
    [days],
  );
  const byDate = new Map<string, number>();
  for (const r of rows) byDate.set(r.d, Number(r.v));
  return [...byDate.entries()].map(([date, value]) => ({ date, value }));
}

export interface EntryFunnelStage {
  /** page＝閲覧記録の行、event＝件数だけの段（登録完了）。 */
  kind: "page" | "event";
  label: string;
  path: string | null;
  /** event の段は表示回数を持たない。 */
  views: number | null;
  /** page は日次ユニークの合計（識別は日替わりハッシュなので日をまたいだ同一人物は複数回数える）、event は件数。 */
  uniqueVisitorDays: number;
}

/**
 * 入口ファネル（直近30日・未ログイン含む）: ホーム → 新規登録画面 → 登録完了（T-M8-378→T-M8-422）。
 * 生の `page_views`（40日保持）から読む——kpi_daily は前日までしか無く、
 * 運営者が見たいのは「いま」を含む直近の入りだから。
 */
export async function readEntryFunnel(db: Queryable): Promise<EntryFunnelStage[]> {
  // 窓は JST（`current_date` は UTC で、JST 0〜9時は窓が1日ずれた・T-M8-422）。
  const { rows } = await db.query<{ path: string; views: string; uniques: string }>(
    `select path, coalesce(sum(views), 0)::text as views, count(*)::text as uniques
       from page_views
      where view_date > (now() at time zone 'Asia/Tokyo')::date - 30
      group by path`,
  );
  const byPath = new Map(rows.map((r) => [r.path, r]));
  /*
    3段目は「登録完了」（直近30日に作られた auth.users）。以前は「料金画面（/plans）」だったが、
    /plans はログイン必須で未ログインの人は到達できず、登録直後・プラン変更・Portal戻りでも数えるため、
    「新規登録画面→料金画面」の通過率が意味を持たなかった（T-M8-422）。退会した人は消えるので目安。
  */
  const signups = await db.query<{ n: string }>(
    `select count(*)::text as n from auth.users
      where (created_at at time zone 'Asia/Tokyo')::date > (now() at time zone 'Asia/Tokyo')::date - 30`,
  );
  const pageStage = (label: string, path: string): EntryFunnelStage => ({
    kind: "page",
    label,
    path,
    views: Number(byPath.get(path)?.views ?? 0),
    uniqueVisitorDays: Number(byPath.get(path)?.uniques ?? 0),
  });
  return [
    pageStage("ホーム（LP）", "/"),
    pageStage("新規登録画面", "/signup"),
    {
      kind: "event",
      label: "登録完了",
      path: null,
      views: null,
      uniqueVisitorDays: Number(signups.rows[0]?.n ?? 0),
    },
  ];
}

export interface FunnelStage {
  label: string;
  count: number;
}

/**
 * 登録→課金のファネル（全期間・いまの姿）。
 *
 * スナップショットではなく**残っている元データから直接**数える。退会した人は消えるので
 * 「これまでの累計」ではなく「いまいる人の到達段階」——利用者が少ないうちはこの方が
 * 1人ずつ突き合わせられて役に立つ。
 */
export async function readFunnel(db: Queryable): Promise<FunnelStage[]> {
  const { rows } = await db.query<{
    total: string;
    confirmed: string;
    connected: string;
    generated: string;
    trialed: string;
    paying: string;
  }>(
    `select
       (select count(*) from auth.users)::text as total,
       (select count(*) from auth.users where email_confirmed_at is not null)::text as confirmed,
       (select count(distinct user_id) from x_accounts)::text as connected,
       (select count(distinct xa.user_id) from generation_jobs j
          join x_accounts xa on xa.id = j.x_account_id
         where j.kind in ('post_generation', 'image_generation') and j.status = 'succeeded')::text as generated,
       (select count(*) from profiles where trial_used_at is not null)::text as trialed,
       (select count(*) from profiles
         where subscription_status in ('active', 'past_due'))::text as paying`,
  );
  const r = rows[0];
  return [
    { label: "登録", count: Number(r?.total ?? 0) },
    { label: "メール確認", count: Number(r?.confirmed ?? 0) },
    { label: "X連携", count: Number(r?.connected ?? 0) },
    { label: "初回生成", count: Number(r?.generated ?? 0) },
    { label: "トライアル開始", count: Number(r?.trialed ?? 0) },
    { label: "課金中", count: Number(r?.paying ?? 0) },
  ];
}

export interface CostBreakdownRow {
  key: string;
  usd: number;
}

/** 今月（JST）の原価内訳。group は provider / operation / user。 */
export async function readMonthCostBreakdown(
  db: Queryable,
  group: "provider" | "operation" | "user",
  limit: number,
): Promise<CostBreakdownRow[]> {
  // 利用者別で user_id が null の行は「運営・共通」（ニュース基盤）と「退会済み利用者」を分ける
  // （FK は on delete set null なので、退会者の分がニュースの費用に見えた・T-M8-422）。
  const keyExpr =
    group === "provider"
      ? "e.provider::text"
      : group === "operation"
        ? "e.operation"
        : "coalesce(u.email, case when e.user_id is null and e.job_id is null then '（運営・共通）' else '（退会済み利用者）' end)";
  const { rows } = await db.query<{ key: string; usd: string }>(
    `select ${keyExpr} as key, coalesce(sum(e.estimated_cost_usd), 0)::text as usd
       from external_api_usage_events e
       left join auth.users u on u.id = e.user_id
      where e.payer = 'operator'
        and date_trunc('month', e.occurred_at at time zone 'Asia/Tokyo')
            = date_trunc('month', now() at time zone 'Asia/Tokyo')
      group by 1 order by sum(e.estimated_cost_usd) desc nulls last
      limit $1`,
    [limit],
  );
  return rows.map((r) => ({ key: r.key, usd: Number(r.usd) }));
}

export interface AdminSummary {
  mrrJpy: number;
  paying: number;
  trialing: number;
  /** いま残っている登録者数（累計ではない。退会で減る）。 */
  usersTotal: number;
  /** 今月の原価（運営負担・payer='operator' だけ）。 */
  monthCostUsd: number;
  monthCostJpy: number;
  /** 今月の利用者負担（BYOK）の推定額。原価ではないが参考に出す。 */
  monthUserPaidCostUsd: number;
  grossProfitJpy: number;
}

/** サマリカード用の「いま」の数字（スナップショットではなく生データから）。 */
export async function readAdminSummary(db: Queryable): Promise<AdminSummary> {
  const subs = await db.query<{ plan: string | null; status: string; n: string }>(
    `select plan::text as plan, subscription_status::text as status, count(*)::text as n
       from profiles
      where subscription_status in ('trialing', 'active', 'past_due')
      group by 1, 2`,
  );
  let mrrJpy = 0;
  let paying = 0;
  let trialing = 0;
  for (const r of subs.rows) {
    const n = Number(r.n);
    if (r.status === "trialing") trialing += n;
    else {
      paying += n;
      // plan=null（未契約のままstatusだけ動いた行）は0円として数に入れる。
      mrrJpy += (r.plan ? (PLANS[r.plan as PlanId]?.monthlyPriceJpy ?? 0) : 0) * n;
    }
  }
  const totals = await db.query<{ users: string; usd: string; user_usd: string }>(
    `select (select count(*) from auth.users)::text as users,
            (select coalesce(sum(estimated_cost_usd), 0) from external_api_usage_events
              where payer = 'operator'
                and date_trunc('month', occurred_at at time zone 'Asia/Tokyo')
                    = date_trunc('month', now() at time zone 'Asia/Tokyo'))::text as usd,
            (select coalesce(sum(estimated_cost_usd), 0) from external_api_usage_events
              where payer = 'user'
                and date_trunc('month', occurred_at at time zone 'Asia/Tokyo')
                    = date_trunc('month', now() at time zone 'Asia/Tokyo'))::text as user_usd`,
  );
  const monthCostUsd = Number(totals.rows[0]?.usd ?? 0);
  const monthCostJpy = Math.round(monthCostUsd * JPY_PER_USD);
  return {
    mrrJpy,
    paying,
    trialing,
    usersTotal: Number(totals.rows[0]?.users ?? 0),
    monthCostUsd,
    monthCostJpy,
    monthUserPaidCostUsd: Number(totals.rows[0]?.user_usd ?? 0),
    grossProfitJpy: mrrJpy - monthCostJpy,
  };
}

export interface UserOverviewRow {
  email: string;
  signedUpDate: string | null;
  confirmed: boolean;
  plan: string | null;
  subscriptionStatus: string | null;
  /** 連携中のXハンドル（カンマ区切り。無ければnull）。 */
  handles: string | null;
  generations: number;
  posts: number;
  monthCostUsd: number;
  lastUsedAt: string | null;
}

/**
 * 利用者一覧と利用者別の代表データ（T-M8-374・運営者の指示 2026-08-30）。
 *
 * 利用者が少ないうちは集計より**1人ずつ見る**方が判断に効く（誰がどこで止まっているか・
 * 誰に原価がかかっているか）。登録の新しい順。運営者しか見ない画面なのでメールを出す。
 * `auth.users.created_at` はローカルのテストデータでは null があり得る（GoTrueがアプリ側で
 * 入れる値のため）——nulls last で並べ、表示は「—」にする。
 */
export async function readUsersOverview(db: Queryable, limit: number): Promise<UserOverviewRow[]> {
  const { rows } = await db.query<{
    email: string;
    signed_up: string | null;
    confirmed: boolean;
    plan: string | null;
    status: string | null;
    handles: string | null;
    generations: string;
    posts: string;
    month_cost: string;
    last_used: string | null;
  }>(
    `select u.email,
            (u.created_at at time zone 'Asia/Tokyo')::date::text as signed_up,
            (u.email_confirmed_at is not null) as confirmed,
            p.plan::text as plan,
            p.subscription_status::text as status,
            (select string_agg('@' || xa.handle, ', ' order by xa.created_at)
               from x_accounts xa where xa.user_id = u.id) as handles,
            (select count(*) from generation_jobs j
               join x_accounts xa on xa.id = j.x_account_id
              where xa.user_id = u.id and j.status = 'succeeded'
                and j.kind in ('post_generation', 'image_generation'))::text as generations,
            (select count(*) from usage_events e
              where e.user_id = u.id and e.reason = 'consume' and e.delta > 0
                and e.operation = 'post_create')::text as posts,
            (select coalesce(sum(c.estimated_cost_usd), 0) from external_api_usage_events c
              where c.user_id = u.id and c.payer = 'operator'
                and date_trunc('month', c.occurred_at at time zone 'Asia/Tokyo')
                    = date_trunc('month', now() at time zone 'Asia/Tokyo'))::text as month_cost,
            (select max(e.created_at) from usage_events e where e.user_id = u.id)::text as last_used
       from auth.users u
       left join profiles p on p.id = u.id
      order by u.created_at desc nulls last
      limit $1`,
    [limit],
  );
  return rows.map((r) => ({
    email: r.email,
    signedUpDate: r.signed_up,
    confirmed: r.confirmed,
    plan: r.plan,
    subscriptionStatus: r.status,
    handles: r.handles,
    generations: Number(r.generations),
    posts: Number(r.posts),
    monthCostUsd: Number(r.month_cost),
    lastUsedAt: r.last_used,
  }));
}

export interface CancellationRow {
  createdAt: string;
  plan: string | null;
  reason: string;
  detail: string | null;
  proceeded: boolean;
}

/** 解約アンケートの直近分（新しい順）。 */
export async function readRecentCancellations(
  db: Queryable,
  limit: number,
): Promise<CancellationRow[]> {
  const { rows } = await db.query<{
    created_at: string;
    plan: string | null;
    reason: string;
    detail: string | null;
    proceeded: boolean;
  }>(
    // 列名は `reasons`（複数選択の配列。当初の単数 `reason` は後のmigrationで置き換わっている）。
    `select created_at::text as created_at, plan::text as plan,
            array_to_string(reasons, '、') as reason, detail, proceeded
       from cancellation_surveys
      order by created_at desc
      limit $1`,
    [limit],
  );
  return rows.map((r) => ({
    createdAt: r.created_at,
    plan: r.plan,
    reason: r.reason,
    detail: r.detail,
    proceeded: r.proceeded,
  }));
}
