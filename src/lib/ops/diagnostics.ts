import "server-only";

import type { Queryable } from "../x/token-refresh";

import { judgeCaptcha, probeCaptcha, type CaptchaProbeDeps } from "./captcha-status";
import { judgePortal, probePortalFeatures, type PortalProbeDeps } from "./portal-status";

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
          empty.failed.length > 0 ? `取得に失敗したテーマ: ${empty.failed.join("・")}` : null,
          empty.allDropped.length > 0
            ? `全件破棄されたテーマ: ${empty.allDropped.map((a) => `${a.category}（${a.reasons}）`).join("・")}`
            : null,
        ]
          .filter(Boolean)
          .join(" / ")
      : null;
  const noMatchNote =
    empty.noMatch.length > 0 ? `該当ニュースが無かったテーマ: ${empty.noMatch.join("・")}` : null;
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
          "Claudeに「全件破棄されたテーマの除外理由を調べて」と伝えてください（プロンプトか検証条件の問題です）",
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
        "Claudeに「全件破棄されたテーマの除外理由を調べて」と伝えてください（プロンプトか検証条件の問題です）",
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

/**
 * お知らせメールの状態。
 *
 * **`failed` を数える**（T-M8-40）。以前は `queued` だけを見て `queued === 0` を「ok」としていた。
 * `failed` は終端状態（401/403 または3回失敗で確定）なので、**SMTP認証が間違っていて通知メールが
 * 全滅している状態は `queued = 0` になり、`doctor` が ✅ を出す**。
 * CLAUDE.md 原則1「正常な空と失敗による空を別の値で表す」に正面から反していた。
 */
export function judgeQueuedEmails(input: {
  queued: number;
  oldestHours: number | null;
  failed: number;
}): Check {
  const name = "お知らせメール";
  // 失敗は自動では回収されない（`recoverQueuedEmails` は queued だけを拾う）。
  // 放置すると届かないままなので、送信待ちより先に扱う。
  if (input.failed > 0) {
    return {
      name,
      level: "error",
      detail: `送れなかったメールが ${input.failed} 件あります（送信待ちは ${input.queued} 件）`,
      nextAction:
        "メール設定（SMTP）が正しいか確認してください。直したら通知ベルの「メールを再送」で送り直せます",
    };
  }
  if (input.queued === 0) return { name, level: "ok", detail: "送信待ち・送信失敗はありません" };
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

/**
 * 無料プランのDBサイズ上限（バイト）。**プロジェクトではなく組織単位で効く**（要件01 §8・T-M7-43）。
 * Proへ上げた場合は `SUPABASE_DB_SIZE_LIMIT_MB` で上書きする。
 */
export const FREE_DB_SIZE_LIMIT_BYTES = 500 * 1024 * 1024;

/** 警告に変える割合。ここを超えたら「まだ動くが手を打つ時期」。 */
export const DB_SIZE_WARN_RATIO = 0.8;
/** 異常に変える割合。超過すると**組織内の全プロジェクトが停止**するため、手前で赤くする。 */
export const DB_SIZE_ERROR_RATIO = 0.95;

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

/**
 * データベースの使用量（T-M7-43）。原則1・4。
 *
 * 2026-08-01、Supabaseの組織が容量超過で停止し、**組織内の全プロジェクトが402になった**。
 * 停止すると使用量が0と表示されて原因の特定すらできない。**止まる前に気付ける**ようにする。
 */
export function judgeDatabaseSize(input: { bytes: number; limitBytes: number }): Check {
  const name = "データベースの使用量";
  const ratio = input.limitBytes > 0 ? input.bytes / input.limitBytes : 0;
  const detail = `${formatBytes(input.bytes)} / ${formatBytes(input.limitBytes)}（${Math.round(ratio * 100)}%）`;
  if (ratio >= DB_SIZE_ERROR_RATIO) {
    return {
      name,
      level: "error",
      detail,
      nextAction:
        "上限を超えると同じ組織のプロジェクトがすべて停止します。古いデータの削除かプランの見直しをしてください",
    };
  }
  if (ratio >= DB_SIZE_WARN_RATIO) {
    return {
      name,
      level: "warn",
      detail,
      nextAction: "上限に近づいています。Claudeに「大きいテーブルを調べて」と伝えてください",
    };
  }
  return { name, level: "ok", detail };
}

// --- 収集（実DBを叩く。routeとscriptの両方から使う） ---

export interface DiagnosticsOptions {
  /** 定時実行が動く前提の環境か（本番のみ true）。ローカルで常に赤くしないための切り替え。 */
  schedulerExpected: boolean;
  /** DBサイズの上限（バイト）。未指定なら無料プランの500MB。 */
  dbSizeLimitBytes?: number;
  /** 人間確認の確認に使う接続情報（T-M7-53）。未指定なら「判定できません」になる。 */
  captcha?: CaptchaProbeDeps;
  /** プラン管理（Stripe Portal）の設定確認（T-M8-32）。未指定なら「判定できません」になる。 */
  portal?: PortalProbeDeps;
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

  const emails = await db.query<{ queued: string; oldest: string | null; failed: string }>(
    `select count(*) filter (where email_status = 'queued')::text as queued,
            (extract(epoch from (now() - min(created_at)
                                 filter (where email_status = 'queued'))) / 3600)::text as oldest,
            count(*) filter (where email_status = 'failed')::text as failed
       from notifications where email_status in ('queued', 'failed')`,
  );
  checks.push(
    judgeQueuedEmails({
      queued: Number(emails.rows[0]?.queued ?? 0),
      oldestHours: emails.rows[0]?.oldest == null ? null : Number(emails.rows[0].oldest),
      failed: Number(emails.rows[0]?.failed ?? 0),
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

  // データベースの使用量（T-M7-43）。上限は無料プラン既定で、Proなら env で上書きする。
  const size = await db.query<{ bytes: string }>(
    `select pg_database_size(current_database())::text as bytes`,
  );
  checks.push(
    judgeDatabaseSize({
      bytes: Number(size.rows[0]?.bytes ?? 0),
      limitBytes: options.dbSizeLimitBytes ?? FREE_DB_SIZE_LIMIT_BYTES,
    }),
  );

  // 人間確認が実際に効いているか（T-M7-53）。**ダッシュボードのトグル1つに依存していて
  // コードからは見えない**ため、状態確認で毎回見る。副作用は無い（存在しない資格情報で試すだけ）。
  checks.push(judgeCaptcha(await probeCaptcha(options.captcha ?? {})));

  // プラン管理の操作がStripe側で有効か（T-M8-32）。**相手側の設定はコードに現れない**ため、
  // ボタンを押して初めて分かる状態にしない。読み取りのみで費用は無い。
  checks.push(judgePortal(await probePortalFeatures(options.portal ?? {})));

  return {
    level: worstLevel(checks.map((c) => c.level)),
    checks,
    summary: summarize(checks),
  };
}
