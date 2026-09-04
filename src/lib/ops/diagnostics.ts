import "server-only";
import {
  classifyProviderFailure,
  providerFailureGuide,
  type ProviderFailureKind,
} from "@/lib/ai/provider-failure";

import { classifyNewsOutcome } from "@/lib/news-outcome";
import { poolMax } from "@/lib/db/pool";

import type { Queryable } from "../x/token-refresh";

import { judgeCaptcha, probeCaptcha, type CaptchaProbeDeps } from "./captcha-status";
import {
  approxYen,
  type Check,
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
import { judgeAffiliatePayouts } from "./affiliate-payout-status";
import {
  judgeWebhookEvents,
  probeWebhookEvents,
  type WebhookEventsProbeDeps,
} from "./webhook-events-status";

// 型と全体まとめは `check.ts` が正本（`scripts/doctor.mjs` も同じものを読む・R31）。
export { approxYen, summarize, worstLevel };
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

/** 同じ理由が何件以上出たら「繰り返し」とみなすか。1〜2件は個別の事情のことが多い。 */
export const REPEATED_FAILURE_MIN = 3;

/** 直近24時間で同じ理由の失敗が何件出たか。 */
export interface FailureGroup {
  /** 利用者へ出している文言をそのまま使う（内部コードは運営者にも出さない）。 */
  message: string;
  count: number;
  /** その理由に当たった利用者の数。 */
  users: number;
}

/**
 * **同じ原因で繰り返している失敗**と、**実行が全部失敗している利用者**を運営者へ届ける（T-M8-307）。
 *
 * {@link judgeJobs} は全体の成功/失敗の**合計**しか見ない。1人の利用者の実行が全滅していても、
 * 他の利用者の成功に紛れて「注意」止まりになり、**誰がどう壊れているかは出ない**。
 * 2026-08-25 に見つかった不具合（利用枠の世代付きキーがcheck制約で弾かれ、トライアル中に
 * プランを下げた利用者は以後まったく実行できない・T-M8-299）はまさにこの形だった。
 * 画面には「残り満額」と出るため利用者からも見えず、**気付けたのは開発中に偶然踏んだから**。
 *
 * 仕組みの問題は「特定の利用者だけ全部失敗」か「同じ理由が何度も出る」として現れる。
 * 個人が特定できる値（メール・ID）は載せない——**人数と理由だけで運営者は動ける**。
 */
export function judgeRepeatedFailures(input: {
  groups: FailureGroup[];
  /** 直近24時間の実行が「成功0・失敗2件以上」だった利用者の数。 */
  allFailingUsers: number;
}): Check {
  const name = "繰り返している失敗";
  const describe = (g: FailureGroup) => `「${g.message}」が ${g.count} 件（利用者 ${g.users} 名）`;
  const repeated = input.groups.filter((g) => g.count >= REPEATED_FAILURE_MIN);

  if (input.allFailingUsers > 0) {
    return {
      name,
      level: "error",
      detail:
        `直近24時間の実行がすべて失敗している利用者が ${input.allFailingUsers} 名います` +
        (input.groups.length > 0 ? `。最も多い理由: ${describe(input.groups[0])}` : ""),
      nextAction:
        "その利用者は今アプリを使えません。Claudeに「実行がすべて失敗している利用者の原因を調べて」と伝えてください",
    };
  }
  if (repeated.length > 0) {
    return {
      name,
      level: "warn",
      detail: `同じ理由の失敗が続いています: ${repeated.map(describe).join(" / ")}`,
      nextAction: "Claudeに「繰り返している失敗の原因を調べて」と伝えてください",
    };
  }
  if (input.groups.length === 0) {
    return { name, level: "ok", detail: "直近24時間で失敗はありません" };
  }
  return {
    name,
    level: "ok",
    detail: `失敗はありますが、同じ理由の繰り返しではありません（最多で ${input.groups[0].count} 件）`,
  };
}

/**
 * {@link judgeRepeatedFailures} の材料を集める（直近24時間）。
 *
 * 取るのは**人数と、利用者へ既に出している文言だけ**。メール・IDのような個人が特定できる値は
 * 運営者向けの通知にも載せない（`/security-audit` の方針と揃える）。
 */
export async function collectFailurePatterns(
  db: Queryable,
  options: {
    /** 対象の利用者を絞る（**テスト用**。本番は未指定＝全利用者）。 */
    userIds?: string[];
  } = {},
): Promise<{ groups: FailureGroup[]; allFailingUsers: number }> {
  const { rows } = await db.query<{ groups: FailureGroup[]; all_failing_users: number }>(
    `with recent as (
       select gj.status, xa.user_id, gj.error->>'message' as message
         from generation_jobs gj
         join x_accounts xa on xa.id = gj.x_account_id
        where gj.created_at > now() - interval '24 hours'
          and ($1::uuid[] is null or xa.user_id = any($1::uuid[]))
     ),
     grouped as (
       -- 文言でまとめる（内部のcodeは運営者にも見せないので、そのまま出せる形で数える）。
       select coalesce(message, '原因が記録されていない失敗') as message,
              count(*)::int as n, count(distinct user_id)::int as u
         from recent
        where status = 'failed'
        group by 1
        order by count(*) desc
        limit 3
     )
     select coalesce(
              (select json_agg(json_build_object('message', message, 'count', n, 'users', u)
                               order by n desc)
                 from grouped),
              '[]'::json
            ) as groups,
            (select count(*)::int
               from (
                 -- 「成功0・失敗2件以上」＝その利用者はいまアプリを使えていない。
                 -- 失敗1件だけは普通に起こるので2件から数える。
                 select user_id
                   from recent
                  group by user_id
                 having count(*) filter (where status = 'succeeded') = 0
                    and count(*) filter (where status = 'failed') >= 2
               ) t) as all_failing_users`,
    [options.userIds ?? null],
  );
  return {
    groups: rows[0]?.groups ?? [],
    allFailingUsers: Number(rows[0]?.all_failing_users ?? 0),
  };
}

/**
 * `news_fetch` が走る **UTC の時刻**（`vercel.json` の `0 3,10 * * *` ＝ **JST 12時・19時**）。
 *
 * **1日2回**（T-M8-326・運営者の指示 2026-08-27）。国内の発表は午前と夕方に集中するため、
 * その直後に寄せた。以前は3時間おき5回で、**本番の外部API費用の97.6%がここだった**
 * （実測: Anthropic $23.31 のうち $23.14 が196回のニュース取得）。
 *
 * **UTC12時の次はUTC0時＝12時間空く**。この空きが「止まっている」判定より長いので、
 * 経過時間だけで判定すると**毎晩かならず赤くなる**（T-M8-310。2026-08-26 に本番で
 * 「13時間実行されていません」と出たが、直前の実行は予定どおりで何も壊れていなかった）。
 * 直せない理由で赤くすると本物の異常が隠れる（T-M7-44・T-M8-51 と同じ判断）。
 *
 * ここを変えたら `vercel.json` も変える。ズレは `vercel-crons.test.ts` が落とす。
 */
/**
 * news_fetch の起動時（UTC）。RSS巡回は20分おき＝毎時走る（T-M8-380で1日2回のAIリサーチから変更）。
 * `vercel.json` の cron 式から `vercel-crons.test.ts` が突き合わせる。
 */
export const NEWS_FETCH_UTC_HOURS = Array.from({ length: 24 }, (_, h) => h);

/** cronの起動遅れと実行時間の余裕。これを超えて遅れていれば本当に走っていない。 */
export const NEWS_RUN_GRACE_HOURS = 1;

/**
 * **「もう終わっているはずの回」から何時間経ったか。**
 *
 * 判定の基準になる値。`now` から {@link NEWS_RUN_GRACE_HOURS} を引いた時点より前の予定のうち
 * 最も新しいものを「もう終わっているはず」とみなし、そこからの経過時間を返す。
 * 実際の最終実行がこれより古ければ、**予定の回が1本飛んでいる**ことになる。
 *
 * 猶予を先に引くことで、cronの起動が数分遅れているだけの状態を異常にしない。
 * 予定表が空なら 0 を返す（判定を赤くしない側へ倒す）。
 */
export function hoursSinceDueNewsRun(
  now: Date,
  hoursUtc: readonly number[] = NEWS_FETCH_UTC_HOURS,
  graceHours: number = NEWS_RUN_GRACE_HOURS,
): number {
  if (hoursUtc.length === 0) return 0;
  const nowFrac = now.getUTCHours() + now.getUTCMinutes() / 60;
  const dueBy = nowFrac - graceHours;
  const past = hoursUtc.filter((h) => h <= dueBy);
  // その日まだ「終わっているはずの回」が無ければ、前日の最後の予定から数える。
  return past.length > 0 ? nowFrac - Math.max(...past) : nowFrac + 24 - Math.max(...hoursUtc);
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
  /** 判定時刻（テストで固定するために注入する。既定は現在時刻）。 */
  now?: Date;
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
  /*
    **「何時間空いたか」ではなく「走るはずの時刻を過ぎたか」で見る**（T-M8-310）。
    news_fetch は UTC0〜12時の3時間おきで、UTC12時→翌0時は**予定として12時間空く**。
    固定の閾値（旧: 6時間）だと、その空きのあいだ毎晩かならず赤くなり、
    運営者アラートが毎朝届いて本物の異常が埋もれていた。
  */
  if (input.hoursSinceLastRun > hoursSinceDueNewsRun(input.now ?? new Date())) {
    return {
      name,
      level: "error",
      detail,
      nextAction:
        "走るはずの時刻を過ぎても実行されていません。定時実行が止まっている可能性があります",
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
 * 定時実行（`scheduler_tick`）が生きているか（T-M8-51）。
 *
 * 旧・お知らせメール検査と**同じ型の見落とし**が残っていた——止まっていても doctor はどこも赤く
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

/**
 * X（Twitter）連携の状態。
 *
 * **access tokenが切れていること自体は異常ではない**（T-M8-359・運営者の指摘 2026-08-28）。
 * Xのaccess tokenは2時間で切れる設計で、refresh tokenがあれば
 * 先回り更新（1時間ごと・`token-keepalive.ts`）と実行時の自動更新で戻る。
 * ここで毎朝【注意】を出していたため、**直す必要のない警告が毎日届き**、
 * 本当の異常（要再連携）まで読み飛ばされる状態だった（原則2）。
 *
 * 見るのは「**人が操作しないと直らないか**」の一点にする:
 * - `status` が active でない → 要再連携（error）
 * - refresh token が無い → 次に使ったときに必ず失効する（warn。放っておくと切れる）
 */
export function judgeXAccounts(
  rows: {
    handle: string;
    status: string;
    expiresInHours: number | null;
    /** refresh token を持っているか（自動更新できるか）。 */
    canRefresh?: boolean;
  }[],
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
  // 自動更新の材料が無いものだけを警告する（期限切れそのものは正常な状態）。
  const cannotRefresh = rows.filter((r) => r.status === "active" && r.canRefresh === false);
  if (broken.length > 0) {
    return {
      name,
      level: "error",
      detail: `${summarizeAccounts(rows)}。要再連携: ${listHandles(broken)}`,
      nextAction: "設定画面のXアカウントから再連携してください",
    };
  }
  if (cannotRefresh.length > 0) {
    return {
      name,
      level: "warn",
      detail:
        `${summarizeAccounts(rows)}。自動更新に使う許可が保存されていないものがあります` +
        `（次に使ったときに切れます）: ${listHandles(cannotRefresh)}`,
      nextAction: "設定画面のXアカウントから再連携してください",
    };
  }
  return { name, level: "ok", detail: summarizeAccounts(rows) };
}

/**
 * 何件あるかを1行で言う（T-M8-360）。**全件のhandleを並べない**——
 * 連携が数十件ある環境では1行が数百文字になり、**問題のある1件がその中に埋もれる**
 * （2026-08-28、67件が1行に並んで読めなかった）。少数なら従来どおり名前で出す。
 */
function summarizeAccounts(rows: { handle: string; status: string }[]): string {
  if (rows.length <= ACCOUNT_LIST_MAX) {
    return rows
      .map((r) => `@${r.handle}（${r.status === "active" ? "有効" : "要再連携"}）`)
      .join(" / ");
  }
  const active = rows.filter((r) => r.status === "active").length;
  return `${rows.length}件（有効 ${active}件 / 要再連携 ${rows.length - active}件）`;
}

/** 問題のあるものだけを名前で出す。多すぎるときは先頭数件＋残数。 */
function listHandles(rows: { handle: string }[]): string {
  const shown = rows.slice(0, ACCOUNT_LIST_MAX).map((r) => `@${r.handle}`).join(" / ");
  return rows.length > ACCOUNT_LIST_MAX ? `${shown} ほか${rows.length - ACCOUNT_LIST_MAX}件` : shown;
}

/** これを超えたら名前を並べずに件数で言う。 */
const ACCOUNT_LIST_MAX = 5;

/** 途中で止まったまま動いていない処理。 */
/**
 * ホーム（LP）の閲覧記録が止まっていないか（T-M8-422・原則1「正常な空と失敗の空を分ける」）。
 * `recordPageView` の失敗は Sentry にしか出ないため、書き込みが壊れると /admin では「来訪が減った」に
 * 見える。本番だけ、直近2日（JST・今日と昨日）の `/` の閲覧が0件なら知らせる。
 */
export function judgeHomePageViews(input: { views: number; expected: boolean }): Check {
  const name = "ホームの閲覧記録";
  if (!input.expected) return { name, level: "ok", detail: "ローカルでは判定しません" };
  if (input.views > 0) return { name, level: "ok", detail: `直近2日で ${input.views} 回` };
  return {
    name,
    level: "warn",
    detail: "直近2日（今日と昨日）にホームの閲覧が1件も記録されていません",
    nextAction:
      "実際にブラウザでホームを開いてから /admin の入口ファネルを見てください。増えなければ記録が壊れています（Claudeに「ホームの閲覧記録を調べて」と伝えてください）",
  };
}

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
/**
 * DB接続の待ち行列（T-M8-198・要件01 §9）。**Supabase Pro へ上げる条件のひとつ**
 * 「pooler接続の枯渇・待ち行列が観測された」を、運営者が画面1つで判断できるようにする。
 *
 * 記録は「接続の取得が待たされたときだけ」入る（`db_pool_events`）。正常なら0件で、
 * 件数が続くようなら接続数の上限（`DB_POOL_MAX`）かプラン移行を検討する時期。
 */
/*
  **短い待ちが数回あるだけでは異常ではない**（T-M8-359・運営者の指摘 2026-08-28）。
  以前は24時間に1回でも並べば【注意】を出していたため、**0.2秒の待ちが5回**という
  実用上どうでもいない状態で毎朝メールが届いていた。直す必要のない警告は読まれなくなり、
  本当の異常まで埋もれる（原則2。T-M8-323で同じ理由から「接続確立の待ち」を判定から外した）。

  本物の枯渇は**回数が多い**か**待ちが長い**かのどちらかに必ず出る。両方を見て、
  どちらかが閾値を超えたときだけ知らせる。
*/
export const DB_POOL_WAIT_WARN = 20;
export const DB_POOL_WAIT_ERROR = 100;
/** 1回でもこれだけ待たされたら、回数が少なくても知らせる（体感に出る長さ）。 */
export const DB_POOL_WAITED_MS_WARN = 2_000;
export const DB_POOL_WAITED_MS_ERROR = 10_000;

export function judgePoolWaits(input: {
  /** 接続の取得を待たされた回数（接続の新規確立を含む）。 */
  waits24h: number;
  /** **そのうち実際に待ち行列ができていた回数**（`waiting_count > 0`）。判定の主軸。 */
  queuedWaits24h?: number;
  maxWaitedMs: number;
  poolMax?: number;
}): Check {
  const name = "DB接続の混み具合";
  const limit = input.poolMax ? `（1インスタンスあたり上限 ${input.poolMax}）` : "";
  /*
    **「並んだ」と「接続を張った」を分けて判定する**（T-M8-323）。

    以前は件数だけで判定していたため、**5分ごとのcronが新しい接続を張るだけで毎日必ず赤**に
    なっていた（2026-08-27、本番302件のうち292件は `total_count=1 / waiting_count=0`＝
    プールが空で誰も並んでいない。単に接続確立に約600msかかっていただけ）。
    サーバーレスでは実行のたびに新しいインスタンスが立つので、**接続の確立は避けられない**。
    直せない正常な状態を赤くすると本物の異常が埋もれる（T-M7-44・T-M8-310と同じ判断）。

    本物の混雑は `waiting_count > 0`＝**空きを待って並んだ**ときだけ起きる。そちらを主軸にし、
    接続確立の回数は数字として出すが赤くしない。
  */
  const queued = input.queuedWaits24h ?? input.waits24h;
  const setup = Math.max(0, input.waits24h - queued);
  const setupNote = setup > 0 ? `。ほかに接続を新しく張った待ちが ${setup} 回（混雑ではありません）` : "";

  const crowded = queued >= DB_POOL_WAIT_WARN || input.maxWaitedMs >= DB_POOL_WAITED_MS_WARN;
  if (!crowded) {
    const few =
      queued > 0
        ? `直近24時間の空き待ちは${queued}回（最長${(input.maxWaitedMs / 1000).toFixed(1)}秒）で、混雑と呼ぶ量ではありません`
        : "直近24時間で空き待ちはありません";
    return { name, level: "ok", detail: `${few}${limit}${setupNote}` };
  }
  const detail = `直近24時間で空き待ちが${queued}回（最長${(input.maxWaitedMs / 1000).toFixed(1)}秒）${limit}${setupNote}`;
  if (queued < DB_POOL_WAIT_ERROR && input.maxWaitedMs < DB_POOL_WAITED_MS_ERROR) {
    return {
      name,
      level: "warn",
      detail: `${detail}。まだ動いていますが、増え続けるなら手を打つ時期です`,
      nextAction:
        "続くようなら DB_POOL_MAX を見直すか、Supabase Pro（専用pooler）への移行を検討してください（要件01 §9）",
    };
  }
  return {
    name,
    level: "error",
    detail: `${detail}。空き待ちが常態化しています`,
    nextAction:
      "Supabase Pro へ移行するか DB_POOL_MAX を調整してください（要件01 §9 の移行条件に該当します）",
  };
}

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

/** デプロイ先が持っているブログ記事の事実（T-M8-184）。`readBlogCollection()` の要約。 */
export interface BlogFacts {
  /** `blog/` ディレクトリがデプロイに含まれているか。 */
  directoryExists: boolean;
  published: number;
  drafts: number;
  /** front matter の不備で公開できていないファイル名。 */
  invalidFiles: string[];
}

/**
 * **ブログ記事がデプロイに同梱されているか**（T-M8-184）。
 *
 * 記事はリポジトリの `blog/*.md` をリクエスト時に読む。Vercel は静的 import から辿れる
 * ファイルしか同梱しないので、`next.config.ts` の `outputFileTracingIncludes` が欠けると
 * **本番だけ「準備中」になる**（ローカルと dev は cwd から読めるので全部緑のまま）。
 * HTTPは200を返し画面も整っているため、URLを叩く検査では分からない。
 *
 * 見ているのは **doctor 自身の関数に同梱されたファイル**。`/blog` の関数と同じ設定
 * （`outputFileTracingIncludes`）で同梱されることは、出荷前に `npm run check:blog-trace`
 * （`release:check`）が3つの route のトレースを突き合わせて保証する。
 */
export function judgeBlog(input: BlogFacts): Check {
  const name = "ブログ記事の同梱";
  if (!input.directoryExists) {
    return {
      name,
      level: "error",
      detail:
        "記事ディレクトリ blog/ がこのデプロイに含まれていません（/blog は「準備中」になります。blog/ に .md が1つも無い場合も同じ表示）",
      nextAction:
        "npm run build && npm run check:blog-trace で同梱を確認し、next.config.ts の outputFileTracingIncludes を直して再デプロイしてください（記事を置いていないだけなら blog/README.md があれば消えます）",
    };
  }
  const detail = `公開 ${input.published} 件・下書き ${input.drafts} 件`;
  if (input.invalidFiles.length > 0) {
    return {
      name,
      level: "warn",
      detail: `${detail}・不備 ${input.invalidFiles.length} 件（${input.invalidFiles.join(", ")}）は公開されていません`,
      nextAction: "npm run blog:check で理由を確認して直してください",
    };
  }
  return { name, level: "ok", detail };
}

/**
 * **契約が1件でもある環境で、Stripeからのイベントを受け取れているか**（T-M8-238）。
 *
 * webhook が届かなくなっても「配送されない」だけなので例外は起きない。解約・プラン変更・
 * 返金がDBへ反映されないまま、画面は正常に見え続ける（CLAUDE.md 原則1）。
 * 直近の受信からの経過時間で「止まっているかもしれない」ことだけを言う——
 * イベントは契約者がいなければ来ないので、**0件は警告どまり**にする。
 */
/*
  **「静かなこと」を異常として扱わない**（T-M8-371）。

  以前は「最後の受信から72時間」で warn にしていたが、**Stripeのイベントは契約に動きが
  あったときにしか来ない**。利用者が数人でトライアル中なら、何日も無音なのが正常な状態で、
  この判定は毎日かならず warn を出す。運営者の朝のメールに毎日出る警告は、
  **本物の異常を埋もれさせる**（2026-08-29、本番で実際に「83時間」の warn が出ていた。
  中身は「トライアル中の契約が1件あり、まだ何も起きていない」だけだった）。

  代わりに**ずれている証拠**を見る: 更新日・トライアル終了日を過ぎたのに、
  その後のイベントを1件も受け取っていない契約があるか。あれば本当に反映されていない。
*/
/** 期限切れとみなすまでの猶予（Stripeの課金処理とwebhook配送の遅れを吸収する）。 */
export const SUBSCRIPTION_OVERDUE_GRACE_HOURS = 6;

export function judgeSubscriptionSync(input: {
  hoursSinceLastEvent: number | null;
  totalEvents: number;
  /** 期限を過ぎたのに、その後のイベントを受け取っていない契約の数。 */
  overdueSubscriptions: number;
}): Check {
  const name = "契約の同期（Stripe → アプリ）";
  if (input.overdueSubscriptions > 0) {
    return {
      name,
      level: "warn",
      detail: `更新日を過ぎたのに反映されていない契約が ${input.overdueSubscriptions} 件あります`,
      nextAction:
        "解約やプラン変更がアプリへ反映されていない可能性があります。Stripeダッシュボード → Webhooks で配信の失敗を確認してください",
    };
  }
  if (input.totalEvents === 0) {
    return {
      name,
      level: "ok",
      detail: "Stripeからのイベントはまだありません（契約に動きがなければ正常です）",
    };
  }
  const hours = input.hoursSinceLastEvent;
  return {
    name,
    level: "ok",
    detail:
      hours == null
        ? `合計 ${input.totalEvents} 件（期限を過ぎたまま未反映の契約はありません）`
        : `直近の受信は ${Math.floor(hours)} 時間前（合計 ${input.totalEvents} 件・期限を過ぎたまま未反映の契約はありません）`,
  };
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
  /** ブログ記事の同梱状況（T-M8-184）。未指定なら判定しない（DBだけの経路を壊さない）。 */
  blog?: BlogFacts;
  /** webhookの購読イベント（T-M8-238）。鍵かURLが無ければ「確認できません」。 */
  webhookEvents?: WebhookEventsProbeDeps;
  /**
   * 契約同期の鮮度（T-M8-238）。**本番でのみ判定する**——ローカル・previewは
   * `stripe listen` を動かしていないのが普通なので、赤くすると読まれなくなる。
   */
  subscriptionSyncExpected?: boolean;
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

  // **合計だけでは「誰がどう壊れているか」が出ない**（T-M8-307）。集計は `collectFailurePatterns`。
  checks.push(judgeRepeatedFailures(await collectFailurePatterns(db)));

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

  // （旧「お知らせメール」検査はT-M8-222で廃止——通知はアプリ内のみで、メール配送台帳が無い）

  const accounts = await db.query<{
    handle: string;
    status: string;
    hours: string | null;
    can_refresh: boolean;
  }>(
    `select handle, status::text as status,
            (extract(epoch from (token_expires_at - now())) / 3600)::text as hours,
            (refresh_token_ciphertext is not null) as can_refresh
       from x_accounts order by created_at`,
  );
  checks.push(
    judgeXAccounts(
      accounts.rows.map((r) => ({
        handle: r.handle,
        status: r.status,
        expiresInHours: r.hours == null ? null : Number(r.hours),
        canRefresh: r.can_refresh,
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

  const homeViews = await db.query<{ n: string }>(
    `select coalesce(sum(views), 0)::text as n from page_views
      where path = '/' and view_date >= (now() at time zone 'Asia/Tokyo')::date - 1`,
  );
  checks.push(
    judgeHomePageViews({
      views: Number(homeViews.rows[0]?.n ?? 0),
      expected: options.schedulerExpected,
    }),
  );

  const cost = await db.query<{ provider: string; usd: string }>(
    `select provider::text as provider, coalesce(sum(estimated_cost_usd), 0)::text as usd
       from external_api_usage_events
      -- **月の区切りは日本時間**（T-M8-254・運営者の指示 2026-08-23）。UTC月初で切ると
      -- UTCの月初になるため、**毎月1日のJST 0時〜9時は前月分の合計が「今月」として出る**。
      -- 費用は会計に合わせて**暦月**で集計する（利用者の利用枠は契約期間ごと・T-M8-258。ここは変えない）。
      where occurred_at >= (date_trunc('month', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo')
      group by provider order by 2 desc`,
  );
  const byProvider = cost.rows.map((r) => ({ provider: r.provider, usd: Number(r.usd) }));
  checks.push(
    judgeCost({
      monthUsd: byProvider.reduce((s, p) => s + p.usd, 0),
      byProvider,
    }),
  );

  // DB接続の待ち行列（T-M8-198）。記録は待たされたときだけ入るので、通常は0件。
  /*
    **「並んだ回数」と「接続を張るのにかかった回数」を分けて数える**（T-M8-323）。
    以前は件数だけを見ていたため、5分ごとのcronが新しい接続を張るたびに1件積まれ、
    **それだけで毎日必ず閾値を超えて赤**になっていた（2026-08-27、本番302件のうち292件が
    `total_count=1 / waiting_count=0`＝プールが空で誰も並んでいない状態だった）。
  */
  const poolWaits = await db.query<{ n: string; queued: string; max_ms: string }>(
    `select count(*)::text as n,
            count(*) filter (where waiting_count > 0)::text as queued,
            coalesce(max(waited_ms), 0)::text as max_ms
       from db_pool_events where occurred_at >= now() - interval '24 hours'`,
  );
  checks.push(
    judgePoolWaits({
      waits24h: Number(poolWaits.rows[0]?.n ?? 0),
      queuedWaits24h: Number(poolWaits.rows[0]?.queued ?? 0),
      maxWaitedMs: Number(poolWaits.rows[0]?.max_ms ?? 0),
      poolMax: poolMax(),
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

  /*
    **Stripeのイベントが届く設定になっているか**（T-M8-238）。購読するイベントの選択は
    ダッシュボード側の設定でコードに現れない。実際に本番・stagingとも `charge.refunded` が
    抜けており、**返金しても招待報酬が取り消されない**状態だった。届かないイベントは
    例外にならないので、Sentryにも画面にも出ない。
  */
  if (options.webhookEvents) {
    checks.push(judgeWebhookEvents(await probeWebhookEvents(options.webhookEvents)));
  }

  /*
    **契約の同期が生きているか**（T-M8-238）。`profiles` を更新する経路は webhook だけなので、
    届かなくなっても例外は起きず、画面は正常に見えたまま解約・プラン変更が反映されなくなる。
    実際にローカルで「DBはトライアル中のスタンダード／Stripeはエキスパートで課金済み」に
    なっていた。直近の受信が途絶えていないかを、受け取ったイベントの記録で見る。
  */
  if (options.subscriptionSyncExpected) {
    const events = await db.query<{ hours: string | null; total: string }>(
      `select (extract(epoch from (now() - max(event_created_at))) / 3600)::text as hours,
              count(*)::text as total
         from stripe_events`,
    );
    /*
      **期限を過ぎたのに、その後のイベントが無い契約**を数える（T-M8-371）。
      これが「webhookが届いていない」の唯一の確かな証拠。無音そのものは正常でありうる。
    */
    const overdue = await db.query<{ overdue: string }>(
      `select count(*)::text as overdue
         from profiles p
        where p.stripe_subscription_id is not null
          and p.subscription_status in ('trialing', 'active', 'past_due')
          and coalesce(p.current_period_end, p.trial_ends_at)
              < now() - ($1 || ' hours')::interval
          and not exists (
            select 1 from stripe_events e
             where e.event_created_at > coalesce(p.current_period_end, p.trial_ends_at)
          )`,
      [String(SUBSCRIPTION_OVERDUE_GRACE_HOURS)],
    );
    checks.push(
      judgeSubscriptionSync({
        hoursSinceLastEvent:
          events.rows[0]?.hours == null ? null : Number(events.rows[0].hours),
        totalEvents: Number(events.rows[0]?.total ?? 0),
        overdueSubscriptions: Number(overdue.rows[0]?.overdue ?? 0),
      }),
    );
  }

  /*
    **招待報酬の振込期限**（T-M8-241）。振込は運営者の手作業なので、締めが自動でも
    「払うこと」自体が記憶頼みだった（原則3）。期限が近い/過ぎたら名指しする。
  */
  const payouts = await db.query<{ pending: string; net: string | null; due: string | null }>(
    `select count(*)::text as pending,
            coalesce(sum(net_amount), 0)::text as net,
            min(payment_due_at)::text as due
       from affiliate_payouts where status = 'created'`,
  );
  checks.push(
    judgeAffiliatePayouts({
      dueAt: payouts.rows[0]?.due ?? null,
      netTotal: Number(payouts.rows[0]?.net ?? 0),
      pending: Number(payouts.rows[0]?.pending ?? 0),
    }),
  );

  // ブログ記事がこのデプロイに同梱されているか（T-M8-184）。同梱漏れは本番だけ「準備中」になる。
  if (options.blog) checks.push(judgeBlog(options.blog));

  return {
    level: worstLevel(checks.map((c) => c.level)),
    checks,
    summary: summarize(checks),
  };
}
