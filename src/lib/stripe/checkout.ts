import type Stripe from "stripe";
import { z } from "zod";

import { apiError, apiJson } from "@/lib/http/api-response";
import { hasExactAppOrigin } from "@/lib/http/origin";
import { AppError } from "@/lib/observability/errors";
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
}

export interface CheckoutRouteDependencies {
  appBaseUrl: string;
  getCurrentUser(): Promise<CheckoutUser | null>;
  getProfile(userId: string): Promise<CheckoutProfile | null>;
  priceIds: Record<PlanId, string>;
  saveStripeCustomerId(userId: string, customerId: string): Promise<void>;
  stripe: CheckoutStripeGateway;
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
      { idempotencyKey: `space-ai:customer:${user.id}` },
    );
  } catch (cause) {
    throw new AppError("provider_error", { cause });
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
    return apiError(new AppError("provider_error", { cause: error }));
  }
}
