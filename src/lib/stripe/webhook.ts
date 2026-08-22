import type { QueryResult } from "pg";
import type Stripe from "stripe";

import { AppError, toUserFacingError } from "@/lib/observability/errors";
import type { PlanId } from "@/lib/plans";
import { recordUnexpectedError } from "../observability/sentry";

export const STRIPE_WEBHOOK_EVENT_TYPES = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
  "invoice.paid",
  // 招待報酬のRefund取消（T-M8-174）。Stripeダッシュボードのwebhook設定にも追加が要る。
  "charge.refunded",
  /*
    無料トライアル終了の3日前にStripeが送る（T-M8-243）。**初回課金の予告**に使う——
    「いつ・いくら請求されるか」を知らせないまま満額を引き落とすのは、
    LPの「7日間は無料」と合わせて不意打ちになる。
    購読設定の不足は doctor の「契約イベントの受け取り（Stripe webhook）」が検出する。
  */
  "customer.subscription.trial_will_end",
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

/**
 * **再送しても直らない失敗か**（T-M8-245）。人が設定やデータを直すまで永久に失敗する種類。
 * これらに500を返し続けると Stripe が endpoint を無効化し、他の利用者の同期まで止まる。
 */
export function isPermanentEventError(error: unknown): boolean {
  if (error instanceof UnknownStripePriceError) return true;
  // profile の対応が付かない／曖昧（別環境のCustomer・手作業の取り違えなど）。
  const message = error instanceof Error ? error.message : "";
  return /Subscription profile mapping/.test(message);
}

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
  } catch (error) {
    // 署名検証の失敗。攻撃だけでなく STRIPE_WEBHOOK_SECRET の設定ミスでも起き、その場合は
    // 全webhookが黙って400になり課金同期が永久に止まる。無記録にはしない。
    recordUnexpectedError(error, { at: "stripe-webhook:verify" });
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
    /*
      **再送しても直らない失敗に500を返し続けない**（T-M8-245）。

      Stripeは500を返したイベントを最大3日リトライし、失敗が続くと**endpoint 自体を無効化する**。
      未知のPrice IDや profile の対応不能は、待っても再送しても直らない（人が設定を直すまで
      永久に失敗する）。その1件のために endpoint が止まると、**他の全利用者の契約同期まで
      巻き添えで停止する**。恒久エラーは記録して200を返し、再送で直りうるもの（DB障害など）
      だけ500にする。記録は Sentry（上の captureException）と doctor の
      「契約の同期（Stripe → アプリ）」が担う。
    */
    if (isPermanentEventError(error)) {
      return webhookResponse(
        { ok: true, data: { received: true, result: "permanent_error" } },
        200,
      );
    }
    return webhookResponse(
      { ok: false, error: toUserFacingError(new AppError("internal_error")) },
      500,
    );
  }
}
