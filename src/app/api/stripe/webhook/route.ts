import { withTransaction } from "@/lib/db/pool";
import { env } from "@/lib/env";
import { captureServerException } from "@/lib/observability/sentry";
import { stripe } from "@/lib/stripe/client";
import { STRIPE_PRICE_IDS } from "@/lib/stripe/prices";
import {
  handleStripeWebhookRequest,
  processStripeEvent,
} from "@/lib/stripe/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request): Promise<Response> {
  return handleStripeWebhookRequest(request, {
    captureException: captureServerException,
    processEvent: (event) =>
      processStripeEvent(event, {
        priceIds: STRIPE_PRICE_IDS,
        transaction: withTransaction,
      }),
    verifyEvent: (payload, signature) =>
      stripe.webhooks.constructEvent(
        payload,
        signature,
        env.STRIPE_WEBHOOK_SECRET as string,
      ),
  });
}
