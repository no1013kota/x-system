import { type NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { withTransaction } from "@/lib/db/pool";
import { env } from "@/lib/env";
import { captureServerException } from "@/lib/observability/sentry";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { reconcileBillingReturn } from "@/lib/stripe/billing-return";
import {
  BILLING_RETURN_COOKIE,
  clearBillingReturnCookieHeader,
  type BillingReturnSource,
} from "@/lib/stripe/billing-return-marker";
import { readBillingReturnMarker } from "@/lib/stripe/billing-return-server";
import { stripe } from "@/lib/stripe/client";
import { STRIPE_PRICE_IDS } from "@/lib/stripe/prices";
import { applyPreparedStripeEvent } from "@/lib/stripe/subscription-sync";
import { bumpUsageEpochSql, restoreUsageEpochSql } from "@/lib/usage/usage-period";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function targetPath(source: BillingReturnSource, sync: string): string {
  return source === "checkout"
    ? `/plans?checkout=success&sync=${sync}`
    : `/app/settings?tab=billing&portal=return&sync=${sync}`;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const source = request.nextUrl.searchParams.get("source");
  if (source !== "checkout" && source !== "portal") {
    return NextResponse.redirect(new URL("/plans", env.APP_BASE_URL));
  }

  const user = await getCurrentUser();
  const canonical = targetPath(source, "skipped");
  if (!user) {
    return NextResponse.redirect(
      new URL(`/login?next=${encodeURIComponent(canonical)}`, env.APP_BASE_URL),
    );
  }

  let sync = "skipped";
  try {
    const rawMarker = request.cookies.get(BILLING_RETURN_COOKIE)?.value;
    const marker = rawMarker ? readBillingReturnMarker(rawMarker) : null;
    const admin = createSupabaseAdminClient();
    sync = await reconcileBillingReturn(
      {
        marker,
        sessionId: request.nextUrl.searchParams.get("session_id"),
        source,
        userId: user.id,
      },
      {
        async applyProjection(projection) {
          return withTransaction((database) =>
            applyPreparedStripeEvent(database, {
              kind: "subscription_sync",
              projection,
            }),
          );
        },
        async getProfile(userId) {
          const result = await admin
            .from("profiles")
            .select(
              "stripe_customer_id, stripe_subscription_id, subscription_event_created_at, plan",
            )
            .eq("id", userId)
            .maybeSingle();
          if (result.error) throw result.error;
          return result.data;
        },
        now: () => Math.floor(Date.now() / 1000),
        priceIds: STRIPE_PRICE_IDS,
        /*
          トライアル中に下位プランへ切り替えたときだけ枠を0へ戻す（T-M8-299）。
          `usage_events` は消さない（原価の台帳）。世代を進めて集計だけ数え直しにする。
        */
        async resetUsage(userId) {
          await withTransaction((database) =>
            database.query(bumpUsageEpochSql("$1"), [userId]),
          );
        },
        /*
          上位へ戻したら世代も戻す（T-M8-306）。戻した先には消費済みの行が残っているので、
          「下げてリセット→上げ直す」を繰り返しても枠は増えない。
        */
        async restoreUsage(userId) {
          await withTransaction((database) =>
            database.query(restoreUsageEpochSql("$1"), [userId]),
          );
        },
        stripe,
      },
    );
  } catch (error) {
    sync = "pending";
    captureServerException(error, { billing_return_source: source });
  }

  const response = NextResponse.redirect(
    new URL(targetPath(source, sync), env.APP_BASE_URL),
  );
  response.headers.append(
    "set-cookie",
    clearBillingReturnCookieHeader(env.APP_ENV === "production"),
  );
  return response;
}
