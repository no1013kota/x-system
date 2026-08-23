import "server-only";

import { env } from "@/lib/env";

import type { PortalProbeDeps } from "./portal-status";
import type { PriceProbeDeps } from "./price-status";
import type { StripeAccountProbeDeps } from "./stripe-account-status";
import type { WebhookEventsProbeDeps } from "./webhook-events-status";

/**
 * Stripe を見る検査の入口をまとめて作る（T-M8-247）。
 *
 * **`doctor`（HTTP）と毎朝の運営者アラート（cron）で同じものを渡す。** 以前はアラート側が
 * Stripe の入口を1つも渡しておらず、実際には設定済みなのに毎日「未設定です」と送っていた
 * （事実と違う警告は読まれなくなる＝本当の異常も埋もれる・CLAUDE.md 原則2）。
 * 二重定義をやめ、片方だけ足し忘れる形をなくす。
 */
export interface StripeProbeDeps {
  portal: PortalProbeDeps;
  prices: PriceProbeDeps;
  stripeAccount: StripeAccountProbeDeps;
  webhookEvents: WebhookEventsProbeDeps;
}

export async function buildStripeProbeDeps(): Promise<StripeProbeDeps> {
  const stripe = env.STRIPE_SECRET_KEY ? (await import("@/lib/stripe/client")).stripe : null;
  const priceIds = {
    standard: env.STRIPE_PRICE_STANDARD_MONTHLY,
    expert: env.STRIPE_PRICE_EXPERT_MONTHLY,
    premium: env.STRIPE_PRICE_PREMIUM_MONTHLY,
  };
  return {
    portal: {
      configurationId: env.STRIPE_PORTAL_CONFIGURATION_ID,
      // 変更先に「いまの料金プラン」が入っているかまで見る（T-M8-238）。
      expectedPriceIds: Object.values(priceIds).filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      ),
      stripe,
    },
    prices: { priceIds, stripe },
    stripeAccount: { stripe, requireLiveCharges: env.APP_ENV === "production" },
    webhookEvents: {
      // デプロイ先だけ error にする（ローカルは `stripe listen` を常時動かさない）。
      expected: env.APP_ENV !== "development",
      stripe,
      webhookUrl: env.APP_BASE_URL ? `${env.APP_BASE_URL}/api/stripe/webhook` : null,
    },
  };
}
