import "server-only";
import {
  classifyProviderFailure,
  providerFailureGuide,
  type ProviderFailureKind,
} from "@/lib/ai/provider-failure";

import { classifyNewsOutcome } from "@/lib/news-outcome";

import type { Queryable } from "../x/token-refresh";

import { judgeCaptcha, probeCaptcha, type CaptchaProbeDeps } from "./captcha-status";
import {
  approxYen,
  type Check,
  FAILED_EMAIL_WINDOW_DAYS,
  type Level,
  summarize,
  worstLevel,
} from "./check";
import { type ConfigFacts, judgeConfig, judgePendingConfirmations } from "./config-status";
import { judgePortal, probePortalFeatures, type PortalProbeDeps } from "./portal-status";
import { judgePrices, probePrices, type PriceProbeDeps } from "./price-status";
import {
  judgeStripeAccount,
  probeStripeAccount,
  type StripeAccountProbeDeps,
} from "./stripe-account-status";

// 型と全体まとめは `check.ts` が正本（`scripts/doctor.mjs` も同じものを読む・R31）。
export { approxYen, FAILED_EMAIL_WINDOW_DAYS, summarize, worstLevel };
export type { Check, Level };

/**
 * 運営者向けの状態診断（T-M7-34）。
 *
 * `CLAUDE.md`「前提：運営者は個人」の原則2・4に対応する。**運営者にログを読ませない**ことが目的で、
 * 「いま何が壊れているか」と「次に何をすればよいか」だけを日本語で返す。
 *
 * 内部用語（`service_role`・`checkpoint`・`queued` 等）は出さない。判定と文言はここに集約し、
 * ローカル（`npm run doctor`）とデプロイ先（`GET /api/cron/doctor`）で同じものを使う。
 */

export interface DiagnosticsReport {
  level: Level;
  checks: Check[];
  /** 運営者向けの1行まとめ。 */
  summary: string;
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
  /** 失敗の種別（`http_429` 等）。**応答本文は持たない**（T-M8-86）。 */
  errorCode?: string | null;
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
  /** 失敗した分野と、その種別（応答本文は持たない・T-M8-86）。 */
  failed: {
    category: string;
    errorCode: string | null;
    failureKind: ProviderFailureKind | null;
  }[];
  allDropped: { category: string; reasons: string }[];
  noMatch: string[];
  /**
   * 取得できてはいるが**大半が落ちている**分野（T-M8-83）。
   *
   * 以前は `fetched > 0` の分野を素通りしていたため、**日に30件から3件へ静かに減っても
   * 運営者は気付けなかった**（CLAUDE.md 原則1）。0件ではないので「対応が必要」ではなく
   * 注意として出す。古さの範囲を添えて、窓を広げれば入るのかを判断できるようにする。
   */
  mostlyDropped: { category: string; fetched: number; dropped: number; ages: string | null }[];
} {
  const failed: {
    category: string;
    errorCode: string | null;
    failureKind: ProviderFailureKind | null;
  }[] = [];
  const allDropped: { category: string; reasons: string }[] = [];
  const noMatch: string[] = [];
  const mostly: {
    category: string;
    fetched: number;
    dropped: number;
    ages: string | null;
  }[] = [];
  // 分類そのものは `lib/news-outcome.ts` の1つだけを使う（以前はここと通知側が
  // 別々に書いていて、同じ状況を「該当なし」と「全件破棄」に分けて伝えていた・R25）。
  for (const o of outcomes) {
    const verdict = classifyNewsOutcome(o);
    switch (verdict.kind) {
      case "failed":
        failed.push({
          category: verdict.category,
          errorCode: verdict.errorCode,
          failureKind: verdict.failureKind,
        });
        break;
      case "mostly_dropped":
        mostly.push({
          category: verdict.category,
          fetched: verdict.fetched,
          dropped: verdict.dropped,
          ages: verdict.ages,
        });
        break;
      case "all_dropped":
        allDropped.push({ category: verdict.category, reasons: verdict.reasons });
        break;
      case "no_match":
        noMatch.push(verdict.category);
        break;
      case "healthy":
        break;
    }
  }
  return { failed, allDropped, noMatch, mostlyDropped: mostly };
}

/**
 * 失敗した分野の型から次の一手を決める（T-M8-163）。
 *
 * **全分野が同じ型なら、その操作を断定して出す。** 混ざっているときは決めつけず記録を見る案内へ戻す
 * ——違う原因に同じ操作を勧めると、運営者はその案内を信じなくなる。
 */
function newsFailureNextAction(
  failed: { failureKind: ProviderFailureKind | null }[],
): string {
  const kinds = new Set(
    failed.map((f) => f.failureKind).filter((k): k is ProviderFailureKind => k != null),
  );
  kinds.delete("unknown");
  if (kinds.size === 1) {
    const [only] = [...kinds];
    return providerFailureGuide(only).nextAction;
  }
  return providerFailureGuide("unknown").nextAction;
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
          empty.failed.length > 0
            ? `取得に失敗したテーマ: ${empty.failed
                .map((f) => {
                  // **`http_400` だけを見せない**（T-M8-163）。運営者が直せる言い方にする。
                  const kind = f.failureKind && f.failureKind !== "unknown"
                    ? providerFailureGuide(f.failureKind).label
                    : f.errorCode;
                  return kind ? `${f.category}（${kind}）` : f.category;
                })
                .join("・")}`
            : null,
          empty.allDropped.length > 0
            ? `全件破棄されたテーマ: ${empty.allDropped.map((a) => `${a.category}（${a.reasons}）`).join("・")}`
            : null,
        ]
          .filter(Boolean)
          .join(" / ")
      : null;
  const noMatchNote =
    empty.noMatch.length > 0 ? `該当ニュースが無かったテーマ: ${empty.noMatch.join("・")}` : null;
  /**
   * 取得できてはいるが大半が落ちている分野（T-M8-83）。**注意までに留める**。
   * 「窓より古いだけ」は運営者に直せないので、赤くすると読まれなくなる（T-M7-44と同じ理由）。
   * ただし黙って減っていくのは原則1に反するので、古さの範囲を添えて必ず1行出す。
   */
  const mostlyNote =
    empty.mostlyDropped.length > 0
      ? `取れた数より捨てた数が多いテーマ: ${empty.mostlyDropped
          .map(
            (m) =>
              `${m.category}（${m.fetched}件取得 / ${m.dropped}件除外${m.ages ? `・${m.ages}の記事` : ""}）`,
          )
          .join("・")}`
      : null;
  if (!input.schedulerExpected) {
    const last =
      input.hoursSinceLastRun === null
        ? "まだ一度も実行されていません"
        : `最後の実行は ${Math.round(input.hoursSinceLastRun)} 時間前`;
    const detail = [
      `${last}（この環境では定時実行が自動で動きません。直近48時間の取得は ${input.itemsLast48h} 件）`,
      problem,
      noMatchNote,
      mostlyNote,
    ]
      .filter(Boolean)
      .join(" / ");
    // 定時実行が動かない環境でも、**全件破棄は不具合**なので注意として上げる（常に赤くはしない）。
    if (problem) {
      return {
        name,
        level: "warn",
        detail,
        nextAction: newsFailureNextAction(empty.failed),
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
    mostlyNote,
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
      nextAction: newsFailureNextAction(empty.failed),
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
  /** 直近 `FAILED_EMAIL_WINDOW_DAYS` 日の失敗。 */
  failed: number;
  /** それより古い失敗（記録として出すだけで、赤くしない）。 */
  failedOlder?: number;
}): Check {
  const name = "お知らせメール";
  // 失敗は自動では回収されない（`recoverQueuedEmails` は queued だけを拾う）。
  // 放置すると届かないままなので、送信待ちより先に扱う。
  //
  // **ただし期間で区切る**（T-M8-51）。窓が無いと、1件失敗しただけで doctor が恒久的に赤・
  // 日次サマリに毎日出続け、**赤が常態化して他の異常が埋もれる**（原則1の逆効果）。
  // 古い失敗は「もう送る意味が薄い」ものでもあるので、記録として添えるだけにする。
  const older = input.failedOlder ?? 0;
  const olderNote = older > 0 ? `。${FAILED_EMAIL_WINDOW_DAYS}日より前の失敗が別に ${older} 件` : "";
  if (input.failed > 0) {
    return {
      name,
      level: "error",
      detail:
        `直近${FAILED_EMAIL_WINDOW_DAYS}日で送れなかったメールが ${input.failed} 件あります` +
        `（送信待ちは ${input.queued} 件）${olderNote}`,
      nextAction:
        "メール設定（SMTP）が正しいか確認してください。直したら通知ベルの「メールを再送」で送り直せます",
    };
  }
  if (older > 0 && input.queued === 0) {
    return {
      name,
      level: "warn",
      detail: `${FAILED_EMAIL_WINDOW_DAYS}日より前に送れなかったメールが ${older} 件あります（直近の失敗はありません）`,
      nextAction: "古い失敗なので急ぎではありません。送り直すなら通知ベルの「メールを再送」から行えます",
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

/**
 * 定時実行（`scheduler_tick`）が生きているか（T-M8-51）。
 *
 * `judgeQueuedEmails` と**同じ型の見落とし**が残っていた——止まっていても doctor はどこも赤く
 * ならない。tick が死ぬと予約投稿・通知メール送信・日次サマリ・期限切れ回収の**すべてが静かに
 * 止まる**（「実行はありません」は正常時と同じ表示になる）。5分間隔なので、15分以上音沙汰が
 * 無ければ異常。
 *
 * `schedulerExpected` が false の環境（ローカル・preview）では**そもそも動かないのが正しい**ので、
 * 赤くしない（`judgeNews` と同じ扱い）。
 */
export const SCHEDULER_STALE_MINUTES = 15;

export function judgeScheduler(input: {
  minutesSinceLastRun: number | null;
  schedulerExpected: boolean;
}): Check {
  const name = "定時実行";
  if (!input.schedulerExpected) {
    return {
      name,
      level: "ok",
      detail:
        input.minutesSinceLastRun === null
          ? "この環境では自動で動きません（手動で叩いたときだけ動きます）"
          : `この環境では自動で動きません（最後の実行は ${Math.round(input.minutesSinceLastRun)} 分前）`,
    };
  }
  if (input.minutesSinceLastRun === null) {
    return {
      name,
      level: "error",
      detail: "まだ一度も動いていません",
      nextAction:
        "予約投稿・通知メール・日次サマリがすべて止まります。Vercel Cron（またはlaunchd）の設定を確認してください",
    };
  }
  if (input.minutesSinceLastRun > SCHEDULER_STALE_MINUTES) {
    return {
      name,
      level: "error",
      detail: `最後の実行が ${Math.round(input.minutesSinceLastRun)} 分前です（5分間隔で動く想定）`,
      nextAction:
        "予約投稿・通知メール・日次サマリが止まっています。Vercel Cron（またはlaunchd）の設定と実行ログを確認してください",
    };
  }
  return { name, level: "ok", detail: `${Math.round(input.minutesSinceLastRun)} 分前に動いています` };
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
  const yen = approxYen(input.monthUsd);
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
 *
 * NOTE: 以前ここに「Proへ上げた場合は `SUPABASE_DB_SIZE_LIMIT_MB` で上書きする」と書いてあったが、
 * **その環境変数は repo に存在しない**（R30）。Pro移行時に env を設定して無反応になるだけの
 * 案内だったため削除した。env で上書きできるようにするのは機能追加なので別タスクで扱う。
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
  /** 人間確認の確認に使う接続情報（T-M7-53）。未指定なら「判定できません」になる。 */
  captcha?: CaptchaProbeDeps;
  /** プラン管理（Stripe Portal）の設定確認（T-M8-32）。未指定なら「判定できません」になる。 */
  portal?: PortalProbeDeps;
  /** 請求額と表示額の突き合わせ（T-M8-141）。鍵やPrice IDが無い環境では「判定できません」。 */
  prices?: PriceProbeDeps;
  /**
   * デプロイ先が実際に使っている設定（T-M8-147）。**秘密値は渡さない**（種別・有無だけ）。
   * 未指定なら設定の判定を行わない（ローカルの `doctor` から呼ぶ経路を壊さないため）。
   */
  config?: ConfigFacts;
  /** 確認メールの送信元アドレス（T-M8-147）。未確認の登録が送信元自身かを見分けるのに使う。 */
  mailSenderEmail?: string | null;
  /** Stripeアカウントが決済を受け付けられるか（T-M8-148）。鍵が無ければ判定しない。 */
  stripeAccount?: StripeAccountProbeDeps;
}

export async function collectDiagnostics(
  db: Queryable,
  options: DiagnosticsOptions,
): Promise<DiagnosticsReport> {
  const checks: Check[] = [];

  /*
    **設定が本番へ反映されているか**（T-M8-147）を最初に出す。必須の環境変数は起動時検証が
    落とすが、**既定値を持つものは欠けても起動する**ため、画面が全部正常に見えたまま
    機能だけが止まる。2026-08-18、本番が `dry_run` のままでXへ1件も投稿していなかった
    （テスト・release:check・doctor はいずれも env を見ていなかった）。
  */
  if (options.config) checks.push(...judgeConfig(options.config));

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

  const tick = await db.query<{ minutes: string | null }>(
    `select (extract(epoch from (now() - max(claimed_at))) / 60)::text as minutes
       from cron_runs where job_name = 'scheduler_tick'`,
  );
  checks.push(
    judgeScheduler({
      minutesSinceLastRun:
        tick.rows[0]?.minutes == null ? null : Number(tick.rows[0].minutes),
      schedulerExpected: options.schedulerExpected,
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
    error_code: string | null;
    provider_raw_error: string | null;
  }>(
    /*
      **`provider_raw_error` は分類にだけ使い、応答へ載せない**（T-M8-86 / T-M8-163）。

      以前はここで select しない方針だった（doctorはHTTPでも返るため、本文をクエリの段階で
      取らないという防ぎ方）。しかしそのために `http_400` しか出せず、**運営者が原因へ辿れなかった**
      ——2026-08-20 の本番はAnthropicのクレジット切れで、運営者が5分で直せるものだったのに
      「Claudeに聞いてください」と案内していた（原則2違反）。

      そこで**取ってすぐ型へ落とし、生文字列はこのスコープから外へ出さない**形に変えた。
      「外へ出ない」ことは `diagnostics.news.test.ts` が応答オブジェクトを走査して固定する。
    */
    `select category::text as category, ok, fetched, dropped, drop_reasons, error_code,
            provider_raw_error
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
        errorCode: r.error_code,
        // ここで型へ落とし、生文字列は捨てる（この先へ渡さない）。
        failureKind: r.ok
          ? null
          : classifyProviderFailure(r.error_code, r.provider_raw_error),
      })),
    }),
  );

  const emails = await db.query<{
    queued: string;
    oldest: string | null;
    failed: string;
    failed_older: string;
  }>(
    `select count(*) filter (where email_status = 'queued')::text as queued,
            (extract(epoch from (now() - min(created_at)
                                 filter (where email_status = 'queued'))) / 3600)::text as oldest,
            count(*) filter (
              where email_status = 'failed'
                and coalesce(email_last_attempt_at, created_at) > now() - ($1 || ' days')::interval
            )::text as failed,
            count(*) filter (
              where email_status = 'failed'
                and coalesce(email_last_attempt_at, created_at) <= now() - ($1 || ' days')::interval
            )::text as failed_older
       from notifications where email_status in ('queued', 'failed')`,
    [String(FAILED_EMAIL_WINDOW_DAYS)],
  );
  checks.push(
    judgeQueuedEmails({
      queued: Number(emails.rows[0]?.queued ?? 0),
      oldestHours: emails.rows[0]?.oldest == null ? null : Number(emails.rows[0].oldest),
      failed: Number(emails.rows[0]?.failed ?? 0),
      failedOlder: Number(emails.rows[0]?.failed_older ?? 0),
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

  /*
    **メール確認が終わっていない登録**（T-M8-147）。件数だけなら異常ではないが、
    「送信元と同じアドレスで登録した」ケースだけは**どこにも記録が出ない**まま
    「メールが届かない」に見えるため、ここで名指しする（`config-status.ts` のコメント参照）。
    直近7日に絞る（古い放置分で常に黄色くしない）。
  */
  const pending = await db.query<{ email: string }>(
    `select email from auth.users
      where email_confirmed_at is null
        and email is not null
        and created_at > now() - interval '7 days'
      order by created_at desc limit 50`,
  );
  checks.push(
    judgePendingConfirmations({
      senderEmail: options.mailSenderEmail ?? null,
      unconfirmedEmails: pending.rows.map((r) => r.email),
    }),
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
      limitBytes: FREE_DB_SIZE_LIMIT_BYTES,
    }),
  );

  // 人間確認が実際に効いているか（T-M7-53）。**ダッシュボードのトグル1つに依存していて
  // コードからは見えない**ため、状態確認で毎回見る。副作用は無い（存在しない資格情報で試すだけ）。
  checks.push(judgeCaptcha(await probeCaptcha(options.captcha ?? {})));

  // プラン管理の操作がStripe側で有効か（T-M8-32）。**相手側の設定はコードに現れない**ため、
  // ボタンを押して初めて分かる状態にしない。読み取りのみで費用は無い。
  checks.push(judgePortal(await probePortalFeatures(options.portal ?? {})));

  /*
    **請求額と表示額が一致しているか**（T-M8-141）。`plans.ts` は「Stripe Price と必ず一致させる
    （constants.test.ts が突き合わせる）」と書いていたが、そのテストは定数とリテラルを比べるだけで
    Stripeを見ていなかった。ズレると「画面は1,000円と言うのに2,000円請求される」という、
    利用者の申告でしか気付けない事故になる（原則4）。読み取りのみで費用は無い。
  */
  checks.push(judgePrices(await probePrices(options.prices ?? {})));

  /*
    **Stripeアカウントが実際に決済を受け付けられるか**（T-M8-148）。2026-08-18、本番で
    「7日間無料で利用」が必ず失敗した。原因はアカウントの本番有効化が未完了だったこと
    （`Your account cannot currently make live charges.`）。鍵は本番・Priceの金額も一致・
    ポータルも有効だったので、**既存の検査はすべて緑のまま押した人だけが行き止まりになった**。
    読み取りのみで費用は無い。
  */
  checks.push(judgeStripeAccount(await probeStripeAccount(options.stripeAccount ?? {})));

  return {
    level: worstLevel(checks.map((c) => c.level)),
    checks,
    summary: summarize(checks),
  };
}
