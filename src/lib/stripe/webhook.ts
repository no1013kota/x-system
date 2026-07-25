import type { QueryResult } from "pg";
import type Stripe from "stripe";

import { AppError, toUserFacingError } from "@/lib/observability/errors";
import type { PlanId } from "@/lib/plans";

export const STRIPE_WEBHOOK_EVENT_TYPES = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
  "invoice.paid",
] as const;

const SUPPORTED_EVENT_TYPES = new Set<string>(STRIPE_WEBHOOK_EVENT_TYPES);

export interface StripeEventDatabase {
  query<T extends object = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<T>>;
}

export interface StripeEventProcessorDependencies {
  applyEvent?: (
    database: StripeEventDatabase,
    event: Stripe.Event,
    prepared: unknown,
  ) => Promise<void>;
  prepareEvent?: (event: Stripe.Event) => Promise<unknown>;
  priceIds: Record<PlanId, string>;
  transaction<T>(
    callback: (database: StripeEventDatabase) => Promise<T>,
  ): Promise<T>;
}

export type StripeEventProcessResult = "processed" | "duplicate" | "ignored";

export class UnknownStripePriceError extends Error {
  readonly eventId: string;
  readonly eventType: string;
  readonly priceId: string | null;

  constructor(event: Stripe.Event, priceId: string | null) {
    super("Stripe event contains an unknown Price ID.");
    this.name = "UnknownStripePriceError";
    this.eventId = event.id;
    this.eventType = event.type;
    this.priceId = priceId;
  }
}

function subscriptionPriceIds(event: Stripe.Event): string[] | null {
  if (!event.type.startsWith("customer.subscription.")) return null;
  const subscription = event.data.object as Stripe.Subscription;
  const items = subscription.items?.data;
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) =>
    typeof item.price?.id === "string" ? [item.price.id] : [],
  );
}

function validateEmbeddedPrices(
  event: Stripe.Event,
  priceIds: Record<PlanId, string>,
): void {
  const embedded = subscriptionPriceIds(event);
  if (embedded === null) return;

  const known = new Set(Object.values(priceIds));
  if (embedded.length !== 1 || !known.has(embedded[0])) {
    throw new UnknownStripePriceError(event, embedded[0] ?? null);
  }
}

function eventObjectId(event: Stripe.Event): string | null {
  const object = event.data.object as unknown as {
    id?: unknown;
    subscription?: unknown;
  };
  if (
    event.type === "checkout.session.completed" &&
    typeof object.subscription === "string"
  ) {
    return object.subscription;
  }
  return typeof object.id === "string" ? object.id : null;
}

/**
 * Claims a verified Stripe event and applies its business side effects in the
 * same transaction. Unknown Price IDs are rejected before the claim so Stripe
 * can retry after configuration is repaired.
 */
export async function processStripeEvent(
  event: Stripe.Event,
  dependencies: StripeEventProcessorDependencies,
): Promise<StripeEventProcessResult> {
  if (!SUPPORTED_EVENT_TYPES.has(event.type)) return "ignored";
  const prepared = dependencies.prepareEvent
    ? await dependencies.prepareEvent(event)
    : (validateEmbeddedPrices(event, dependencies.priceIds), undefined);

  return dependencies.transaction(async (database) => {
    const claimed = await database.query<{ event_id: string }>(
      `insert into stripe_events
        (event_id, type, object_id, event_created_at)
       values ($1, $2, $3, to_timestamp($4))
       on conflict (event_id) do nothing
       returning event_id`,
      [event.id, event.type, eventObjectId(event), event.created],
    );
    if ((claimed.rowCount ?? 0) === 0) return "duplicate";

    await dependencies.applyEvent?.(database, event, prepared);
    return "processed";
  });
}

export interface StripeWebhookRouteDependencies {
  captureException(
    error: unknown,
    context?: Record<string, unknown>,
  ): void;
  processEvent(event: Stripe.Event): Promise<StripeEventProcessResult>;
  verifyEvent(payload: string, signature: string): Stripe.Event;
}

function webhookResponse(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

/** Reads the request body exactly once and never parses it before verification. */
export async function handleStripeWebhookRequest(
  request: Request,
  dependencies: StripeWebhookRouteDependencies,
): Promise<Response> {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return webhookResponse(
      { ok: false, error: toUserFacingError(new AppError("forbidden")) },
      400,
    );
  }

  const payload = await request.text();
  let event: Stripe.Event;
  try {
    event = dependencies.verifyEvent(payload, signature);
  } catch {
    return webhookResponse(
      { ok: false, error: toUserFacingError(new AppError("forbidden")) },
      400,
    );
  }

  try {
    const result = await dependencies.processEvent(event);
    return webhookResponse(
      { ok: true, data: { received: true, result } },
      200,
    );
  } catch (error) {
    const context =
      error instanceof UnknownStripePriceError
        ? {
            event_id: error.eventId,
            event_type: error.eventType,
            price_id: error.priceId,
          }
        : { event_id: event.id, event_type: event.type };
    dependencies.captureException(error, context);
    return webhookResponse(
      { ok: false, error: toUserFacingError(new AppError("internal_error")) },
      500,
    );
  }
}
