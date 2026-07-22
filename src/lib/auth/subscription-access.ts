import { DB_ENUMS } from "@/lib/db/enums";
import { AppError } from "@/lib/observability/errors";

export type SubscriptionStatus =
  (typeof DB_ENUMS.subscription_status)[number];

export interface SubscriptionAccess {
  action: "checkout" | "none" | "portal";
  actionPath: "/app/settings?tab=billing" | "/plans" | null;
  canBrowseApp: boolean;
  canExecute: boolean;
  viewScope: "app" | "settings_plans";
}

export const SUBSCRIPTION_ACCESS: Record<
  SubscriptionStatus,
  SubscriptionAccess
> = {
  incomplete: {
    action: "checkout",
    actionPath: "/plans",
    canBrowseApp: false,
    canExecute: false,
    viewScope: "settings_plans",
  },
  incomplete_expired: {
    action: "checkout",
    actionPath: "/plans",
    canBrowseApp: false,
    canExecute: false,
    viewScope: "settings_plans",
  },
  trialing: {
    action: "none",
    actionPath: "/app/settings?tab=billing",
    canBrowseApp: true,
    canExecute: true,
    viewScope: "app",
  },
  active: {
    action: "none",
    actionPath: null,
    canBrowseApp: true,
    canExecute: true,
    viewScope: "app",
  },
  past_due: {
    action: "portal",
    actionPath: "/app/settings?tab=billing",
    canBrowseApp: true,
    canExecute: false,
    viewScope: "app",
  },
  paused: {
    action: "portal",
    actionPath: "/app/settings?tab=billing",
    canBrowseApp: true,
    canExecute: false,
    viewScope: "app",
  },
  canceled: {
    action: "checkout",
    actionPath: "/plans",
    canBrowseApp: true,
    canExecute: false,
    viewScope: "app",
  },
  unpaid: {
    action: "portal",
    actionPath: "/app/settings?tab=billing",
    canBrowseApp: true,
    canExecute: false,
    viewScope: "app",
  },
};

export function subscriptionAccessFor(
  status: string,
): SubscriptionAccess | null {
  return SUBSCRIPTION_ACCESS[status as SubscriptionStatus] ?? null;
}

/** Shared execution gate for generation, posting, and automation mutations. */
export function requireExecutableSubscription(status: string): void {
  const access = subscriptionAccessFor(status);
  if (access?.canExecute) return;
  throw new AppError("subscription_required", {
    details: {
      missing: ["subscription"],
      settingsPath: access?.actionPath ?? "/plans",
      subscriptionStatus: status,
    },
  });
}

export interface SubscriptionBannerProfile {
  stripeCustomerId: string | null;
  subscriptionStatus: string;
  trialEndsAt: string | null;
}

export interface SubscriptionBannerModel {
  action: "checkout" | "portal" | null;
  description: string;
  title: string;
  tone: "info" | "warning";
}

function trialDate(value: string | null): string {
  if (!value) return "終了日を確認中です";
  return `${new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "long",
    timeZone: "Asia/Tokyo",
  }).format(new Date(value))}まで`;
}

export function subscriptionBannerFor(
  profile: SubscriptionBannerProfile,
): SubscriptionBannerModel | null {
  const status = profile.subscriptionStatus;
  if (status === "active") return null;
  if (status === "trialing") {
    return {
      action: null,
      description: `無料トライアルは${trialDate(profile.trialEndsAt)}です。`,
      title: "無料トライアル中",
      tone: "info",
    };
  }
  if (["past_due", "unpaid", "paused"].includes(status)) {
    return {
      action: profile.stripeCustomerId ? "portal" : "checkout",
      description:
        "既存データは閲覧できますが、生成・投稿・自動実行は停止しています。",
      title:
        status === "past_due"
          ? "お支払いを確認できませんでした"
          : "ご契約のお支払いが停止しています",
      tone: "warning",
    };
  }
  if (status === "canceled") {
    return {
      action: "checkout",
      description:
        "既存データは閲覧できます。再開するにはプランを選択してください。",
      title: "ご契約は終了しています",
      tone: "warning",
    };
  }
  return {
    action: "checkout",
    description: "プランを選択してお申し込みを完了してください。",
    title: "ご契約の開始が必要です",
    tone: "warning",
  };
}
