import "server-only";

import type { Queryable } from "../x/token-refresh";

/**
 * 運営者向けの状態診断（T-M7-34）。
 *
 * `CLAUDE.md`「前提：運営者は個人」の原則2・4に対応する。**運営者にログを読ませない**ことが目的で、
 * 「いま何が壊れているか」と「次に何をすればよいか」だけを日本語で返す。
 *
 * 内部用語（`service_role`・`checkpoint`・`queued` 等）は出さない。判定と文言はここに集約し、
 * ローカル（`npm run doctor`）とデプロイ先（`GET /api/cron/doctor`）で同じものを使う。
 */

export type Level = "ok" | "warn" | "error";

export interface Check {
  /** 運営者が読む見出し。 */
  name: string;
  level: Level;
  /** いまの状態。数字は必ず入れる（「問題なし」だけにしない）。 */
  detail: string;
  /** 異常時に次にやること。1行で、コマンドか画面操作を具体的に書く。 */
  nextAction?: string;
}

export interface DiagnosticsReport {
  level: Level;
  checks: Check[];
  /** 運営者向けの1行まとめ。 */
  summary: string;
}

/** 最も重いレベルを返す（error > warn > ok）。 */
export function worstLevel(levels: Level[]): Level {
  if (levels.includes("error")) return "error";
  if (levels.includes("warn")) return "warn";
  return "ok";
}

/** 全体の1行まとめ。件数を必ず出す（「問題なし」だけで終わらせない）。 */
export function summarize(checks: Check[]): string {
  const errors = checks.filter((c) => c.level === "error").length;
  const warns = checks.filter((c) => c.level === "warn").length;
  if (errors > 0) return `対応が必要な問題が ${errors} 件あります（注意 ${warns} 件）`;
  if (warns > 0) return `すぐ困る問題はありませんが、注意が ${warns} 件あります`;
  return `${checks.length} 項目すべて正常です`;
}

// --- 個別の判定（純粋関数。単体テストで固定する） ---

/**
 * 直近の生成・投稿の成否。
 * 失敗が半分を超えたら異常。1件でも失敗していれば注意（黙って流さない）。
 */
export function judgeJobs(input: { succeeded: number; failed: number }): Check {
  const total = input.succeeded + input.failed;
  if (total === 0) {
    return {
      name: "生成・投稿の動作",
      level: "ok",
      detail: "直近24時間の実行はありません",
    };
  }
  const detail = `直近24時間で 成功 ${input.succeeded} 件 / 失敗 ${input.failed} 件`;
  if (input.failed === 0) return { name: "生成・投稿の動作", level: "ok", detail };
  if (input.failed > input.succeeded) {
    return {
      name: "生成・投稿の動作",
      level: "error",
      detail,
      nextAction: "失敗が成功より多いです。Claudeに「直近の失敗した生成の原因を調べて」と伝えてください",
    };
  }
  return {
    name: "生成・投稿の動作",
    level: "warn",
    detail,
    nextAction: "Claudeに「直近の失敗した生成の原因を調べて」と伝えると原因が分かります",
  };
}

/**
 * ニュース取得が動いているか。
 *
 * **0件そのものは異常ではない**が、長時間まったく取れていないのは異常（T-M7-24 の再発検知）。
 * ただし**定時実行は本番でしか動かない**ため、それ以外の環境で「止まっている」と赤くしない。
 * 常に赤いチェックは読まれなくなり、本物の異常を隠すため（`check:providers` のGoogleと同じ判断）。
 */
export interface NewsCategoryOutcome {
  category: string;
  /** 分野の処理が例外で終わらなかったか。 */
  ok: boolean;
  fetched: number;
  dropped: number;
  dropReasons: Record<string, number>;
}

/**
 * 0件だった分野を運営者の言葉にする（T-M7-40）。
 *
 * **「該当なし」と「全件破棄」は別物**。前者は正常、後者はプロンプトか検証条件の不具合で、
 * 放置すると分野が永久に0件のまま気付けない（2026-07-28 の web3 がこれだった）。
 */
export function describeEmptyCategories(outcomes: NewsCategoryOutcome[]): {
  failed: string[];
  allDropped: { category: string; reasons: string }[];
  noMatch: string[];
} {
  const failed: string[] = [];
  const allDropped: { category: string; reasons: string }[] = [];
  const noMatch: string[] = [];
  for (const o of outcomes) {
    if (!o.ok) {
      failed.push(o.category);
      continue;
    }
    if (o.fetched > 0) continue;
    if (o.dropped > 0) {
      // 「取得窓より古い」だけなら該当なしと同じ（その時間帯に新しい記事が無かっただけで、
      // 運営者に直せるものは無い）。直せない理由で警告を出すと読まれなくなる（T-M7-44）。
      const keys = Object.keys(o.dropReasons);
      if (keys.length > 0 && keys.every((k) => k === "published_at:too_old")) {
        noMatch.push(o.category);
        continue;
      }
      const reasons = Object.entries(o.dropReasons)
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `${k}×${n}`)
        .join(", ");
      allDropped.push({ category: o.category, reasons: reasons || `${o.dropped}件` });
    } else {
      noMatch.push(o.category);
    }
  }
  return { failed, allDropped, noMatch };
}

export function judgeNews(input: {
  itemsLast48h: number;
  hoursSinceLastRun: number | null;
  /** この環境で定時実行が動く前提か（本番のみ true）。 */
  schedulerExpected: boolean;
  /** 直近1回の分野ごとの結果（無ければ空）。0件の意味を説明するために使う。 */
  outcomes?: NewsCategoryOutcome[];
}): Check {
  const name = "ニュースの取得";
  const empty = describeEmptyCategories(input.outcomes ?? []);
  // 直近1回で全件破棄・失敗した分野があれば、取得件数の多少に関わらず必ず伝える。
  const problem =
    empty.failed.length > 0 || empty.allDropped.length > 0
      ? [
          empty.failed.length > 0 ? `取得に失敗した分野: ${empty.failed.join("・")}` : null,
          empty.allDropped.length > 0
            ? `全件破棄された分野: ${empty.allDropped.map((a) => `${a.category}（${a.reasons}）`).join("・")}`
            : null,
        ]
          .filter(Boolean)
          .join(" / ")
      : null;
  const noMatchNote =
    empty.noMatch.length > 0 ? `該当ニュースが無かった分野: ${empty.noMatch.join("・")}` : null;
  if (!input.schedulerExpected) {
    const last =
      input.hoursSinceLastRun === null
        ? "まだ一度も実行されていません"
        : `最後の実行は ${Math.round(input.hoursSinceLastRun)} 時間前`;
    const detail = [
      `${last}（この環境では定時実行が自動で動きません。直近48時間の取得は ${input.itemsLast48h} 件）`,
      problem,
      noMatchNote,
    ]
      .filter(Boolean)
      .join(" / ");
    // 定時実行が動かない環境でも、**全件破棄は不具合**なので注意として上げる（常に赤くはしない）。
    if (problem) {
      return {
        name,
        level: "warn",
        detail,
        nextAction:
          "Claudeに「全件破棄された分野の除外理由を調べて」と伝えてください（プロンプトか検証条件の問題です）",
      };
    }
    return {
      name,
      level: "ok",
      detail,
      nextAction:
        "動作を確かめたいときは Claude に「ニュース取得を1回実行して」と伝えてください",
    };
  }
  if (input.hoursSinceLastRun === null) {
    return {
      name,
      level: "error",
      detail: "まだ一度も実行されていません",
      nextAction: "定時実行の設定が済んでいるか確認してください",
    };
  }
  const detail = [
    `直近48時間で ${input.itemsLast48h} 件取得（最後の実行は ${Math.round(input.hoursSinceLastRun)} 時間前）`,
    problem,
    noMatchNote,
  ]
    .filter(Boolean)
    .join(" / ");
  if (input.hoursSinceLastRun > 6) {
    return {
      name,
      level: "error",
      detail,
      nextAction: "6時間以上実行されていません。定時実行が止まっている可能性があります",
    };
  }
  if (problem) {
    // 全件破棄・分野失敗は「0件」と同じに見えるが原因が違う。件数に関わらず必ず上げる。
    return {
      name,
      level: input.itemsLast48h === 0 ? "error" : "warn",
      detail,
      nextAction:
        "Claudeに「全件破棄された分野の除外理由を調べて」と伝えてください（プロンプトか検証条件の問題です）",
    };
  }
  if (input.itemsLast48h === 0) {
    return {
      name,
      level: "warn",
      detail,
      nextAction: "実行はされていますが1件も取れていません。Claudeに「ニュースが0件の理由を調べて」と伝えてください",
    };
  }
  return { name, level: "ok", detail };
}

/** 送られずに溜まっているお知らせメール。 */
export function judgeQueuedEmails(input: { queued: number; oldestHours: number | null }): Check {
  const name = "お知らせメール";
  if (input.queued === 0) return { name, level: "ok", detail: "送信待ちはありません" };
  const detail = `送信待ちが ${input.queued} 件（最も古いものは ${Math.round(input.oldestHours ?? 0)} 時間前）`;
  if ((input.oldestHours ?? 0) > 24) {
    return {
      name,
      level: "warn",
      detail,
      nextAction: "本番で初めて動いたときに一斉送信されます。Claudeに「古いお知らせメールを掃除して」と伝えてください",
    };
  }
  return { name, level: "ok", detail };
}

/** X（Twitter）連携の有効期限。 */
export function judgeXAccounts(
  rows: { handle: string; status: string; expiresInHours: number | null }[],
): Check {
  const name = "Xアカウントの連携";
  if (rows.length === 0) {
    return {
      name,
      level: "warn",
      detail: "連携されたアカウントがありません",
      nextAction: "設定画面から「Xアカウントを追加」で連携してください",
    };
  }
  const broken = rows.filter((r) => r.status !== "active");
  const expired = rows.filter((r) => r.status === "active" && (r.expiresInHours ?? 1) <= 0);
  const detail = rows
    .map((r) => `@${r.handle}（${r.status === "active" ? "有効" : "要再連携"}）`)
    .join(" / ");
  if (broken.length > 0) {
    return {
      name,
      level: "error",
      detail,
      nextAction: "設定画面のXアカウントから再連携してください",
    };
  }
  if (expired.length > 0) {
    return {
      name,
      level: "warn",
      detail: `${detail}（アクセス許可の期限が切れています。次の操作で自動更新されます）`,
    };
  }
  return { name, level: "ok", detail };
}

/** 途中で止まったまま動いていない処理。 */
export function judgeStuckJobs(input: { stuck: number }): Check {
  const name = "止まっている処理";
  if (input.stuck === 0) return { name, level: "ok", detail: "ありません" };
  return {
    name,
    level: "error",
    detail: `${input.stuck} 件が30分以上「実行中」のままです`,
    nextAction: "Claudeに「止まっている処理を調べて」と伝えてください",
  };
}

/** 当月の従量課金（AI・X API）の実績。原則4の可視化。 */
export function judgeCost(input: { monthUsd: number; byProvider: { provider: string; usd: number }[] }): Check {
  const name = "今月かかった費用";
  const yen = Math.round(input.monthUsd * 150);
  const breakdown = input.byProvider
    .filter((p) => p.usd > 0)
    .map((p) => `${p.provider} $${p.usd.toFixed(2)}`)
    .join(" / ");
  const detail = `$${input.monthUsd.toFixed(2)}（約${yen}円）${breakdown ? ` — ${breakdown}` : ""}`;
  // 上限は未設定。異常判定はせず、数字を必ず見せる（見えないことが問題なので）。
  return { name, level: "ok", detail };
}

// --- 収集（実DBを叩く。routeとscriptの両方から使う） ---

export interface DiagnosticsOptions {
  /** 定時実行が動く前提の環境か（本番のみ true）。ローカルで常に赤くしないための切り替え。 */
  schedulerExpected: boolean;
}

export async function collectDiagnostics(
  db: Queryable,
  options: DiagnosticsOptions,
): Promise<DiagnosticsReport> {
  const checks: Check[] = [];

  const jobs = await db.query<{ succeeded: string; failed: string }>(
    `select count(*) filter (where status = 'succeeded')::text as succeeded,
            count(*) filter (where status = 'failed')::text as failed
       from generation_jobs
      where created_at > now() - interval '24 hours'`,
  );
  checks.push(
    judgeJobs({
      succeeded: Number(jobs.rows[0]?.succeeded ?? 0),
      failed: Number(jobs.rows[0]?.failed ?? 0),
    }),
  );

  const news = await db.query<{ items: string; hours: string | null }>(
    `select (select count(*)::text from news_items where fetched_at > now() - interval '48 hours') as items,
            (select (extract(epoch from (now() - max(claimed_at))) / 3600)::text
               from cron_runs where job_name = 'news_fetch') as hours`,
  );
  // 直近1回の分野ごとの結果（T-M7-40）。0件が「該当なし」か「全件破棄」かをここで区別する。
  const outcomes = await db.query<{
    category: string;
    ok: boolean;
    fetched: number;
    dropped: number;
    drop_reasons: Record<string, number> | null;
  }>(
    `select category::text as category, ok, fetched, dropped, drop_reasons
       from news_fetch_outcomes
      where window_key = (select window_key from news_fetch_outcomes order by ran_at desc limit 1)`,
  );
  checks.push(
    judgeNews({
      itemsLast48h: Number(news.rows[0]?.items ?? 0),
      hoursSinceLastRun: news.rows[0]?.hours == null ? null : Number(news.rows[0].hours),
      schedulerExpected: options.schedulerExpected,
      outcomes: outcomes.rows.map((r) => ({
        category: r.category,
        ok: r.ok,
        fetched: Number(r.fetched),
        dropped: Number(r.dropped),
        dropReasons: r.drop_reasons ?? {},
      })),
    }),
  );

  const emails = await db.query<{ queued: string; oldest: string | null }>(
    `select count(*)::text as queued,
            (extract(epoch from (now() - min(created_at))) / 3600)::text as oldest
       from notifications where email_status = 'queued'`,
  );
  checks.push(
    judgeQueuedEmails({
      queued: Number(emails.rows[0]?.queued ?? 0),
      oldestHours: emails.rows[0]?.oldest == null ? null : Number(emails.rows[0].oldest),
    }),
  );

  const accounts = await db.query<{ handle: string; status: string; hours: string | null }>(
    `select handle, status::text as status,
            (extract(epoch from (token_expires_at - now())) / 3600)::text as hours
       from x_accounts order by created_at`,
  );
  checks.push(
    judgeXAccounts(
      accounts.rows.map((r) => ({
        handle: r.handle,
        status: r.status,
        expiresInHours: r.hours == null ? null : Number(r.hours),
      })),
    ),
  );

  const stuck = await db.query<{ n: string }>(
    `select count(*)::text as n from generation_jobs
      where status = 'running' and coalesce(locked_at, started_at) < now() - interval '30 minutes'`,
  );
  checks.push(judgeStuckJobs({ stuck: Number(stuck.rows[0]?.n ?? 0) }));

  const cost = await db.query<{ provider: string; usd: string }>(
    `select provider::text as provider, coalesce(sum(estimated_cost_usd), 0)::text as usd
       from external_api_usage_events
      where occurred_at >= date_trunc('month', now())
      group by provider order by 2 desc`,
  );
  const byProvider = cost.rows.map((r) => ({ provider: r.provider, usd: Number(r.usd) }));
  checks.push(
    judgeCost({
      monthUsd: byProvider.reduce((s, p) => s + p.usd, 0),
      byProvider,
    }),
  );

  return {
    level: worstLevel(checks.map((c) => c.level)),
    checks,
    summary: summarize(checks),
  };
}
