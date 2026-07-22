import { randomUUID } from "node:crypto";

import type Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { connectLocalDb } from "@/lib/db/test-utils";

import {
  applyPreparedStripeEvent,
  type PreparedStripeEvent,
  type SubscriptionProjection,
} from "./subscription-sync";
import {
  processStripeEvent,
  type StripeEventDatabase,
} from "./webhook";

describe("Stripe subscription synchronization transaction", () => {
  let database: Awaited<ReturnType<typeof connectLocalDb>>;
  let savepointNumber = 0;

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

  it("syncs current state, preserves first trial use, skips stale state, and rolls back failures", async (context) => {
    if (!database) return context.skip();
    const activeDatabase = database;
    const userId = randomUUID();
    const email = `${userId}@example.com`;
    await activeDatabase.query(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2)`,
      [userId, email],
    );
    await activeDatabase.query(
      "update profiles set stripe_customer_id = 'cus_sync' where id = $1",
      [userId],
    );

    const transaction = async <T>(
      callback: (db: StripeEventDatabase) => Promise<T>,
    ): Promise<T> => {
      savepointNumber += 1;
      const name = `stripe_sync_${savepointNumber}`;
      await activeDatabase.query(`savepoint ${name}`);
      try {
        const result = await callback(activeDatabase);
        await activeDatabase.query(`release savepoint ${name}`);
        return result;
      } catch (error) {
        await activeDatabase.query(`rollback to savepoint ${name}`);
        await activeDatabase.query(`release savepoint ${name}`);
        throw error;
      }
    };
    const priceIds = {
      standard: "price_standard",
      md: "price_md",
      premium: "price_premium",
    } as const;

    const run = (
      eventId: string,
      projection: SubscriptionProjection,
    ) => {
      const event = {
        id: eventId,
        type: "customer.subscription.updated",
        created: projection.eventCreated,
        data: {
          object: {
            id: projection.subscriptionId,
            items: { data: [{ price: { id: priceIds[projection.plan] } }] },
          },
        },
      } as unknown as Stripe.Event;
      const prepared: PreparedStripeEvent = {
        kind: "subscription_sync",
        projection,
      };
      return processStripeEvent(event, {
        applyEvent: (db, _event, value) =>
          applyPreparedStripeEvent(db, value).then(() => undefined),
        prepareEvent: async () => prepared,
        priceIds,
        transaction,
      });
    };

    const trialCreated = 1_784_675_200;
    await expect(
      run(`evt_sync_trial_${randomUUID()}`, {
        cancelAtPeriodEnd: false,
        currentPeriodEnd: 1_785_279_600,
        customerId: "cus_sync",
        eventCreated: trialCreated,
        plan: "premium",
        status: "trialing",
        subscriptionId: "sub_sync",
        trialEnd: 1_785_279_600,
        trialStartedAt: trialCreated - 400,
        userId,
      }),
    ).resolves.toBe("processed");

    const afterTrial = await activeDatabase.query<{
      cancel_at_period_end: boolean;
      current_period_end: Date;
      plan: string;
      stripe_subscription_id: string;
      subscription_event_created_at: Date;
      subscription_status: string;
      trial_ends_at: Date;
      trial_used_at: Date;
    }>(
      `select plan, subscription_status, current_period_end,
              cancel_at_period_end, trial_ends_at, trial_used_at,
              stripe_subscription_id, subscription_event_created_at
         from profiles where id = $1`,
      [userId],
    );
    expect(afterTrial.rows[0]).toMatchObject({
      plan: "premium",
      subscription_status: "trialing",
      cancel_at_period_end: false,
      stripe_subscription_id: "sub_sync",
    });
    const firstTrialUsedAt = afterTrial.rows[0].trial_used_at.toISOString();
    expect(firstTrialUsedAt).toBe(new Date((trialCreated - 400) * 1000).toISOString());

    await expect(
      run(`evt_sync_stale_${randomUUID()}`, {
        cancelAtPeriodEnd: true,
        currentPeriodEnd: 1_785_000_000,
        customerId: "cus_sync",
        eventCreated: trialCreated - 1,
        plan: "standard",
        status: "canceled",
        subscriptionId: "sub_sync",
        trialEnd: null,
        trialStartedAt: null,
        userId,
      }),
    ).resolves.toBe("processed");
    const afterStale = await activeDatabase.query(
      "select plan, subscription_status from profiles where id = $1",
      [userId],
    );
    expect(afterStale.rows[0]).toEqual({
      plan: "premium",
      subscription_status: "trialing",
    });

    await expect(
      run(`evt_sync_active_${randomUUID()}`, {
        cancelAtPeriodEnd: true,
        currentPeriodEnd: 1_787_000_000,
        customerId: "cus_sync",
        eventCreated: trialCreated + 1,
        plan: "md",
        status: "active",
        subscriptionId: "sub_sync",
        trialEnd: null,
        trialStartedAt: null,
        userId,
      }),
    ).resolves.toBe("processed");
    const afterActive = await activeDatabase.query<{
      plan: string;
      subscription_status: string;
      trial_used_at: Date;
    }>(
      "select plan, subscription_status, trial_used_at from profiles where id = $1",
      [userId],
    );
    expect(afterActive.rows[0]).toMatchObject({ plan: "md", subscription_status: "active" });
    expect(afterActive.rows[0].trial_used_at.toISOString()).toBe(firstTrialUsedAt);

    const failedEventId = `evt_sync_failed_${randomUUID()}`;
    await expect(
      run(failedEventId, {
        cancelAtPeriodEnd: false,
        currentPeriodEnd: 1_788_000_000,
        customerId: "cus_missing",
        eventCreated: trialCreated + 2,
        plan: "standard",
        status: "active",
        subscriptionId: "sub_missing",
        trialEnd: null,
        trialStartedAt: null,
        userId: randomUUID(),
      }),
    ).rejects.toThrow("mapping");
    const failedClaim = await activeDatabase.query(
      "select event_id from stripe_events where event_id = $1",
      [failedEventId],
    );
    expect(failedClaim.rowCount).toBe(0);
  });
});
