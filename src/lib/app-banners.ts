import type { PlanId } from "@/lib/plans";
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
  const byokPlan = input.plan === "standard" || input.plan === "md";
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

const USAGE_SLOT_LABELS: [keyof UsageSummary, string][] = [
  ["normal_posts", "通常投稿枠"],
  ["url_posts", "URL付き投稿枠"],
  ["generations", "生成枠"],
  ["images", "画像枠"],
];

/**
 * 利用枠100%到達の常設バナー（要件03 §8, T-M6-13）。remaining=0 の枠が1つでもあれば表示する。
 * `notification_config` にかかわらず表示する（呼び出し側の App Shell は残量サマリから直接算出し、通知設定を
 * 参照しない）。premium 以外は summary=null で呼ばれ、バナーは出ない。
 */
export function usageLimitBanner(summary: UsageSummary | null): AppBanner | null {
  if (!summary) return null;
  const atLimit = USAGE_SLOT_LABELS.filter(([key]) => summary[key].remaining <= 0).map(([, label]) => label);
  if (atLimit.length === 0) return null;
  return {
    id: "usage_limit",
    tone: "warning",
    title: "今月の利用枠が上限に達しました",
    description: `${atLimit.join("・")}が上限に達しました。翌月にリセットされます。既存の下書きの閲覧・編集は引き続きできます。`,
    actionLabel: "利用状況を見る",
    actionHref: "/app/settings?tab=billing",
  };
}
