import "server-only";

import Stripe from "stripe";

import { env } from "@/lib/env";

/** API version bundled with stripe@22.3.2; update deliberately with the SDK. */
export const STRIPE_API_VERSION = "2026-06-24.dahlia" as const;

export const stripe = new Stripe(env.STRIPE_SECRET_KEY as string, {
  apiVersion: STRIPE_API_VERSION,
  appInfo: {
    name: "Space AI",
  },
});
