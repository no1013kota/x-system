import type Stripe from "stripe";

import { hasExactAppOrigin } from "@/lib/http/origin";
import {
  AppError,
  type ErrorCode,
  toUserFacingError,
} from "@/lib/observability/errors";

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

const HTTP_STATUS: Record<ErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  validation_error: 400,
  legal_consent_required: 403,
  subscription_required: 402,
  usage_limit_exceeded: 403,
  x_account_required: 400,
  api_key_required: 400,
  persona_required: 400,
  feature_disabled: 403,
  provider_error: 502,
  post_state_unknown: 409,
  job_conflict: 409,
  not_found: 404,
  internal_error: 500,
};

function response(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function errorResponse(error: unknown): Response {
  const safe = toUserFacingError(error);
  return response({ ok: false, error: safe }, HTTP_STATUS[safe.code]);
}

/** Creates a short-lived Customer Portal URL from server-owned parameters. */
export async function handlePortalRequest(
  request: Request,
  deps: PortalRouteDependencies,
): Promise<Response> {
  if (!hasExactAppOrigin(request.headers.get("origin"), deps.appBaseUrl)) {
    return errorResponse(new AppError("forbidden"));
  }

  let user: { id: string } | null;
  try {
    user = await deps.getCurrentUser();
  } catch {
    return errorResponse(new AppError("internal_error"));
  }
  if (!user) return errorResponse(new AppError("unauthorized"));

  let profile: PortalProfile | null;
  try {
    profile = await deps.getProfile(user.id);
  } catch {
    return errorResponse(new AppError("internal_error"));
  }
  if (!profile) return errorResponse(new AppError("internal_error"));
  if (!profile.stripe_customer_id) {
    return errorResponse(
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
    return response({ ok: true, data: { url: session.url } });
  } catch (cause) {
    return errorResponse(new AppError("provider_error", { cause }));
  }
}
