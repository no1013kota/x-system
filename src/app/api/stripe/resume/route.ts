import { withTransaction } from "@/lib/db/pool";
import { env } from "@/lib/env";
import { getCurrentUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe/client";
import { STRIPE_PRICE_IDS } from "@/lib/stripe/prices";
import { handleResumeRequest } from "@/lib/stripe/resume";
import { applyPreparedStripeEvent } from "@/lib/stripe/subscription-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 解約済み契約の再開（T-M8-264）。保存済みカードで同じプランのsubscriptionを作り直し、
 * 応答をそのままDBへ反映する（Stripeへの画面遷移なし）。中核は `@/lib/stripe/resume`。
 */
export async function POST(request: Request): Promise<Response> {
  const admin = createSupabaseAdminClient();
  return handleResumeRequest(request, {
    appBaseUrl: env.APP_BASE_URL as string,
    async applyProjection(projection) {
      return withTransaction((database) =>
        applyPreparedStripeEvent(database, { kind: "subscription_sync", projection }),
      );
    },
    getCurrentUser,
    async getProfile(userId) {
      const result = await admin
        .from("profiles")
        .select("plan, stripe_customer_id")
        .eq("id", userId)
        .maybeSingle();
      if (result.error) throw result.error;
      return result.data;
    },
    now: () => Math.floor(Date.now() / 1000),
    priceIds: STRIPE_PRICE_IDS,
    stripe,
  });
}
