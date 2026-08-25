import type Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { connectLocalDb } from "@/lib/db/test-utils";

import { processStripeEvent, type StripeEventDatabase } from "./webhook";

describe("Stripe event database claim", () => {
  let database: Awaited<ReturnType<typeof connectLocalDb>>;

  beforeAll(async () => {
    database = await connectLocalDb();
    if (database) await database.query("begin");
  });

  afterAll(async () => {
    if (database) {
      await database.query("rollback");
      await database.end();
    }
  });

  it("uses the event_id primary-key conflict as the duplicate claim", async (context) => {
    if (!database) return context.skip();
    const activeDatabase = database;
    const event = {
      id: `evt_db_${crypto.randomUUID()}`,
      type: "customer.subscription.updated",
      created: 1_784_675_200,
      data: {
        object: {
          id: "sub_db_test",
          items: { data: [{ price: { id: "price_standard" } }] },
        },
      },
    } as unknown as Stripe.Event;
    let effects = 0;
    const dependencies = {
      applyEvent: async () => {
        effects += 1;
      },
      priceIds: {
        standard: "price_standard",
        expert: "price_expert",
        premium: "price_premium",
      },
      transaction: <T>(callback: (db: StripeEventDatabase) => Promise<T>) =>
        callback(activeDatabase),
    };

    await expect(processStripeEvent(event, dependencies)).resolves.toBe("processed");
    await expect(processStripeEvent(event, dependencies)).resolves.toBe("duplicate");
    expect(effects).toBe(1);
    const stored = await activeDatabase.query(
      "select type, object_id from stripe_events where event_id = $1",
      [event.id],
    );
    expect(stored.rows).toEqual([
      { type: event.type, object_id: "sub_db_test" },
    ]);
  });
});
