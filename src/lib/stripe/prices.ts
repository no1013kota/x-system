import "server-only";

import { env } from "@/lib/env";
import type { PlanId } from "@/lib/plans";

/** Server-owned Stripe Price IDs. Never accept these values from a client. */
export const STRIPE_PRICE_IDS: Record<PlanId, string> = {
  standard: env.STRIPE_PRICE_STANDARD_MONTHLY as string,
  md: env.STRIPE_PRICE_MD_MONTHLY as string,
  premium: env.STRIPE_PRICE_PREMIUM_MONTHLY as string,
};
