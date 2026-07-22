import { withTransaction } from "@/lib/db/pool";
import { env } from "@/lib/env";
import { captureServerException } from "@/lib/observability/sentry";
import { stripe } from "@/lib/stripe/client";
import { STRIPE_PRICE_IDS } from "@/lib/stripe/prices";
import {
  applyPreparedStripeEvent,
  prepareStripeEvent,
} from "@/lib/stripe/subscription-sync";
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
        applyEvent: (database, _event, prepared) =>
          applyPreparedStripeEvent(database, prepared).then(() => undefined),
        priceIds: STRIPE_PRICE_IDS,
        prepareEvent: (verifiedEvent) =>
          prepareStripeEvent(verifiedEvent, stripe, STRIPE_PRICE_IDS),
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
