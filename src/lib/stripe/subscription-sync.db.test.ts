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
      expert: "price_expert",
      premium: "price_premium",
    } as const;

    const processPrepared = (
      eventId: string,
      eventType: string,
      projection: SubscriptionProjection,
      prepared: PreparedStripeEvent,
    ) => {
      const event = {
        id: eventId,
        type: eventType,
        created: projection.eventCreated,
        data: {
          object: {
            id: projection.subscriptionId,
            items: { data: [{ price: { id: priceIds[projection.plan] } }] },
          },
        },
      } as unknown as Stripe.Event;
      return processStripeEvent(event, {
        applyEvent: (db, _event, value) =>
          applyPreparedStripeEvent(db, value).then(() => undefined),
        prepareEvent: async () => prepared,
        priceIds,
        transaction,
      });
    };
    const run = (eventId: string, projection: SubscriptionProjection) =>
      processPrepared(eventId, "customer.subscription.updated", projection, {
        kind: "subscription_sync",
        projection,
      });
    const runInvoice = (
      eventId: string,
      invoiceId: string,
      paymentState: "failed" | "paid",
      projection: SubscriptionProjection,
    ) =>
      processPrepared(
        eventId,
        paymentState === "failed" ? "invoice.payment_failed" : "invoice.paid",
        projection,
        {
          kind: "invoice_sync",
          invoice: { attemptCount: 2, id: invoiceId, paymentState },
          projection,
        },
      );

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
    expect(firstTrialUsedAt).toBe(
      new Date((trialCreated - 400) * 1000).toISOString(),
    );

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
        plan: "expert",
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
    expect(afterActive.rows[0]).toMatchObject({
      plan: "expert",
      subscription_status: "active",
    });
    expect(afterActive.rows[0].trial_used_at.toISOString()).toBe(firstTrialUsedAt);

    const failedProjection: SubscriptionProjection = {
      cancelAtPeriodEnd: false,
      currentPeriodEnd: 1_787_100_000,
      customerId: "cus_sync",
      eventCreated: trialCreated + 2,
      plan: "expert",
      status: "past_due",
      subscriptionId: "sub_sync",
      trialEnd: null,
      trialStartedAt: null,
      userId,
    };
    await expect(
      runInvoice(
        `evt_invoice_failed_${randomUUID()}`,
        "in_failed_001",
        "failed",
        failedProjection,
      ),
    ).resolves.toBe("processed");
    await expect(
      runInvoice(
        `evt_invoice_failed_retry_${randomUUID()}`,
        "in_failed_001",
        "failed",
        { ...failedProjection, eventCreated: trialCreated + 3 },
      ),
    ).resolves.toBe("processed");

    const billingNotifications = await activeDatabase.query<{
      dedupe_key: string;
      email_available_at: Date | null;
      email_status: string;
      in_app_enabled: boolean;
      link: string;
      payload: {
        invoice_id: string;
        notification_config_snapshot: { email: boolean; in_app: boolean };
        subscription_status: string;
      };
    }>(
      `select dedupe_key, email_available_at, email_status, in_app_enabled,
              link, payload
         from notifications where user_id = $1 and type = 'billing'`,
      [userId],
    );
    expect(billingNotifications.rowCount).toBe(1);
    expect(billingNotifications.rows[0]).toMatchObject({
      dedupe_key: "billing:invoice:in_failed_001:payment_failed",
      email_status: "queued",
      in_app_enabled: true,
      link: "/app/settings?tab=billing",
      payload: {
        invoice_id: "in_failed_001",
        notification_config_snapshot: { email: true, in_app: true },
        subscription_status: "past_due",
      },
    });
    expect(billingNotifications.rows[0].email_available_at).toBeInstanceOf(Date);

    await expect(
      runInvoice(
        `evt_invoice_paid_${randomUUID()}`,
        "in_failed_001",
        "paid",
        {
          ...failedProjection,
          eventCreated: trialCreated + 4,
          status: "active",
        },
      ),
    ).resolves.toBe("processed");
    const afterRecovery = await activeDatabase.query(
      `select p.subscription_status,
              (select count(*)::int from notifications n
                where n.user_id = p.id and n.type = 'billing') as notification_count
         from profiles p where p.id = $1`,
      [userId],
    );
    expect(afterRecovery.rows[0]).toEqual({
      notification_count: 1,
      subscription_status: "active",
    });

    await activeDatabase.query(
      `update profiles
          set notification_config = jsonb_set(
            notification_config,
            '{billing}',
            '{"in_app":false,"email":false}'::jsonb
          )
        where id = $1`,
      [userId],
    );
    await expect(
      runInvoice(
        `evt_invoice_muted_${randomUUID()}`,
        "in_failed_muted",
        "failed",
        { ...failedProjection, eventCreated: trialCreated + 5 },
      ),
    ).resolves.toBe("processed");
    const mutedCount = await activeDatabase.query<{ count: number }>(
      "select count(*)::int as count from notifications where user_id = $1 and type = 'billing'",
      [userId],
    );
    expect(mutedCount.rows[0].count).toBe(1);

    const failedEventId = `evt_sync_failed_${randomUUID()}`;
    await expect(
      run(failedEventId, {
        cancelAtPeriodEnd: false,
        currentPeriodEnd: 1_788_000_000,
        customerId: "cus_missing",
        eventCreated: trialCreated + 6,
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
