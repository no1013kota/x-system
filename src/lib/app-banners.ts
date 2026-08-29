import { isOperatorManagedPlan, type PlanId } from "@/lib/plans";
import { remainingDailyPosts } from "@/lib/usage/daily-post-limit";
import type { UsageSummary } from "@/lib/usage/usage-summary";
import { expectedAuthTypeForPlan } from "@/lib/x/oauth-start";

/**
 * App Shell の常設バナー算出（要件06 §2・要件03 §5/§8・要件01 §5, T-M2-21）。契約停止バナーは
 * `subscriptionBannerFor`（M1）が担い、ここはX連携まわりの3系統を出す。表示と導線のみで、
 * 再連携までの生成閲覧許可／投稿・自動実行停止の制御は投稿系マイルストーンの実行前提検証が担保する。
 */

const X_ACCOUNTS_PATH = "/app/settings?tab=x-accounts";
const API_KEYS_PATH = "/app/settings?tab=api-keys";

export interface AppBanner {
  id: string;
  tone: "warning" | "info";
  title: string;
  description: string;
  actionLabel: string;
  actionHref: string;
}

export interface XBannerInputs {
  plan: PlanId;
  xAccounts: { status: string; authType: string }[];
  xApiKeyStatus: string | null;
}

export function computeXAccountBanners(input: XBannerInputs): AppBanner[] {
  const expected = expectedAuthTypeForPlan(input.plan);
  const banners: AppBanner[] = [];

  // (要件03 §8・要件06 §2) プラン変更で Developer App が変わり auth_type が不一致 → 再連携要求。
  const authMismatch = input.xAccounts.some(
    (a) => a.status !== "disabled" && a.authType !== expected,
  );
  if (authMismatch) {
    banners.push({
      id: "x_authtype",
      tone: "warning",
      title: "Xの再連携が必要です",
      description:
        "プラン変更でDeveloper Appが変わりました。投稿と自動実行を再開するには、設定からXアカウントを再連携してください。",
      actionLabel: "Xアカウント設定",
      actionHref: X_ACCOUNTS_PATH,
    });
  }

  // (要件06 §2) token失効・エラー。auth_type不一致で説明できるものは上のバナーへ集約する。
  const needsReconnect = input.xAccounts.some(
    (a) => (a.status === "expired" || a.status === "error") && a.authType === expected,
  );
  if (needsReconnect) {
    banners.push({
      id: "x_status",
      tone: "warning",
      title: "Xとの連携が切れています",
      description:
        "一部のXアカウントがトークン失効またはエラーです。投稿と自動実行を再開するには再連携してください。",
      actionLabel: "Xアカウント設定",
      actionHref: X_ACCOUNTS_PATH,
    });
  }

  // (要件06 §2) BYOK必須プラン（standard／md）でX APIキーが無効。
  // BYOK（利用者自身のAPIキーが必要）かは plans.ts の定義から引く（T-M8-168）。
  const byokPlan = !isOperatorManagedPlan(input.plan);
  if (byokPlan && input.xApiKeyStatus === "invalid") {
    banners.push({
      id: "x_key",
      tone: "warning",
      title: "X APIキーが無効です",
      description: "保存されたX APIキーが無効です。設定でキーを確認・更新してください。",
      actionLabel: "APIキー設定",
      actionHref: API_KEYS_PATH,
    });
  }

  return banners;
}

const USAGE_SLOT_LABELS: ["ai_credits" | "normal_posts" | "url_posts", string][] = [
  ["ai_credits", "AIクレジット"],
  ["normal_posts", "通常投稿回数"],
  ["url_posts", "URL付き投稿回数"],
];

/**
 * 利用枠100%到達の常設バナー（要件03 §8, T-M6-13）。remaining=0 の枠が1つでもあれば表示する。
 * `notification_config` にかかわらず表示する（呼び出し側の App Shell は残量サマリから直接算出し、通知設定を
 * 参照しない）。BYOK（standard）は summary=null で呼ばれ、バナーは出ない。
 *
 * `summary.concealed`（エキスパート・T-M8-168）のときは**枠名・数値・「上限」の語を出さない**。
 * 表向き無制限のプランなので、文言は「連続的な使用が検知されたため一時的に停止しております。
 * お待ちください。」（運営者指定・`usage_paused` と同文）だけにする。
 */
export function usageLimitBanner(summary: UsageSummary | null): AppBanner | null {
  if (!summary) return null;
  if (summary.concealed) {
    // concealed の summary は枠の数値がゼロ埋めされている。停止判定は paused だけを見る
    // （実行が止まる条件と同じ関数で算出済み・usage-summary.ts）。
    if (!summary.paused) return null;
    return {
      id: "usage_paused",
      tone: "warning",
      title: "一時的に停止しています",
      description:
        "連続的な使用が検知されたため一時的に停止しております。お待ちください。既存の下書きの閲覧・編集は引き続きできます。",
      actionLabel: "利用状況を見る",
      actionHref: "/app/settings?tab=billing",
    };
  }
  const atLimit = USAGE_SLOT_LABELS.filter(([key]) => summary[key].remaining <= 0).map(([, label]) => label);
  if (atLimit.length === 0) return null;
  return {
    id: "usage_limit",
    tone: "warning",
    title: "利用枠が上限に達しました",
    description: `${atLimit.join("・")}が上限に達しました。次回の更新日にリセットされます。既存の下書きの閲覧・編集は引き続きできます。`,
    actionLabel: "利用状況を見る",
    actionHref: "/app/settings?tab=billing",
  };
}

/**
 * 日次投稿上限に達したことの常設バナー（要決定D-15・案A, T-M8-26）。
 *
 * 上限そのものは前からあったが、判定が投稿jobの中にしか無く、**投稿しようとして初めて
 * 分かる**状態だった（`daily_limit_reached` で下書きへ戻る）。それでは利用者は「なぜ投稿
 * されないのか」を都度エラーで知ることになる（CLAUDE.md 原則1）。
 *
 * 出すのは**上限に達したときだけ**。残りが少ないだけの状態で出すと、毎日出ることになって
 * バナーそのものが読まれなくなる。
 */
export function dailyPostLimitBanner(input: {
  todaysPosts: number;
  dailyLimit: number;
}): AppBanner | null {
  if (remainingDailyPosts(input.todaysPosts, input.dailyLimit) > 0) return null;
  return {
    id: "daily_post_limit",
    tone: "warning",
    title: "本日の投稿上限に達しました",
    description: `安全のため1日${input.dailyLimit}件までに制限しています。新しい投稿は翌日0:00（JST）に再開できます。自動実行は下書きの作成まで続きます。`,
    actionLabel: "下書きを見る",
    actionHref: "/app/posts?tab=drafts",
  };
}

/**
 * 利用規約・プライバシーポリシーの再同意が必要なときの常設バナー（T-M8-134）。
 *
 * **これが無いと、規約の版が上がった瞬間に生成・投稿・スケジュール保存が全部止まり、
 * 操作して初めて「利用規約等の更新内容をご確認ください」とだけ言われる**——
 * どこで何をすれば直るのか画面から辿れない（CLAUDE.md 原則2）。
 * 2026-08-18、運営者がスケジュール保存で実際に踏んだ。
 */
export function legalConsentBanner(required: {
  terms: boolean;
  privacy: boolean;
}): AppBanner | null {
  if (!required.terms && !required.privacy) return null;
  const what =
    required.terms && required.privacy
      ? "利用規約とプライバシーポリシー"
      : required.terms
        ? "利用規約"
        : "プライバシーポリシー";
  return {
    id: "legal-consent",
    tone: "warning",
    title: `${what}が更新されました`,
    // **止まっていることを先に言う。** 「確認してください」だけだと、
    // 読まなくても使えると受け取られ、操作して初めて止まっていると気付く。
    description: `同意いただくまで、投稿の生成・投稿・スケジュールの保存は実行できません。内容をご確認のうえ同意してください。`,
    actionLabel: "内容を確認する",
    actionHref: "/app/consent",
  };
}
