import "server-only";

import { classifyNewsOutcome } from "@/lib/news-outcome";

import type { Queryable } from "../x/token-refresh";

import { FREE_DB_SIZE_LIMIT_BYTES, judgeDatabaseSize } from "./diagnostics";

/**
 * 日次サマリ（T-M7-29）。`CLAUDE.md`「前提：運営者は個人」原則1に対応する。
 *
 * **「成功として記録される失敗」は運営者が気付けない。** 2026-07-28、web3のニュース取得は
 * `ok:true fetched:0` を返し続け、分野が空のまま誰も気付かなかった。ダッシュボードは1人運用では
 * 見なくなるため、1日1通のまとめを push（画面通知＋メール）で届ける。
 *
 * 判定と文言はここに集約する（`diagnostics.ts` が「いまの状態」を見るのに対し、こちらは
 * **日をまたぐ推移**＝静かな劣化を見る）。内部用語は出さない。
 */

/** これ以上続いたら強調する連続0件日数。1日だけの0件は「その日は該当なし」で普通に起こる。 */
export const ZERO_STREAK_ALERT_DAYS = 3;

const JST_OFFSET_MS = 9 * 3_600_000;

/** UTC時刻 → JSTの日付（YYYY-MM-DD）。 */
export function jstDateOf(iso: string | Date): string {
  const ms = (typeof iso === "string" ? new Date(iso) : iso).getTime();
  return new Date(ms + JST_OFFSET_MS).toISOString().slice(0, 10);
}

export interface NewsDayRow {
  /** 実行日（JST）。 */
  date: string;
  category: string;
  saved: number;
  dropped: number;
}

/**
 * 分野ごとの「直近から連続して0件だった日数」。
 *
 * 実行のあった日だけを数える（実行していない日を0件と数えると、定時実行が動かない環境で
 * 全分野が警告になる）。新しい日から遡り、1件でも保存できた日で止める。
 */
export function zeroStreakByCategory(rows: NewsDayRow[]): Record<string, number> {
  const byCategory = new Map<string, NewsDayRow[]>();
  for (const row of rows) {
    const list = byCategory.get(row.category) ?? [];
    list.push(row);
    byCategory.set(row.category, list);
  }
  const out: Record<string, number> = {};
  for (const [category, list] of byCategory) {
    const days = [...new Set(list.map((r) => r.date))].sort().reverse();
    let streak = 0;
    for (const date of days) {
      const savedThatDay = list
        .filter((r) => r.date === date)
        .reduce((sum, r) => sum + r.saved, 0);
      if (savedThatDay > 0) break;
      streak += 1;
    }
    out[category] = streak;
  }
  return out;
}

export interface DailySummaryData {
  /** 対象日（JST）。 */
  date: string;
  jobs: { succeeded: number; failed: number };
  /** 分野ごとの連続0件日数。 */
  zeroStreaks: Record<string, number>;
  /** 直近1回の実行で全件破棄だった分野と理由（「窓より古いだけ」は除く）。 */
  allDropped: { category: string; reasons: string }[];
  /**
   * 直近1回で**取れた数より捨てた数が多かった**分野（T-M8-83）。
   * 0件ではないので警告にはしないが、黙って減っていくのを見逃さないため数字だけ載せる。
   */
  mostlyDropped: { category: string; fetched: number; dropped: number; ages: string | null }[];
  stuckJobs: number;
  queuedEmails: number;
  /** 送れなかったお知らせメール。終端状態なので放置すると届かないまま（T-M8-40）。 */
  failedEmails: number;
  monthUsd: number;
  /** DBの使用量（バイト）と上限。上限に近づいたら知らせる（T-M7-43）。 */
  dbBytes: number;
  dbLimitBytes: number;
}

export interface DailySummary {
  title: string;
  body: string;
  /** 強調すべきことがあるか（メール件名・画面の見せ方に使う）。 */
  needsAttention: boolean;
}

/**
 * まとめの本文を作る（純粋関数）。
 *
 * 良い日も1行で終わらせず、**数字を必ず出す**（「問題なし」だけだと止まっていても同じに見える）。
 */
export function buildDailySummary(data: DailySummaryData): DailySummary {
  const attention: string[] = [];
  const lines: string[] = [];

  const total = data.jobs.succeeded + data.jobs.failed;
  lines.push(
    total === 0
      ? "生成・投稿: 実行はありませんでした"
      : `生成・投稿: 成功 ${data.jobs.succeeded} 件 / 失敗 ${data.jobs.failed} 件`,
  );
  if (data.jobs.failed > 0) attention.push(`失敗した生成・投稿が ${data.jobs.failed} 件`);

  const streaks = Object.entries(data.zeroStreaks)
    .filter(([, days]) => days >= ZERO_STREAK_ALERT_DAYS)
    .sort((a, b) => b[1] - a[1]);
  if (streaks.length > 0) {
    const text = streaks.map(([category, days]) => `${category}（${days}日連続）`).join("・");
    lines.push(`ニュースが取れていないテーマ: ${text}`);
    attention.push(`ニュースが取れていないテーマ: ${text}`);
  } else {
    lines.push("ニュース: 各テーマで取得できています");
  }

  if (data.allDropped.length > 0) {
    const text = data.allDropped.map((a) => `${a.category}（${a.reasons}）`).join("・");
    lines.push(`直近の取得で全件破棄されたテーマ: ${text}`);
    attention.push(`全件破棄されたテーマ: ${text}`);
  }

  // **警告にはしない**（運営者が直せる問題ではない）。ただし数字を出さないと、
  // 取得件数が静かに減っていくことに誰も気付けない（T-M8-83）。
  if (data.mostlyDropped.length > 0) {
    const text = data.mostlyDropped
      .map(
        (m) =>
          `${m.category}（${m.fetched}件取得 / ${m.dropped}件除外${m.ages ? `・${m.ages}の記事` : ""}）`,
      )
      .join("・");
    lines.push(`直近の取得で取れた数より捨てた数が多かったテーマ: ${text}`);
  }

  if (data.stuckJobs > 0) {
    lines.push(`止まっている処理: ${data.stuckJobs} 件`);
    attention.push(`止まっている処理が ${data.stuckJobs} 件`);
  }
  // 失敗は終端状態で、`recoverQueuedEmails` は queued しか拾わない。
  // **黙って届かないまま**になるので「気になる点」に数える（T-M8-40）。
  if (data.failedEmails > 0) {
    lines.push(
      `送れなかったお知らせメール: ${data.failedEmails} 件（メール設定を確認し、通知ベルから再送してください）`,
    );
    attention.push(`送れなかったお知らせメールが ${data.failedEmails} 件`);
  }
  if (data.queuedEmails > 0) {
    lines.push(`送信待ちのお知らせメール: ${data.queuedEmails} 件`);
  }

  lines.push(`今月かかった費用: $${data.monthUsd.toFixed(2)}（約${Math.round(data.monthUsd * 150)}円）`);

  // 容量は「止まってから気付く」種類なので、毎日必ず数字を出す（2026-08-01に組織ごと停止した）。
  const dbCheck = judgeDatabaseSize({ bytes: data.dbBytes, limitBytes: data.dbLimitBytes });
  lines.push(`データベースの使用量: ${dbCheck.detail}`);
  if (dbCheck.level !== "ok") attention.push(`データベースの使用量が ${dbCheck.detail}`);

  const needsAttention = attention.length > 0;
  const title = needsAttention
    ? `${data.date} のまとめ: 気になる点が ${attention.length} 件あります`
    : `${data.date} のまとめ: 問題はありません`;
  const body = needsAttention
    ? [...lines, "", `対応が必要かもしれない点: ${attention.join(" / ")}`].join("\n")
    : lines.join("\n");
  return { title, body, needsAttention };
}

/** サマリ1通分のデータを集める（対象ユーザーの実績＋全体のニュース状況）。 */
export async function collectDailySummary(
  db: Queryable,
  userId: string,
  nowIso: string,
): Promise<DailySummaryData> {
  const date = jstDateOf(nowIso);

  const jobs = await db.query<{ succeeded: string; failed: string }>(
    `select count(*) filter (where gj.status = 'succeeded')::text as succeeded,
            count(*) filter (where gj.status = 'failed')::text as failed
       from generation_jobs gj
       join x_accounts xa on xa.id = gj.x_account_id
      where xa.user_id = $1 and gj.created_at > now() - interval '24 hours'`,
    [userId],
  );

  // 分野ごとの日別保存件数（直近14日）。実行のあった日だけが行になる。
  const news = await db.query<{ date: string; category: string; saved: number; dropped: number }>(
    `select to_char((ran_at + interval '9 hours')::date, 'YYYY-MM-DD') as date,
            category::text as category, sum(saved)::int as saved, sum(dropped)::int as dropped
       from news_fetch_outcomes
      where ran_at > now() - interval '14 days'
      group by 1, 2
      order by 1 desc`,
  );

  /**
   * 直近1回の窓の結果。**`fetched = 0` で絞らない**（T-M8-83）。
   * 以前は0件の分野だけを見ていたため、「1件は取れたが大半落ちた」状態が誰にも見えなかった。
   * 良性の除外を落とすのと、大半落ちの判定は、取得後に `lib/news-outcome.ts` で行う。
   */
  const latest = await db.query<{
    category: string;
    fetched: number;
    dropped: number;
    drop_reasons: Record<string, number> | null;
  }>(
    `select category::text as category, fetched, dropped, drop_reasons
       from news_fetch_outcomes
      where window_key = (select window_key from news_fetch_outcomes order by ran_at desc limit 1)
        and ok and dropped > 0`,
  );
  // 分類は `lib/news-outcome.ts` の1つだけを使う（doctor と同じ判定・R25）。
  // 抽出SQLで `ok` は絞り済みなので、ここへ渡す行はすべて成功した実行。
  const latestVerdicts = latest.rows.map((r) =>
    classifyNewsOutcome({
      category: r.category,
      fetched: Number(r.fetched),
      dropped: Number(r.dropped),
      dropReasons: r.drop_reasons ?? {},
    }),
  );

  const stuck = await db.query<{ n: string }>(
    `select count(*)::text as n from generation_jobs gj
       join x_accounts xa on xa.id = gj.x_account_id
      where xa.user_id = $1 and gj.status = 'running'
        and coalesce(gj.locked_at, gj.started_at) < now() - interval '30 minutes'`,
    [userId],
  );

  const emails = await db.query<{ queued: string; failed: string }>(
    `select count(*) filter (where email_status = 'queued')::text as queued,
            count(*) filter (where email_status = 'failed')::text as failed
       from notifications where user_id = $1 and email_status in ('queued', 'failed')`,
    [userId],
  );

  const cost = await db.query<{ usd: string | null }>(
    `select sum(estimated_cost_usd)::text as usd from external_api_usage_events
      where occurred_at >= date_trunc('month', now())
        and (user_id = $1 or user_id is null)`,
    [userId],
  );

  const dbSize = await db.query<{ bytes: string }>(
    `select pg_database_size(current_database())::text as bytes`,
  );

  return {
    date,
    dbBytes: Number(dbSize.rows[0]?.bytes ?? 0),
    dbLimitBytes: FREE_DB_SIZE_LIMIT_BYTES,
    jobs: {
      succeeded: Number(jobs.rows[0]?.succeeded ?? 0),
      failed: Number(jobs.rows[0]?.failed ?? 0),
    },
    zeroStreaks: zeroStreakByCategory(
      news.rows.map((r) => ({
        date: r.date,
        category: r.category,
        saved: Number(r.saved),
        dropped: Number(r.dropped),
      })),
    ),
    /**
     * **「取得窓より古いだけ」は除く**（T-M8-83）。
     *
     * 以前はSQLで拾った行をそのまま「全件破棄されたテーマ」として通知していたため、
     * その時間帯に新しい記事が無かっただけの日にも警告メールが飛んでいた。
     * doctor 側には T-M7-44 で良性判定が入っていたのに通知側には無く、**同じ状況を
     * doctorは「該当なし」、通知は「全件破棄」と正反対に伝えていた**。
     * 新しい記事が無い日は普通にあるので、この誤報は繰り返し届き、
     * 「直せない理由で赤くすると本物の異常が隠れる」という当の判断を通知側が壊していた。
     * 判定は `lib/news-outcome.ts` の1つだけを使う。
     */
    allDropped: latestVerdicts
      .filter((v) => v.kind === "all_dropped")
      .map((v) => ({ category: v.category, reasons: v.reasons })),
    mostlyDropped: latestVerdicts
      .filter((v) => v.kind === "mostly_dropped")
      .map((v) => ({
        category: v.category,
        fetched: v.fetched,
        dropped: v.dropped,
        ages: v.ages,
      })),
    stuckJobs: Number(stuck.rows[0]?.n ?? 0),
    queuedEmails: Number(emails.rows[0]?.queued ?? 0),
    failedEmails: Number(emails.rows[0]?.failed ?? 0),
    monthUsd: Number(cost.rows[0]?.usd ?? 0),
  };
}

/** サマリを届ける時刻（JSTの時）。この時刻以降のtickで、その日の分を1回だけ作る。 */
export const SUMMARY_HOUR_JST = 8;

export interface DeliverDailySummaryResult {
  /** 作成した通知の件数（既に作ってあれば0）。 */
  created: number;
  /** 作成した通知のid（即時メール送信の対象）。 */
  createdIds: string[];
}

/**
 * 対象ユーザーへ日次サマリを1通だけ作る（`scheduler_tick` から呼ぶ）。
 *
 * 冪等性は `notifications.dedupe_key = 'summary:{JSTの日付}'` の unique 制約で担保する
 * （5分ごとのtickから何度呼ばれても1日1通）。JST {@link SUMMARY_HOUR_JST} 時より前は作らない。
 * 通知設定（`summary`）で in_app/email をどちらもOFFにしている利用者には作らない。
 */
export async function deliverDailySummaries(
  db: Queryable,
  nowIso: string,
  options: {
    /** 対象を絞る（テスト用。本番は未指定＝全利用者）。 */
    userIds?: string[];
    /** 1人分の作成に失敗したときの記録（既定は無視して次の利用者へ進む）。 */
    onError?: (userId: string, err: unknown) => void;
  } = {},
): Promise<DeliverDailySummaryResult> {
  const jstHour = new Date(new Date(nowIso).getTime() + JST_OFFSET_MS).getUTCHours();
  if (jstHour < SUMMARY_HOUR_JST) return { created: 0, createdIds: [] };
  const date = jstDateOf(nowIso);
  const dedupeKey = `summary:${date}`;

  // 対象: **Xアカウントを連携済みで**、サマリをどちらかのチャネルで受け取る設定の利用者。
  // 連携前の利用者はまだ運用が始まっていないので届けない（初日から不要な通知を出さない）。
  const { rows: users } = await db.query<{ id: string; in_app: boolean; email: boolean }>(
    `select p.id,
            coalesce((p.notification_config->'summary'->>'in_app')::boolean, true) as in_app,
            coalesce((p.notification_config->'summary'->>'email')::boolean, true) as email
       from profiles p
      where exists (select 1 from x_accounts xa where xa.user_id = p.id)
        and ($1::uuid[] is null or p.id = any($1::uuid[]))
        and (coalesce((p.notification_config->'summary'->>'in_app')::boolean, true)
             or coalesce((p.notification_config->'summary'->>'email')::boolean, true))`,
    [options.userIds ?? null],
  );

  const createdIds: string[] = [];
  for (const user of users) {
    // 1人分が失敗しても他の利用者のまとめは作る（1件の不整合で全員分が止まらないように）。
    try {
      const already = await db.query(
        `select 1 from notifications where user_id = $1 and dedupe_key = $2 limit 1`,
        [user.id, dedupeKey],
      );
      if ((already.rowCount ?? 0) > 0) continue;

      const summary = buildDailySummary(await collectDailySummary(db, user.id, nowIso));
      // 利用者が消えていたら何もしない（`select from profiles` で存在を条件にする）。
      // 集めてから作るまでの間に退会・削除が起きても、FK違反を「異常」として報告しない。
      // `for key share of p` まで要る理由は `jobs/news-digest.ts` と同じ（T-M8-19）。存在確認と
      // 外部キー検査は同じ文の中でも別のスナップショットを見るため、親行を先にロックしないと
      // 「確認した直後に退会がコミットされる」競合が残り、**1人の退会で残り全員の配信が止まる**。
      // 仕組みの回帰テストは `jobs/news-digest.db.test.ts`（同じSQL形なのでここでは重複させない）。
      const { rows } = await db.query<{ id: string }>(
        `insert into notifications
           (user_id, type, dedupe_key, title, body, link, payload,
            in_app_enabled, email_status, email_available_at)
         select p.id, 'summary', $2, $3, $4, '/app', jsonb_build_object('date', $5::text),
                $6, case when $7 then 'queued'::email_delivery_status
                         else 'not_requested'::email_delivery_status end,
                case when $7 then now() else null end
           from profiles p where p.id = $1 for key share of p
         on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing
         returning id`,
        [user.id, dedupeKey, summary.title, summary.body, date, user.in_app, user.email],
      );
      if (rows[0]) createdIds.push(rows[0].id);
    } catch (err) {
      options.onError?.(user.id, err);
    }
  }
  return { created: createdIds.length, createdIds };
}
