import { env } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  appendBillingReturnCookie,
  captureBillingUser,
} from "@/lib/stripe/billing-return-server";
import { stripe } from "@/lib/stripe/client";
import { handlePortalRequest } from "@/lib/stripe/portal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const admin = createSupabaseAdminClient();
  const billingUser = captureBillingUser();
  const response = await handlePortalRequest(request, {
    appBaseUrl: env.APP_BASE_URL as string,
    configurationId: env.STRIPE_PORTAL_CONFIGURATION_ID,
    getCurrentUser: billingUser.getCurrentUser,
    async getProfile(userId) {
      const result = await admin
        .from("profiles")
        .select("stripe_customer_id")
        .eq("id", userId)
        .maybeSingle();
      if (result.error) throw result.error;
      return result.data;
    },
    stripe,
  });
  return appendBillingReturnCookie(response, billingUser.capturedUserId(), "portal");
}
