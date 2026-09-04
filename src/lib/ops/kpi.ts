import { discountedMonthlyJpy } from "@/lib/billing/discounted-price";
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
 *   解約も状態で持つ（`users_canceled`＝解約済みの人数・`users_cancel_scheduled`＝期末で
 *   消える確定解約の人数）。実解約の日付列は無いが、状態なら毎日1行書ける（T-M8-427）。
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

export interface JstMonthProgress {
  /** 月初からの経過日数（**今日を含む**。1〜31）。 */
  elapsedDays: number;
  /** 当月の日数（28〜31）。 */
  daysInMonth: number;
}

/** nowIso がJSTで「当月の何日目か」と「当月が何日あるか」。粗利の月末見込み（日割り）に使う。 */
export function jstMonthProgress(nowIso: string): JstMonthProgress {
  const jst = new Date(new Date(nowIso).getTime() + JST_OFFSET_MS);
  const daysInMonth = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth() + 1, 0)).getUTCDate();
  return { elapsedDays: jst.getUTCDate(), daysInMonth };
}

/**
 * 月初からの累計を日割りで月末まで延ばす（累計 ÷ 経過日数 × 当月の日数・円は整数へ丸める）。
 * 累計0なら0、1日目なら「今日の額 × 日数」——どちらも割り算で壊れない。
 */
export function projectToMonthEnd(accumulated: number, progress: JstMonthProgress): number {
  if (progress.elapsedDays <= 0) return Math.round(accumulated);
  return Math.round((accumulated / progress.elapsedDays) * progress.daysInMonth);
}

/**
 * 日割りを信用する最短の経過日数。月初は「今日の途中経過 × 当月日数」になり、原価が定時ジョブ
 * （朝の指標収集・ニュース）で1日の中でも偏って発生するため、1〜2日目の見込みは時間帯で大きく振れる
 * （JST 1日 00:30 は原価≒0 → 見込み粗利≒MRR。同じ日の夜は「今日の額×31」）。
 */
export const PRORATION_MIN_DAYS = 3;

export type MonthCostForecastBasis = "prorated" | "previous_month";

/**
 * 原価の月末見込み。経過が `PRORATION_MIN_DAYS` 未満で前月の実績があるときは**前月実績を仮置き**
 * （ただし今月すでに前月を超えていれば今月の累計。見込みが実績を下回ると嘘になる）、それ以外は日割り。
 * 前月実績が無い（初月）ときは日割りに戻す——画面側で「月初は大きく動く」と添える。
 */
export function forecastMonthCost(args: {
  accumulatedJpy: number;
  previousMonthJpy: number;
  progress: JstMonthProgress;
}): { jpy: number; basis: MonthCostForecastBasis } {
  const { accumulatedJpy, previousMonthJpy, progress } = args;
  if (progress.elapsedDays < PRORATION_MIN_DAYS && previousMonthJpy > 0) {
    return {
      jpy: Math.max(Math.round(previousMonthJpy), Math.round(accumulatedJpy)),
      basis: "previous_month",
    };
  }
  return { jpy: projectToMonthEnd(accumulatedJpy, progress), basis: "prorated" };
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

  // 解約手続きへ進んだ数（cancellation_surveys.proceeded=true）。**実解約ではない**——
  // 確認画面を通った後に引き止めクーポンで残った人も含むので、名前は `cancel_intents`
  // （旧 `cancellations`・T-M8-427。既存行は migration 20260905000001 が改名）。
  // 実解約（subscription_status が 'canceled' へ変わった日）は遷移の記録が無く
  // （profiles に日付列が無い・stripe_events は90日で消え本番のwebhook経由だけ）、
  // 出来事にはできない。代わりに状態指標 `users_canceled`／`users_cancel_scheduled`
  // （computeStateRows）を毎日書き、その差分で読む。
  const cancels = await db.query<{ d: string; n: string }>(
    `select ${day("created_at")}::text as d, count(*)::text as n
       from cancellation_surveys
      where proceeded = true
        and ${day("created_at")} between $1 and $2
      group by 1`,
    range,
  );
  for (const r of cancels.rows) {
    rows.push({ metric_date: r.d, metric: "cancel_intents", dimension: "", value: Number(r.n) });
  }

  return rows;
}

interface SubscriptionProfileRow {
  plan: string | null;
  status: string;
  discount_percent_off: number | null;
  discount_amount_off_jpy: number | null;
  /** pg は timestamptz を Date で返す。`::text` 経由の文字列でも受ける。 */
  discount_ends_at: Date | string | null;
}

interface SubscriptionTotals {
  /** 割引後の月額の合計（円）。 */
  mrrJpy: number;
  paying: number;
  trialing: number;
  /** 課金中のうち、有効な割引で月額が定価より下がっている人数。 */
  discounted: number;
  /** 割引による減額の合計（定価の合計 − mrrJpy・円）。運営者が「反映されたか・いくら違うか」を画面で確かめるため。 */
  discountJpy: number;
  /** プラン別の人数（plan=null は 'unknown'）。 */
  payingByPlan: Map<string, number>;
  trialingByPlan: Map<string, number>;
}

/**
 * 契約中の profiles を**1行ずつ**読んで、契約者数とMRRを数える（/admin のサマリと日次スナップショットで共用）。
 *
 * MRRは **active／past_due（課金中）× 割引後のプラン月額** で数える（運営者の決定 2026-09-04・D-55(1)）。
 * 割引は `profiles.discount_*`（引き止めクーポンの写し・T-M8-279）で、`discount_ends_at` を過ぎたものは
 * 掛けない。**group by では割引が掛けられない**（割引は契約者ごとに率・期限が違う）ので行単位で読む。
 * プラン月額の正本は `src/lib/plans.ts` の**現在値**——キャンペーン価格が改定されたら過去のMRRの
 * スナップショットは改定前の値のまま残り、以後の値だけ変わる。
 *
 * トライアル中は課金が始まっていないので含めない（別指標 users_trialing で見る）。
 * past_due は支払い再試行中でまだ契約が生きているので課金中に入れる。
 *
 * **`plan` は null があり得る**（未契約のまま status だけ動いた行。ローカルの実DBで
 * 558行が plan=null・status=active だった——このdbテストが無ければ本番の夜間tickで
 * 初めて not-null 制約に落ちていた）。null は 'unknown' として数え、単価は0円扱い。
 */
async function readSubscriptionTotals(db: Queryable, nowIso: string): Promise<SubscriptionTotals> {
  const { rows } = await db.query<SubscriptionProfileRow>(
    `select plan::text as plan, subscription_status::text as status,
            discount_percent_off, discount_amount_off_jpy, discount_ends_at
       from profiles
      where subscription_status in ('trialing', 'active', 'past_due')`,
  );
  const totals: SubscriptionTotals = {
    mrrJpy: 0,
    paying: 0,
    trialing: 0,
    discounted: 0,
    discountJpy: 0,
    payingByPlan: new Map(),
    trialingByPlan: new Map(),
  };
  const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);
  for (const r of rows) {
    const planKey = r.plan ?? "unknown";
    if (r.status === "trialing") {
      totals.trialing += 1;
      bump(totals.trialingByPlan, planKey);
      continue;
    }
    totals.paying += 1;
    bump(totals.payingByPlan, planKey);
    const price = r.plan ? (PLANS[r.plan as PlanId]?.monthlyPriceJpy ?? 0) : 0;
    const net = discountedMonthlyJpy({
      monthlyPriceJpy: price,
      percentOff: r.discount_percent_off,
      amountOffJpy: r.discount_amount_off_jpy,
      discountEndsAt: r.discount_ends_at,
      now: nowIso,
    });
    totals.mrrJpy += net;
    // 「割引中」は定価より実際に下がっている契約だけ（期限切れ・plan=null の0円は数えない）。
    if (net < price) {
      totals.discounted += 1;
      totals.discountJpy += price - net;
    }
  }
  return totals;
}

/**
 * 状態指標を「いまの値」として計算する（metric_date は呼び出し側が決める）。
 * MRR・契約者数の数え方は `readSubscriptionTotals` を見る。
 */
async function computeStateRows(
  db: Queryable,
  metricDate: string,
  nowIso: string,
): Promise<KpiRow[]> {
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

  const subs = await readSubscriptionTotals(db, nowIso);
  for (const [planKey, n] of subs.trialingByPlan) {
    rows.push({ metric_date: metricDate, metric: "users_trialing", dimension: planKey, value: n });
  }
  for (const [planKey, n] of subs.payingByPlan) {
    rows.push({ metric_date: metricDate, metric: "users_paying", dimension: planKey, value: n });
  }
  rows.push({ metric_date: metricDate, metric: "users_paying", dimension: "total", value: subs.paying });
  rows.push({ metric_date: metricDate, metric: "users_trialing", dimension: "total", value: subs.trialing });
  rows.push({ metric_date: metricDate, metric: "mrr_jpy", dimension: "", value: subs.mrrJpy });

  // 解約の状態（T-M8-427）。実解約の日付列は無いので「いま何人か」を毎日写し、差分で読む。
  // - users_canceled: subscription_status='canceled' の人数（退会すると行ごと消えて減る・再契約でも減る）
  // - users_cancel_scheduled: 課金中（active／past_due）で期末解約が確定している人数
  //   （引き止めで残らなかった人が「いま何人いるか」。トライアル中の解約予約は課金が無いので含めない）
  const cancels = await db.query<{ canceled: string; scheduled: string }>(
    `select count(*) filter (where subscription_status = 'canceled')::text as canceled,
            count(*) filter (where cancel_at_period_end
                               and subscription_status in ('active', 'past_due'))::text as scheduled
       from profiles`,
  );
  rows.push({
    metric_date: metricDate,
    metric: "users_canceled",
    dimension: "",
    value: Number(cancels.rows[0]?.canceled ?? 0),
  });
  rows.push({
    metric_date: metricDate,
    metric: "users_cancel_scheduled",
    dimension: "",
    value: Number(cancels.rows[0]?.scheduled ?? 0),
  });

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
  const stateRows = await computeStateRows(db, yesterday, nowIso);
  // 旧名 `cancellations`（T-M8-427 で `cancel_intents` へ改名）の取り残しを掃除する。migration が
  // 既存行を改名した後でも、release は migration→deploy の順なので、その間に日付を跨ぐと旧コードが
  // 直近3日ぶんを旧名で書き直す。読み手が無い行は誰も消さないため、毎回この窓だけ消す（通常は0件）。
  await db.query(
    `delete from kpi_daily where metric = 'cancellations' and metric_date between $1 and $2`,
    [eventFrom, yesterday],
  );
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

export interface TrafficSourceRow {
  /** '' は直接・不明。 */
  slug: string;
  label: string;
  createdAt: string | null;
  homeViews: number;
  homeUniqueVisitorDays: number;
  signupUniqueVisitorDays: number;
  signups: number;
  paying: number;
}

/**
 * 流入元ごとの入り（T-M8-423・直近30日JST）。閲覧は `page_views.source`、登録は
 * `profiles.signup_source`（登録時に1回だけ書く）、課金中は同じ列で「いま課金中」を数える。
 * Cookie を持たないため、LP→/signup を直接進んだ人だけが登録に紐づく（途中で別ページを挟むと切れる）。
 * 未登録・形式外の `src` は '' に寄せて数えている（`recordPageView`）。
 */
export async function readTrafficSources(db: Queryable): Promise<TrafficSourceRow[]> {
  const { rows } = await db.query<{
    slug: string;
    label: string;
    created_at: string | null;
    home_views: string;
    home_uniques: string;
    signup_uniques: string;
    signups: string;
    paying: string;
  }>(
    `with pv as (
       select source,
              coalesce(sum(views) filter (where path = '/'), 0)::text as home_views,
              count(*) filter (where path = '/')::text as home_uniques,
              count(*) filter (where path = '/signup')::text as signup_uniques
         from page_views
        where view_date > (now() at time zone 'Asia/Tokyo')::date - 30
        group by source
     ), su as (
       select p.signup_source as source,
              count(*) filter (
                where (u.created_at at time zone 'Asia/Tokyo')::date
                      > (now() at time zone 'Asia/Tokyo')::date - 30)::text as signups,
              count(*) filter (where p.subscription_status in ('active', 'past_due'))::text as paying
         from profiles p
         join auth.users u on u.id = p.id
        group by p.signup_source
     )
     select s.slug, s.label, s.created_at::text as created_at,
            coalesce(pv.home_views, '0') as home_views,
            coalesce(pv.home_uniques, '0') as home_uniques,
            coalesce(pv.signup_uniques, '0') as signup_uniques,
            coalesce(su.signups, '0') as signups,
            coalesce(su.paying, '0') as paying
       from (select slug, label, created_at from traffic_sources
             union all select '', '直接・不明', null::timestamptz) s
       left join pv on pv.source = s.slug
       left join su on su.source = s.slug
      order by (s.slug = '') asc, coalesce(pv.home_views, '0')::bigint desc, s.created_at desc nulls last`,
  );
  return rows.map((r) => ({
    slug: r.slug,
    label: r.label,
    createdAt: r.created_at,
    homeViews: Number(r.home_views),
    homeUniqueVisitorDays: Number(r.home_uniques),
    signupUniqueVisitorDays: Number(r.signup_uniques),
    signups: Number(r.signups),
    paying: Number(r.paying),
  }));
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
  /** 割引後の月額の合計（引き止めクーポンを反映・D-55(1)）。 */
  mrrJpy: number;
  paying: number;
  trialing: number;
  /** 課金中のうち割引で月額が下がっている人数（0なら「割引中なし」と出す）。 */
  discounted: number;
  /** 割引による減額の合計（定価の合計 − mrrJpy・円）。 */
  discountJpy: number;
  /** いま残っている登録者数（累計ではない。退会で減る）。 */
  usersTotal: number;
  /** 今月これまでの原価（運営負担・payer='operator' だけ。JSTの月初から今日まで）。 */
  monthCostUsd: number;
  monthCostJpy: number;
  /** 今月の利用者負担（BYOK）の推定額。原価ではないが参考に出す。 */
  monthUserPaidCostUsd: number;
  /** JSTで当月の何日目か（今日を含む）と当月の日数。「原価は◯日ぶん」の注記と日割りの根拠。 */
  monthElapsedDays: number;
  monthDays: number;
  /** 前月の原価（運営負担・円）。月初 `PRORATION_MIN_DAYS` 日間の見込みの仮置きに使う（無ければ0）。 */
  previousMonthCostJpy: number;
  /** 今月の原価の月末見込み（円）。根拠は `monthCostForecastBasis`（`forecastMonthCost`）。 */
  monthCostForecastJpy: number;
  /** 見込みの根拠: 日割り（これまで ÷ 経過日数 × 当月日数）か、月初だけの前月実績の仮置きか。 */
  monthCostForecastBasis: MonthCostForecastBasis;
  /** 今月これまでの粗利（MRR − 月初からの原価）。月初は大きく月末へ向けて減って見える値。 */
  grossProfitJpy: number;
  /** 月末見込みの粗利（MRR − 原価の月末見込み）。カードの主値（D-55(2)・T-M8-427）。 */
  grossProfitForecastJpy: number;
}

/**
 * サマリカード用の「いま」の数字（スナップショットではなく生データから）。
 * `nowIso` は割引の期限判定と「今月」の窓（JST）・日割りの経過日数に使う
 * （省略時は現在時刻。テストで固定できるように引数にしている）。
 *
 * 粗利は「MRR（月額の走り高）− 月初からの累積原価」だと月初に大きく月末に向けて減って見える
 * （2026-09-04 の監査・D-55(2)）。主値は**月末見込み**（原価を日割りで月末まで延ばす。月初
 * `PRORATION_MIN_DAYS` 日間は前月実績を仮置き・`forecastMonthCost`）にし、「これまで」も返して
 * 画面で両方読めるようにする。
 */
export async function readAdminSummary(
  db: Queryable,
  nowIso: string = new Date().toISOString(),
): Promise<AdminSummary> {
  const { mrrJpy, paying, trialing, discounted, discountJpy } = await readSubscriptionTotals(
    db,
    nowIso,
  );
  const totals = await db.query<{ users: string; usd: string; user_usd: string; prev_usd: string }>(
    `select (select count(*) from auth.users)::text as users,
            (select coalesce(sum(estimated_cost_usd), 0) from external_api_usage_events
              where payer = 'operator'
                and date_trunc('month', occurred_at at time zone 'Asia/Tokyo')
                    = date_trunc('month', $1::timestamptz at time zone 'Asia/Tokyo'))::text as usd,
            (select coalesce(sum(estimated_cost_usd), 0) from external_api_usage_events
              where payer = 'user'
                and date_trunc('month', occurred_at at time zone 'Asia/Tokyo')
                    = date_trunc('month', $1::timestamptz at time zone 'Asia/Tokyo'))::text as user_usd,
            (select coalesce(sum(estimated_cost_usd), 0) from external_api_usage_events
              where payer = 'operator'
                and date_trunc('month', occurred_at at time zone 'Asia/Tokyo')
                    = date_trunc('month', $1::timestamptz at time zone 'Asia/Tokyo') - interval '1 month')::text as prev_usd`,
    [nowIso],
  );
  const monthCostUsd = Number(totals.rows[0]?.usd ?? 0);
  const monthCostJpy = Math.round(monthCostUsd * JPY_PER_USD);
  const previousMonthCostJpy = Math.round(Number(totals.rows[0]?.prev_usd ?? 0) * JPY_PER_USD);
  const progress = jstMonthProgress(nowIso);
  const forecast = forecastMonthCost({
    accumulatedJpy: monthCostJpy,
    previousMonthJpy: previousMonthCostJpy,
    progress,
  });
  return {
    mrrJpy,
    paying,
    trialing,
    discounted,
    discountJpy,
    usersTotal: Number(totals.rows[0]?.users ?? 0),
    monthCostUsd,
    monthCostJpy,
    monthUserPaidCostUsd: Number(totals.rows[0]?.user_usd ?? 0),
    monthElapsedDays: progress.elapsedDays,
    monthDays: progress.daysInMonth,
    previousMonthCostJpy,
    monthCostForecastJpy: forecast.jpy,
    monthCostForecastBasis: forecast.basis,
    grossProfitJpy: mrrJpy - monthCostJpy,
    grossProfitForecastJpy: mrrJpy - forecast.jpy,
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
  /** 直近90日に成功した生成ジョブ数（`generation_jobs` は終了後90日で消えるので累計ではない）。 */
  generations: number;
  /** 投稿済みになった下書きの件数（`drafts.status='posted'`。スレッド1本＝1件）。 */
  posts: number;
  monthCostUsd: number;
  /**
   * 利用者**自身**の最後の操作（手動の生成・画像・投稿・学習ソース・提案＝`generation_jobs.trigger='manual'`、
   * および手動投稿＝`drafts.posted_mode='manual'` の `posted_at`）。予約枠の自動生成・自動投稿・
   * 投稿指標の収集は含まない。手動ジョブは90日で消えるので、それより前の操作しか無い人は null。
   */
  lastManualActionAt: string | null;
}

/**
 * 利用者一覧と利用者別の代表データ（T-M8-374・運営者の指示 2026-08-30）。
 *
 * 利用者が少ないうちは集計より**1人ずつ見る**方が判断に効く（誰がどこで止まっているか・
 * 誰に原価がかかっているか）。登録の新しい順。運営者しか見ない画面なのでメールを出す。
 * `auth.users.created_at` はローカルのテストデータでは null があり得る（GoTrueがアプリ側で
 * 入れる値のため）——nulls last で並べ、表示は「—」にする。
 *
 * **投稿は `drafts.status='posted'` の件数**（所有者は drafts → x_accounts.user_id）。
 * 以前は usage_events の `post_create` 行数で、ツイート単位（スレッド1本＝N件）かつ
 * ロールバックの削除を差し引かず、BYOK は精算行が無いので0だった（D-55(4)・T-M8-427）。
 *
 * **最終操作は利用者自身の操作だけ**を源にする。`drafts.updated_at` は投稿指標の自動収集
 * （metrics-collector・投稿後1/7/30日）や期限切れ処理が進めるので「1回投稿して離脱した人」が
 * 最大30日「最近使った」に見え、`generation_jobs.created_at` を trigger 無条件で見ると予約枠の
 * 自動生成（'schedule'）とその連鎖（'system'）で枠を持つ人が常に「今日」になる（反証 2026-09-05）。
 * usage_events も自動生成の精算を含み、ジョブが消えた後は手動と区別できないので使わない。
 * 「利用者が触った」と言えるのは trigger='manual' のジョブと posted_mode='manual' の投稿だけ。
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
    last_manual_action: string | null;
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
            (select count(*) from drafts d
               join x_accounts xa on xa.id = d.x_account_id
              where xa.user_id = u.id and d.status = 'posted')::text as posts,
            (select coalesce(sum(c.estimated_cost_usd), 0) from external_api_usage_events c
              where c.user_id = u.id and c.payer = 'operator'
                and date_trunc('month', c.occurred_at at time zone 'Asia/Tokyo')
                    = date_trunc('month', now() at time zone 'Asia/Tokyo'))::text as month_cost,
            -- greatest() は null を無視する（全部 null のときだけ null）。
            greatest(
              (select max(j.created_at) from generation_jobs j
                 join x_accounts xa on xa.id = j.x_account_id
                where xa.user_id = u.id and j.trigger = 'manual'),
              (select max(d.posted_at) from drafts d
                 join x_accounts xa on xa.id = d.x_account_id
                where xa.user_id = u.id and d.posted_mode = 'manual')
            )::text as last_manual_action
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
    lastManualActionAt: r.last_manual_action,
  }));
}

export interface CancellationOutcome {
  /** 直近30日（JST）に「解約手続きへ進んだ」回答の件数（同じ人の複数回も数える）。 */
  intents: number;
  /** その回答をした人数（退会した人はアンケートごと消えるので入らない）。 */
  users: number;
  /** うち、いま `subscription_status='canceled'` の人数。 */
  canceled: number;
  /** うち、契約中（active／past_due／trialing）で期末解約が確定している人数。 */
  cancelScheduled: number;
  /** うち、契約中で解約予約も無い＝引き止めで残っている人数。 */
  continuing: number;
}

/**
 * 解約手続きへ進んだ人の**いまの状態**（T-M8-427）。`cancel_intents` は引き止めで残った人を含むので、
 * 実解約との差を画面で読めるように `cancellation_surveys.user_id → profiles` を突き合わせる。
 * 残り（incomplete／unpaid／paused 等）は `users − canceled − cancelScheduled − continuing`。
 */
export async function readCancellationOutcome(db: Queryable): Promise<CancellationOutcome> {
  const { rows } = await db.query<{
    intents: string;
    users: string;
    canceled: string;
    cancel_scheduled: string;
    continuing: string;
  }>(
    `with recent as (
       select user_id, count(*) as n
         from cancellation_surveys
        where proceeded = true
          and (created_at at time zone 'Asia/Tokyo')::date > (now() at time zone 'Asia/Tokyo')::date - 30
        group by user_id
     )
     select coalesce(sum(r.n), 0)::text as intents,
            count(*)::text as users,
            count(*) filter (where p.subscription_status = 'canceled')::text as canceled,
            count(*) filter (where p.cancel_at_period_end
                               and p.subscription_status in ('active', 'past_due', 'trialing'))::text as cancel_scheduled,
            count(*) filter (where not p.cancel_at_period_end
                               and p.subscription_status in ('active', 'past_due', 'trialing'))::text as continuing
       from recent r
       join profiles p on p.id = r.user_id`,
  );
  const r = rows[0];
  return {
    intents: Number(r?.intents ?? 0),
    users: Number(r?.users ?? 0),
    canceled: Number(r?.canceled ?? 0),
    cancelScheduled: Number(r?.cancel_scheduled ?? 0),
    continuing: Number(r?.continuing ?? 0),
  };
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
