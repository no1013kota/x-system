import { DB_ENUMS } from "@/lib/db/enums";
import { AppError } from "@/lib/observability/errors";

export type SubscriptionStatus =
  (typeof DB_ENUMS.subscription_status)[number];

export interface SubscriptionAccess {
  /** 実行できないときに案内する場所。 */
  actionPath: "/app/settings?tab=billing" | "/plans" | null;
  /** 生成・投稿・自動実行を許すか。**画面の閲覧可否はここでは決めない**（T-M8-268）。 */
  canExecute: boolean;
}

export const SUBSCRIPTION_ACCESS: Record<
  SubscriptionStatus,
  SubscriptionAccess
> = {
  incomplete: {
    actionPath: "/plans",
    canExecute: false,
  },
  incomplete_expired: {
    actionPath: "/plans",
    canExecute: false,
  },
  trialing: {
    actionPath: "/app/settings?tab=billing",
    canExecute: true,
  },
  active: {
    actionPath: null,
    canExecute: true,
  },
  past_due: {
    actionPath: "/app/settings?tab=billing",
    canExecute: false,
  },
  paused: {
    actionPath: "/app/settings?tab=billing",
    canExecute: false,
  },
  canceled: {
    actionPath: "/plans",
    canExecute: false,
  },
  unpaid: {
    actionPath: "/app/settings?tab=billing",
    canExecute: false,
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

/**
 * **プランの選択・再開が先に必要な状態か**（T-M8-269・運営者の指示 2026-08-23）。
 *
 * 未契約（`incomplete`系）と解約済み（`canceled`）は、機能画面そのものをロックして
 * 「先にプランを登録してください」と出す（触れるのは友達招待と設定＞課金・プランだけ）。
 * 支払いが滞っているだけの状態（`past_due`／`unpaid`／`paused`）は**含めない**——
 * 直し方が違い（プラン選択ではなく支払い更新）、閲覧まで止めると復旧の判断材料も消える。
 *
 * 判定は `actionPath` から導く（`/plans` へ案内する＝プランが要る状態）。未知のstatusは
 * ロック側へ倒す（fail closed）。
 */
export function requiresPlanSelection(status: string): boolean {
  const access = subscriptionAccessFor(status);
  if (!access) return true;
  return !access.canExecute && access.actionPath === "/plans";
}

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
  /** 期間末で解約する予約が入っているか（T-M8-253）。 */
  cancelAtPeriodEnd?: boolean;
  /** 解約が効く日（`active` のときの期間末）。 */
  currentPeriodEnd?: string | null;
  /** 期間末で切り替わる下位プランの予約（T-M8-260）。設定の課金タブの表示と同じ文。 */
  scheduledPlanChange?: string | null;
}

export interface SubscriptionBannerModel {
  /** `billing` は設定の課金タブへ（予約の取り消しはそこで行う・T-M8-260）。 */
  action: "checkout" | "portal" | "billing" | null;
  /**
   * 解約が予約済みか。`portal` のボタンは「解約する」ではなく「解約予定を取り消す」を出す
   * （「◯日に解約されます」の横に「解約する」が並んでいた・T-M8-55 のE2Eで検出）。
   */
  cancelAtPeriodEnd?: boolean;
  description: string;
  title: string;
  tone: "info" | "warning";
}

/** 「◯月◯日」。日付が無い・壊れているときは存在しない日付を作らない（T-M8-253）。 */
function planEndDate(value: string | null | undefined): string {
  if (!value) return "現在の期間の終了日";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "現在の期間の終了日";
  return new Intl.DateTimeFormat("ja-JP", { dateStyle: "long", timeZone: "Asia/Tokyo" }).format(at);
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
  /*
    **解約の予約は必ず知らせる**（T-M8-253）。以前は `active` で常に null を返し、
    トライアル中に解約した人には「無料トライアル中」としか出ていなかった。
    「解約したつもりが続いている」「続けるつもりが止まる」のどちらも起こりうる。
  */
  if (profile.cancelAtPeriodEnd) {
    const endsAt = status === "trialing" ? profile.trialEndsAt : profile.currentPeriodEnd;
    return {
      action: profile.stripeCustomerId ? "portal" : null,
      cancelAtPeriodEnd: true,
      description: "それまでは今までどおりご利用いただけます。続ける場合は解約の取り消しができます。",
      title: `${planEndDate(endsAt)}に解約されます`,
      tone: "info",
    };
  }
  /*
    **下位プランへの予約も知らせる**（T-M8-260）。「今のプランのまま続ける」は Portal に無く、
    取り消したい人が行き先を探すことになる。設定の課金タブに取り消しがある。
  */
  if (profile.scheduledPlanChange && (status === "active" || status === "trialing")) {
    return {
      action: "billing",
      description: "それまでは今のプランのままご利用いただけます。予約の取り消しは設定の「課金・プラン」からできます。",
      title: profile.scheduledPlanChange,
      tone: "info",
    };
  }
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
      // 何が使えて何が使えないかを正確に言う（T-M8-269で機能画面はロック・招待だけ残る）。
      description:
        "友達招待は引き続きご利用いただけます。投稿の作成・予約・分析やニュースを再びご利用になるには、プランを再開してください（データは保持しています）。",
      title: "ご契約は終了しています",
      tone: "warning",
    };
  }
  // 未契約（incomplete 等）。できること／できないことを正直に言う（T-M8-269）。
  return {
    action: "checkout",
    description:
      "友達招待はプランの登録がなくてもご利用いただけます。投稿の作成・予約・分析やニュースをご利用になるには、プランの登録が必要です。",
    title: "プランが未登録です",
    tone: "warning",
  };
}
