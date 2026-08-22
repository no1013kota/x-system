import type { QueryResult } from "pg";
import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

import { UnknownStripePriceError, handleStripeWebhookRequest, isPermanentEventError, processStripeEvent, type StripeEventDatabase } from "./webhook";

const WEBHOOK_SECRET = "whsec_test_exos_ai";
const stripe = new Stripe("sk_test_not_used");
const priceIds = {
  standard: "price_standard",
  expert: "price_expert",
  premium: "price_premium",
} as const;

function eventPayload(input?: {
  eventId?: string;
  eventType?: string;
  priceId?: string;
}): string {
  return JSON.stringify({
    id: input?.eventId ?? "evt_test_001",
    object: "event",
    api_version: "2026-06-24.dahlia",
    created: 1_784_675_200,
    data: {
      object: {
        id: "sub_test_001",
        object: "subscription",
        items: {
          data: [
            {
              id: "si_test_001",
              price: { id: input?.priceId ?? "price_standard" },
            },
          ],
        },
      },
    },
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type: input?.eventType ?? "customer.subscription.updated",
  });
}

function signedRequest(payload: string, signature?: string): Request {
  const header =
    signature ??
    stripe.webhooks.generateTestHeaderString({
      payload,
      secret: WEBHOOK_SECRET,
    });
  return new Request("https://app.example.com/api/stripe/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": header,
    },
    body: payload,
  });
}

function memoryDatabase() {
  const rows = new Map<string, unknown[]>();
  const database: StripeEventDatabase = {
    query: vi.fn(async (_sql: string, values?: unknown[]) => {
      const eventId = String(values?.[0]);
      const duplicate = rows.has(eventId);
      if (!duplicate) rows.set(eventId, values ?? []);
      return {
        command: "INSERT",
        fields: [],
        oid: 0,
        rowCount: duplicate ? 0 : 1,
        rows: duplicate ? [] : [{ event_id: eventId }],
      } as QueryResult;
    }),
  };
  return { database, rows };
}

function routeDependencies(database: StripeEventDatabase) {
  const captureException = vi.fn();
  const applyEvent = vi.fn(async () => undefined);
  return {
    applyEvent,
    captureException,
    dependencies: {
      captureException,
      processEvent: (event: Stripe.Event) =>
        processStripeEvent(event, {
          applyEvent,
          priceIds,
          transaction: <T>(
            callback: (db: StripeEventDatabase) => Promise<T>,
          ): Promise<T> => callback(database),
        }),
      verifyEvent: (payload: string, signature: string) =>
        stripe.webhooks.constructEvent(payload, signature, WEBHOOK_SECRET),
    },
  };
}

describe("Stripe webhook foundation", () => {
  it("rejects a missing or invalid signature without processing", async () => {
    const { database } = memoryDatabase();
    const deps = routeDependencies(database);
    const payload = eventPayload();

    const missing = await handleStripeWebhookRequest(
      new Request("https://app.example.com/api/stripe/webhook", {
        method: "POST",
        body: payload,
      }),
      deps.dependencies,
    );
    const invalid = await handleStripeWebhookRequest(
      signedRequest(payload, "t=1,v1=invalid"),
      deps.dependencies,
    );

    expect(missing.status).toBe(400);
    expect(invalid.status).toBe(400);
    expect(database.query).not.toHaveBeenCalled();
    expect(deps.captureException).not.toHaveBeenCalled();
  });

  it("verifies an SDK-generated signature and records the event", async () => {
    const store = memoryDatabase();
    const deps = routeDependencies(store.database);
    const response = await handleStripeWebhookRequest(
      signedRequest(eventPayload()),
      deps.dependencies,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: { received: true, result: "processed" },
    });
    expect(store.rows.has("evt_test_001")).toBe(true);
    expect(deps.applyEvent).toHaveBeenCalledTimes(1);
  });

  it("acknowledges a duplicate event without repeating side effects", async () => {
    const store = memoryDatabase();
    const deps = routeDependencies(store.database);
    const payload = eventPayload();

    const first = await handleStripeWebhookRequest(
      signedRequest(payload),
      deps.dependencies,
    );
    const duplicate = await handleStripeWebhookRequest(
      signedRequest(payload),
      deps.dependencies,
    );

    expect(first.status).toBe(200);
    expect(duplicate.status).toBe(200);
    await expect(duplicate.json()).resolves.toMatchObject({
      data: { result: "duplicate" },
    });
    expect(store.rows.size).toBe(1);
    expect(deps.applyEvent).toHaveBeenCalledTimes(1);
  });

  /**
   * **未知のPriceは200で返す**（T-M8-245）。再送しても直らない失敗に500を返し続けると、
   * Stripeが endpoint 自体を無効化し、**他の全利用者の契約同期まで巻き添えで止まる**。
   * 記録（captureException）は残すので、doctorとSentryから追える。
   */
  it("rejects an unknown Price before recording or applying the event and captures it", async () => {
    const store = memoryDatabase();
    const deps = routeDependencies(store.database);
    const response = await handleStripeWebhookRequest(
      signedRequest(eventPayload({ priceId: "price_unknown" })),
      deps.dependencies,
    );

    expect(response.status, "恒久エラーは200で返す（endpointを止めない）").toBe(200);
    expect(store.rows.size).toBe(0);
    expect(deps.applyEvent).not.toHaveBeenCalled();
    expect(deps.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ name: "UnknownStripePriceError" }),
      {
        event_id: "evt_test_001",
        event_type: "customer.subscription.updated",
        price_id: "price_unknown",
      },
    );
    expect(JSON.stringify(await response.json())).not.toContain("price_unknown");
  });

  it("acknowledges unsupported signed events without recording them", async () => {
    const store = memoryDatabase();
    const deps = routeDependencies(store.database);
    const response = await handleStripeWebhookRequest(
      signedRequest(eventPayload({ eventType: "customer.created" })),
      deps.dependencies,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { result: "ignored" },
    });
    expect(store.rows.size).toBe(0);
  });
});

describe("isPermanentEventError（T-M8-245）", () => {
  it("未知Price・profile対応不能は恒久エラー（再送しても直らない）", () => {
    expect(
      isPermanentEventError(
        new UnknownStripePriceError(
          { id: "evt_1", type: "customer.subscription.updated" } as never,
          "price_x",
        ),
      ),
    ).toBe(true);
    expect(
      isPermanentEventError(new Error("Subscription profile mapping does not match.")),
    ).toBe(true);
  });

  it("DB障害など再送で直りうるものは恒久エラーではない（500で再送させる）", () => {
    expect(isPermanentEventError(new Error("connection terminated"))).toBe(false);
    expect(isPermanentEventError(null)).toBe(false);
  });
});
