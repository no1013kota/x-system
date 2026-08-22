import type Stripe from "stripe";
import { z } from "zod";

import { apiError, apiJson } from "@/lib/http/api-response";
import { hasExactAppOrigin } from "@/lib/http/origin";
import { AppError } from "@/lib/observability/errors";

import { isLiveChargesDisabled } from "./stripe-errors";
import { PLAN_IDS, type PlanId } from "@/lib/plans";

export const checkoutInputSchema = z
  .object({
    plan: z.enum(PLAN_IDS),
  })
  .strict();

export interface CheckoutUser {
  id: string;
  email?: string | null;
}

export interface CheckoutProfile {
  stripe_customer_id: string | null;
  trial_used_at: string | null;
}

export interface CheckoutStripeGateway {
  customers: {
    create(
      params: Stripe.CustomerCreateParams,
      options?: Stripe.RequestOptions,
    ): Promise<{ id: string }>;
  };
  checkout: {
    sessions: {
      create(params: Stripe.Checkout.SessionCreateParams): Promise<{
        id: string;
        url: string | null;
      }>;
    };
  };
  /** 既存契約の確認（T-M8-237）。二重契約＝二重請求を作らないため Checkout の前に見る。 */
  subscriptions: {
    list(params: {
      customer: string;
      status: "all";
      limit: number;
    }): Promise<{ data: { id: string; status: string }[] }>;
  };
}

export interface CheckoutRouteDependencies {
  appBaseUrl: string;
  getCurrentUser(): Promise<CheckoutUser | null>;
  getProfile(userId: string): Promise<CheckoutProfile | null>;
  priceIds: Record<PlanId, string>;
  saveStripeCustomerId(userId: string, customerId: string): Promise<void>;
  stripe: CheckoutStripeGateway;
}

/**
 * Stripeの失敗を利用者向けコードへ振り分ける（T-M8-148）。
 *
 * **アカウントが本番決済を受け付けられない状態は `provider_error` にしない。**
 * その文言は「時間をおいて再度お試しください」で、待っても直らないので嘘になる
 * （T-M8-127と同じ型の問題）。原因は `doctor` の「決済の受付（Stripeアカウント）」が示す。
 */
function billingError(cause: unknown): AppError {
  if (isLiveChargesDisabled(cause)) {
    return new AppError("feature_disabled", {
      cause,
      details: { feature: "billing", reason: "live_charges_disabled" },
    });
  }
  return new AppError("provider_error", { cause });
}

async function createCustomer(
  deps: CheckoutRouteDependencies,
  user: CheckoutUser & { email: string },
): Promise<string> {
  let customer: { id: string };
  try {
    customer = await deps.stripe.customers.create(
      {
        email: user.email,
        metadata: { user_id: user.id },
      },
      { idempotencyKey: `exos-ai:customer:${user.id}` },
    );
  } catch (cause) {
    throw billingError(cause);
  }

  try {
    await deps.saveStripeCustomerId(user.id, customer.id);
  } catch (cause) {
    throw new AppError("internal_error", { cause });
  }
  return customer.id;
}

function sessionParams(input: {
  appBaseUrl: string;
  customerId: string;
  plan: PlanId;
  priceId: string;
  trialUsedAt: string | null;
  userId: string;
}): Stripe.Checkout.SessionCreateParams {
  const appBaseUrl = input.appBaseUrl.replace(/\/$/, "");
  return {
    mode: "subscription",
    // ブラウザ言語推定（auto）に任せず日本語へ固定する（T-M8-58）。日本語のみのサービスで、
    // 推定が外れたときに決済画面だけ英語になる方が混乱が大きい。
    locale: "ja",
    customer: input.customerId,
    client_reference_id: input.userId,
    line_items: [{ price: input.priceId, quantity: 1 }],
    payment_method_collection: "always",
    success_url: `${appBaseUrl}/api/stripe/return?source=checkout&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appBaseUrl}/plans?checkout=canceled`,
    metadata: {
      plan: input.plan,
      user_id: input.userId,
    },
    subscription_data: {
      metadata: {
        plan: input.plan,
        user_id: input.userId,
      },
      ...(input.trialUsedAt === null ? { trial_period_days: 7 } : {}),
    },
  };
}

/**
 * 「もう契約がある」とみなす status（T-M8-237）。`canceled`・`incomplete_expired` は
 * 契約し直せる状態なので含めない。`incomplete` は支払い未完了のまま残っている Checkout の
 * 途中なので、作り直せるよう含めない。
 */
const LIVE_SUBSCRIPTION_STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "paused",
]);

/** Implements the authenticated, same-origin Checkout API with injectable I/O. */
export async function handleCheckoutRequest(
  request: Request,
  deps: CheckoutRouteDependencies,
): Promise<Response> {
  if (!hasExactAppOrigin(request.headers.get("origin"), deps.appBaseUrl)) {
    return apiError(new AppError("forbidden"));
  }

  const parsed = checkoutInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return apiError(new AppError("validation_error"));
  }

  let user: CheckoutUser | null;
  try {
    user = await deps.getCurrentUser();
  } catch (error) {
    // cause を捨てると apiError の記録に原因が乗らない（要件01 §8）。
    return apiError(new AppError("internal_error", { cause: error }));
  }
  if (!user) return apiError(new AppError("unauthorized"));
  if (!user.email) return apiError(new AppError("internal_error"));

  let profile: CheckoutProfile | null;
  try {
    profile = await deps.getProfile(user.id);
  } catch (error) {
    // cause を捨てると apiError の記録に原因が乗らない（要件01 §8）。
    return apiError(new AppError("internal_error", { cause: error }));
  }
  if (!profile) return apiError(new AppError("internal_error"));

  try {
    const customerId =
      profile.stripe_customer_id ??
      (await createCustomer(deps, user as CheckoutUser & { email: string }));

    /*
      **既に契約があるなら Checkout を作らない**（T-M8-237）。Stripeは同じCustomerに複数の
      subscription を許すので、押した回数だけ契約＝請求ができてしまう。画面側は
      `/plans` からの送り返しで防いでいたが、その条件は `trialing`/`active` だけで、
      **`past_due`・`unpaid`・`paused` の利用者は `/plans` に留まりCTAが押せる**。
      その状態で押すと `trial_used_at` は既にあるのでトライアルも付かず、満額の2本目が走る。
      プラン変更・支払い方法の更新は Portal が担うので、ここでは作らずそちらへ誘導する。
    */
    if (profile.stripe_customer_id) {
      const existing = await deps.stripe.subscriptions.list({
        customer: customerId,
        limit: 10,
        status: "all",
      });
      const live = existing.data.find((sub) => LIVE_SUBSCRIPTION_STATUSES.has(sub.status));
      if (live) {
        return apiError(
          new AppError("subscription_required", {
            details: {
              missing: ["subscription"],
              reason: "already_subscribed",
              settingsPath: "/app/settings?tab=billing",
            },
          }),
        );
      }
    }

    const session = await deps.stripe.checkout.sessions.create(
      sessionParams({
        appBaseUrl: deps.appBaseUrl,
        customerId,
        plan: parsed.data.plan,
        priceId: deps.priceIds[parsed.data.plan],
        trialUsedAt: profile.trial_used_at,
        userId: user.id,
      }),
    );
    if (!session.url) throw new Error("Checkout Session URL is missing");

    return apiJson({
      ok: true,
      data: { url: session.url },
    });
  } catch (error) {
    if (error instanceof AppError) return apiError(error);
    return apiError(billingError(error));
  }
}
