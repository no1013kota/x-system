import { env } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  appendBillingReturnCookie,
  captureBillingUser,
} from "@/lib/stripe/billing-return-server";
import { handleCheckoutRequest } from "@/lib/stripe/checkout";
import { stripe } from "@/lib/stripe/client";
import { STRIPE_PRICE_IDS } from "@/lib/stripe/prices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const admin = createSupabaseAdminClient();
  const billingUser = captureBillingUser();

  const response = await handleCheckoutRequest(request, {
    appBaseUrl: env.APP_BASE_URL as string,
    getCurrentUser: billingUser.getCurrentUser,
    async getProfile(userId) {
      const result = await admin
        .from("profiles")
        .select("stripe_customer_id, trial_used_at")
        .eq("id", userId)
        .maybeSingle();
      if (result.error) throw result.error;
      return result.data;
    },
    priceIds: STRIPE_PRICE_IDS,
    async saveStripeCustomerId(userId, customerId) {
      const result = await admin
        .from("profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", userId)
        .is("stripe_customer_id", null);
      if (result.error) throw result.error;
    },
    stripe,
  });
  return appendBillingReturnCookie(response, billingUser.capturedUserId(), "checkout");
}
