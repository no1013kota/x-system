import { DB_ENUMS } from "@/lib/db/enums";
import { AppError } from "@/lib/observability/errors";

export type SubscriptionStatus =
  (typeof DB_ENUMS.subscription_status)[number];

export interface SubscriptionAccess {
  actionPath: "/app/settings?tab=billing" | "/plans" | null;
  canExecute: boolean;
  viewScope: "app" | "settings_plans";
}

export const SUBSCRIPTION_ACCESS: Record<
  SubscriptionStatus,
  SubscriptionAccess
> = {
  incomplete: {
    actionPath: "/plans",
    canExecute: false,
    viewScope: "settings_plans",
  },
  incomplete_expired: {
    actionPath: "/plans",
    canExecute: false,
    viewScope: "settings_plans",
  },
  trialing: {
    actionPath: "/app/settings?tab=billing",
    canExecute: true,
    viewScope: "app",
  },
  active: {
    actionPath: null,
    canExecute: true,
    viewScope: "app",
  },
  past_due: {
    actionPath: "/app/settings?tab=billing",
    canExecute: false,
    viewScope: "app",
  },
  paused: {
    actionPath: "/app/settings?tab=billing",
    canExecute: false,
    viewScope: "app",
  },
  canceled: {
    actionPath: "/plans",
    canExecute: false,
    viewScope: "app",
  },
  unpaid: {
    actionPath: "/app/settings?tab=billing",
    canExecute: false,
    viewScope: "app",
  },
};

/**
 * 生成・投稿・自動実行を許す status（T-M8-249）。**`SUBSCRIPTION_ACCESS` から導出する**——
 * 以前は `'trialing', 'active'` がSQLとTSへ直書きされており、可否を変えるときに
 * 片方だけ直す形になっていた（表と実装がずれても誰も気付けない）。
 */
export const EXECUTABLE_SUBSCRIPTION_STATUSES = (
  Object.keys(SUBSCRIPTION_ACCESS) as SubscriptionStatus[]
).filter((status) => SUBSCRIPTION_ACCESS[status].canExecute);

export function subscriptionAccessFor(
  status: string,
): SubscriptionAccess | null {
  return SUBSCRIPTION_ACCESS[status as SubscriptionStatus] ?? null;
}

/**
 * 「反映が届いていない疑い」を見る猶予（T-M8-235）。
 *
 * 契約の期限が切れても、更新の webhook が届くまでにはわずかな時間差がある。ここを0にすると
 * **支払っている利用者が更新の瞬間に締め出される**——それは反対向きの、もっと重い不具合になる。
 * 逆に守りたいのは「webhookが数日届かないあいだ、解約済みの人が使い続けられる」ケースなので、
 * 1日あれば足りる（更新の失敗は `past_due` になり、この判定を待たずに止まる）。
 */
export const SUBSCRIPTION_STALE_GRACE_MS = 24 * 60 * 60 * 1000;

export interface SubscriptionPeriod {
  /** `profiles.trial_ends_at`（trialing のときの期限）。 */
  trialEndsAt?: string | null;
  /** `profiles.current_period_end`（active のときの期限）。 */
  currentPeriodEnd?: string | null;
}

/**
 * **DBの状態が生きているのに、支払い済み期間が終わっている**状態か（T-M8-235）。
 *
 * `profiles` を更新する経路は Stripe の webhook だけなので、届かなくなると解約・期間満了が
 * 反映されず `trialing`/`active` のまま残る。実データでも、Stripe側は `canceled` なのに
 * DBは `trialing` のままで使い続けられるアカウントがあった。**日付は既に持っているのに
 * 判定に使っていなかった**ので、期限＋猶予を過ぎていたら実行を止める。
 *
 * 期限が入っていない（null・空・解釈できない）ときは **false**（＝止めない）。
 * 分からないことを理由に締め出さない——止めるのは「期限切れだと分かっている」ときだけ。
 */
export function isSubscriptionPeriodStale(
  status: string,
  period: SubscriptionPeriod,
  now: Date = new Date(),
): boolean {
  const raw =
    status === "trialing"
      ? period.trialEndsAt
      : status === "active"
        ? period.currentPeriodEnd
        : null;
  if (!raw) return false;
  const endsAt = Date.parse(raw);
  if (Number.isNaN(endsAt)) return false;
  return now.getTime() > endsAt + SUBSCRIPTION_STALE_GRACE_MS;
}

/** True when the status grants access to the app body (viewScope === "app"). */
export function canBrowseApp(status: string): boolean {
  return subscriptionAccessFor(status)?.viewScope === "app";
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
