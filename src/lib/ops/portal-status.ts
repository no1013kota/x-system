import "server-only";

import { judgePortalFeatures, type PortalFeatureSnapshot } from "@/lib/stripe/portal-features";

import type { Check } from "./diagnostics";

/**
 * Stripe の Portal Configuration を読み、画面のボタンが使える状態かを判定する（T-M8-32）。
 *
 * **相手側の設定はコードに現れない。** 2026-08-03、「プランを変更」が Stripe 側で無効なまま
 * ボタンだけ出ていて、押して初めて分かった。状態確認（doctor）で毎回見る。
 * 読み取りだけなので費用も副作用も無い。
 */

export interface PortalConfigurationGateway {
  billingPortal: {
    configurations: {
      retrieve(
        id: string,
        params?: { expand: string[] },
      ): Promise<{
        features?: {
          subscription_update?: {
            enabled?: boolean;
            trial_update_behavior?: string | null;
            proration_behavior?: string | null;
            /** `expand` したときだけ返る（未指定の設定では undefined）。 */
            products?: { product: string; prices: string[] }[] | null;
          };
          subscription_cancel?: { enabled?: boolean };
        } | null;
      }>;
    };
  };
  /** 解約前に提示するクーポンの実在確認（T-M8-272）。読み取りのみ。 */
  coupons?: { retrieve(id: string): Promise<{ id: string; valid?: boolean | null }> };
}

export interface PortalProbeDeps {
  configurationId?: string | null;
  stripe?: PortalConfigurationGateway | null;
  /** いまアプリが契約に使っている Price。変更先に入っているかを見る（T-M8-238）。 */
  expectedPriceIds?: string[];
  /** 解約前に提示するクーポン（`STRIPE_RETENTION_COUPON_ID`）。未設定なら undefined。 */
  retentionCouponId?: string | null;
}

export async function probePortalFeatures(
  deps: PortalProbeDeps,
): Promise<PortalFeatureSnapshot> {
  if (!deps.configurationId) return { features: null, configurationMissing: true };
  if (!deps.stripe) return { features: null };
  try {
    /*
      **`products` は expand しないと返らない**（T-M8-238）。素の retrieve では undefined になるため、
      「変更先の Price が旧価格のまま」という事故が検査から見えなかった。
    */
    const configuration = await deps.stripe.billingPortal.configurations.retrieve(
      deps.configurationId,
      { expand: ["features.subscription_update.products"] },
    );
    const update = configuration.features?.subscription_update;
    return {
      expectedPriceIds: deps.expectedPriceIds,
      features: configuration.features ?? {},
      subscriptionUpdate: {
        priceIds: update?.products
          ? update.products.flatMap((entry) => entry.prices)
          : undefined,
        trialUpdateBehavior: update?.trial_update_behavior ?? null,
        prorationBehavior: update?.proration_behavior ?? null,
      },
      retentionCoupon: await probeRetentionCoupon(deps),
    };
  } catch (error) {
    // **「設定IDが無い」と「Stripeへ届かない」を区別する**（T-M8-55）。
    // 前者は別環境の値が入っている典型的な事故で、待っても直らない。
    return { features: null, ...(isMissingResource(error) ? { configurationNotFound: true } : {}) };
  }
}

/** Stripe の `resource_missing`（No such ...）か。 */
function isMissingResource(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : "";
  return code === "resource_missing" || /No such configuration/i.test(message);
}

export function judgePortal(snapshot: PortalFeatureSnapshot): Check {
  const judged = judgePortalFeatures(snapshot);
  return {
    name: "プラン管理（Stripe）",
    level: judged.level,
    detail: judged.detail,
    // 判定側が次の一手を持っていればそれを使う（T-M8-128）。
    ...(judged.nextAction ? { nextAction: judged.nextAction } : {}),
    ...(judged.level === "error"
      ? {
          // **どの環境を直すかまで書く**（T-M8-49）。`--target` を必須にした（T-M8-35）のに
          // ここが旧形式のままで、運営者が言われた通り打つとエラーで止まっていた。
          // 原則2「原因が開発知識なしで辿れる」は、示したコマンドがそのまま動くことまで含む。
          nextAction:
            "`npm run stripe:portal:setup -- --target <local|staging|production>` を実行して" +
            "Stripe側の設定をコードへ合わせてください（IDは変わりません）。手順は docs/operations/deployment.md §1.4",
        }
      : {}),
  };
}

/**
 * 解約前に提示するクーポンの状態（T-M8-272）。**設定していない＝解約時に何も提示されない**ので、
 * 「未設定」と「設定はあるが無効（期限切れ・削除済み）」を区別して返す（原則1）。
 */
async function probeRetentionCoupon(
  deps: PortalProbeDeps,
): Promise<"unset" | "valid" | "invalid" | "unknown"> {
  if (!deps.retentionCouponId) return "unset";
  if (!deps.stripe?.coupons) return "unknown";
  try {
    const coupon = await deps.stripe.coupons.retrieve(deps.retentionCouponId);
    return coupon.valid === false ? "invalid" : "valid";
    // 存在しない（別環境のIDを入れている典型）も「無効」として扱う——待っても直らない。
    // eslint-disable-next-line no-restricted-syntax -- 失敗自体が答え（doctorの状態確認）。記録は判定文で運営者へ出す。
  } catch {
    return "invalid";
  }
}
