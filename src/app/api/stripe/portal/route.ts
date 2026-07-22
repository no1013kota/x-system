import { getCurrentUser } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { issueBillingReturnCookie } from "@/lib/stripe/billing-return-server";
import { stripe } from "@/lib/stripe/client";
import { handlePortalRequest } from "@/lib/stripe/portal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const admin = createSupabaseAdminClient();
  const authentication: { userId?: string } = {};
  const response = await handlePortalRequest(request, {
    appBaseUrl: env.APP_BASE_URL as string,
    configurationId: env.STRIPE_PORTAL_CONFIGURATION_ID,
    async getCurrentUser() {
      const user = await getCurrentUser();
      authentication.userId = user?.id;
      return user;
    },
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
  if (response.ok && authentication.userId) {
    response.headers.append(
      "set-cookie",
      issueBillingReturnCookie(authentication.userId, "portal"),
    );
  }
  return response;
}
