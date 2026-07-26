import type Stripe from "stripe";

import { apiError, apiJson } from "@/lib/http/api-response";
import { hasExactAppOrigin } from "@/lib/http/origin";
import { AppError } from "@/lib/observability/errors";

export interface PortalProfile {
  stripe_customer_id: string | null;
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
  try {
    const session = await deps.stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${baseUrl}/api/stripe/return?source=portal`,
      ...(deps.configurationId
        ? { configuration: deps.configurationId }
        : {}),
    });
    return apiJson({ ok: true, data: { url: session.url } });
  } catch (cause) {
    return apiError(new AppError("provider_error", { cause }));
  }
}
