import type { PlanId } from "@/lib/plans";

import {
  startBillingRedirect,
  type BillingRedirectDependencies,
} from "./billing-redirect";

const DEFAULT_ERROR_MESSAGE =
  "決済画面を開けませんでした。時間をおいてもう一度お試しください。";

/** Starts server-owned Checkout and performs the only allowed external navigation. */
export async function startCheckout(
  plan: PlanId,
  dependencies?: BillingRedirectDependencies,
): Promise<void> {
  await startBillingRedirect(
    "/api/stripe/checkout",
    DEFAULT_ERROR_MESSAGE,
    dependencies,
    {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan }),
    },
  );
}
