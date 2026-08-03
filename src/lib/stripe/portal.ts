import type Stripe from "stripe";

import { apiError, apiJson } from "@/lib/http/api-response";
import { hasExactAppOrigin } from "@/lib/http/origin";
import { AppError } from "@/lib/observability/errors";

export interface PortalProfile {
  stripe_customer_id: string | null;
  /** 契約中のsubscription。特定の操作（プラン変更・解約）へ直接入るのに要る。 */
  stripe_subscription_id?: string | null;
}

/**
 * Portalのどの画面へ入るか（T-M8-31）。
 *
 * 「プランを管理」という1つのボタンだと、押した先で何ができるのかが分からない。
 * **やりたいことを先に選ばせて、Stripeの該当画面へ直接入る**（`flow_data`）。
 * - `update`: プラン変更（価格の選び直し）
 * - `cancel`: 解約（期間末）
 * 未指定・subscriptionが分からないときはPortalのトップへ入る（従来と同じ）。
 */
export type PortalIntent = "update" | "cancel";

const PORTAL_INTENTS: readonly PortalIntent[] = ["update", "cancel"];

function intentFromBody(body: unknown): PortalIntent | null {
  if (!body || typeof body !== "object") return null;
  const value = (body as { intent?: unknown }).intent;
  return PORTAL_INTENTS.includes(value as PortalIntent) ? (value as PortalIntent) : null;
}

/**
 * `flow_data` を組む。**subscriptionが分からないときは組まない**（Stripeが400を返すため、
 * 「押しても開かない」より「Portalのトップが開く」方が利用者にとって良い）。
 */
export function portalFlowData(
  intent: PortalIntent | null,
  subscriptionId: string | null | undefined,
  returnUrl: string,
): Stripe.BillingPortal.SessionCreateParams.FlowData | undefined {
  if (!intent || !subscriptionId) return undefined;
  const after = { after_completion: { type: "redirect" as const, redirect: { return_url: returnUrl } } };
  if (intent === "cancel") {
    return { type: "subscription_cancel", subscription_cancel: { subscription: subscriptionId }, ...after };
  }
  return {
    type: "subscription_update",
    subscription_update: { subscription: subscriptionId },
    ...after,
  };
}

export interface PortalStripeGateway {
  billingPortal: {
    sessions: {
      create(params: Stripe.BillingPortal.SessionCreateParams): Promise<{
        url: string;
      }>;
    };
  };
}

export interface PortalRouteDependencies {
  appBaseUrl: string;
  configurationId?: string;
  getCurrentUser(): Promise<{ id: string } | null>;
  getProfile(userId: string): Promise<PortalProfile | null>;
  stripe: PortalStripeGateway;
}

/** Creates a short-lived Customer Portal URL from server-owned parameters. */
export async function handlePortalRequest(
  request: Request,
  deps: PortalRouteDependencies,
): Promise<Response> {
  if (!hasExactAppOrigin(request.headers.get("origin"), deps.appBaseUrl)) {
    return apiError(new AppError("forbidden"));
  }

  let user: { id: string } | null;
  try {
    user = await deps.getCurrentUser();
  } catch (error) {
    // cause を捨てると apiError の記録に原因が乗らない（要件01 §8）。
    return apiError(new AppError("internal_error", { cause: error }));
  }
  if (!user) return apiError(new AppError("unauthorized"));

  let profile: PortalProfile | null;
  try {
    profile = await deps.getProfile(user.id);
  } catch (error) {
    // cause を捨てると apiError の記録に原因が乗らない（要件01 §8）。
    return apiError(new AppError("internal_error", { cause: error }));
  }
  if (!profile) return apiError(new AppError("internal_error"));
  if (!profile.stripe_customer_id) {
    return apiError(
      new AppError("subscription_required", {
        details: { settingsPath: "/plans" },
      }),
    );
  }

  const baseUrl = deps.appBaseUrl.replace(/\/$/, "");
  const returnUrl = `${baseUrl}/api/stripe/return?source=portal`;
  // 本文が無い・壊れていても続行する（intent無し＝Portalのトップ）。
  const intent = intentFromBody(await request.json().catch(() => null));
  try {
    const session = await deps.stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: returnUrl,
      ...(deps.configurationId
        ? { configuration: deps.configurationId }
        : {}),
      ...(() => {
        const flowData = portalFlowData(intent, profile.stripe_subscription_id, returnUrl);
        return flowData ? { flow_data: flowData } : {};
      })(),
    });
    return apiJson({ ok: true, data: { url: session.url } });
  } catch (cause) {
    return apiError(new AppError("provider_error", { cause }));
  }
}
