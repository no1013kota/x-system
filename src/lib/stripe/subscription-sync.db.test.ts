import { randomUUID } from "node:crypto";

import type Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { connectLocalDb } from "@/lib/db/test-utils";

import {
  applyPreparedStripeEvent,
  type PreparedStripeEvent,
  type SubscriptionProjection,
} from "./subscription-sync";
import { cancelScheduledPlanChange } from "./scheduled-plan-change";
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
    // このテストは「billingメールが有効な利用者への通知の作られ方」を見る。
    // 既定はT-M8-206でOFFになったため、明示的にONへ（既定値の検証はconstants.testが担う）。
    await activeDatabase.query(
      `update profiles set notification_config = jsonb_set(
         notification_config, '{billing}', '{"in_app":true}'::jsonb)
       where id = $1`,
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
          invoice: {
            attemptCount: 2,
            id: invoiceId,
            paymentState,
            amountPaid: 3980,
            paidAtSec: 1_784_675_200,
          },
          projection,
        },
      );

    const trialCreated = 1_784_675_200;
    await expect(
      run(`evt_sync_trial_${randomUUID()}`, {
        cancelAtPeriodEnd: false,
        scheduledPlan: null,
        scheduledPlanAt: null,
        scheduleUnavailable: false,
        currentPeriodEnd: 1_785_279_600,
        currentPeriodStart: 1_785_279_600 - 2_592_000,
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
        scheduledPlan: null,
        scheduledPlanAt: null,
        scheduleUnavailable: false,
        currentPeriodEnd: 1_785_000_000,
        currentPeriodStart: 1_785_000_000 - 2_592_000,
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
        scheduledPlan: null,
        scheduledPlanAt: null,
        scheduleUnavailable: false,
        currentPeriodEnd: 1_787_000_000,
        currentPeriodStart: 1_787_000_000 - 2_592_000,
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
      scheduledPlan: null,
      scheduledPlanAt: null,
      scheduleUnavailable: false,
      currentPeriodEnd: 1_787_100_000,
      currentPeriodStart: 1_787_100_000 - 2_592_000,
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
      in_app_enabled: boolean;
      link: string;
      payload: {
        invoice_id: string;
        notification_config_snapshot: { in_app: boolean };
        subscription_status: string;
      };
    }>(
      `select dedupe_key, in_app_enabled, link, payload
         from notifications where user_id = $1 and type = 'billing'`,
      [userId],
    );
    expect(billingNotifications.rowCount).toBe(1);
    expect(billingNotifications.rows[0]).toMatchObject({
      dedupe_key: "billing:invoice:in_failed_001:payment_failed",
      in_app_enabled: true,
      link: "/app/settings?tab=billing",
      payload: {
        invoice_id: "in_failed_001",
        notification_config_snapshot: { in_app: true },
        subscription_status: "past_due",
      },
    });

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
        scheduledPlan: null,
        scheduledPlanAt: null,
        scheduleUnavailable: false,
        currentPeriodEnd: 1_788_000_000,
        currentPeriodStart: 1_788_000_000 - 2_592_000,
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

  /**
   * 招待報酬のwebhook配線（T-M8-174・invite_cp.md §6/§7）。ロジック単体は
   * `affiliate/store.db.test.ts` が担い、ここは **applyPreparedStripeEvent から
   * 実際に呼ばれること**（配線の存在）を見る。
   */
  it("invoice.paidで招待報酬が作られ、解約で期間終了、refundで取り消される", async (context) => {
    if (!database) return context.skip();
    const db = database;
    const inviterId = randomUUID();
    const referredId = randomUUID();
    for (const [id, customer] of [
      [inviterId, "cus_aff_inviter"],
      [referredId, "cus_aff_referred"],
    ] as const) {
      await db.query(
        `insert into auth.users (id, instance_id, aud, role, email)
         values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2)`,
        [id, `${id}@example.com`],
      );
      await db.query("update profiles set stripe_customer_id = $2 where id = $1", [id, customer]);
    }
    const account = await db.query<{ id: string }>(
      `insert into affiliate_accounts (user_id, code) values ($1, 'wiretest1') returning id`,
      [inviterId],
    );
    await db.query(
      `insert into affiliate_attributions (affiliate_account_id, referred_user_id)
       values ($1, $2)`,
      [account.rows[0].id, referredId],
    );

    const transaction = async <T>(
      callback: (txDb: StripeEventDatabase) => Promise<T>,
    ): Promise<T> => callback(db);
    const priceIds = {
      standard: "price_standard",
      expert: "price_expert",
      premium: "price_premium",
    } as const;
    const eventCreated = 1_784_675_200;
    const projection: SubscriptionProjection = {
      cancelAtPeriodEnd: false,
      scheduledPlan: null,
      scheduledPlanAt: null,
      scheduleUnavailable: false,
      currentPeriodEnd: eventCreated + 2_592_000,
      currentPeriodStart: eventCreated,
      customerId: "cus_aff_referred",
      eventCreated,
      plan: "premium",
      status: "active",
      subscriptionId: "sub_aff_referred",
      trialEnd: null,
      trialStartedAt: null,
      userId: referredId,
    };
    const invoiceId = `in_aff_${randomUUID()}`;
    const process = (eventId: string, type: string, prepared: PreparedStripeEvent) =>
      processStripeEvent(
        {
          id: eventId,
          type,
          created: eventCreated,
          data: { object: { id: "obj" } },
        } as unknown as Stripe.Event,
        {
          applyEvent: (txDb, _event, value) =>
            applyPreparedStripeEvent(txDb, value).then(() => undefined),
          prepareEvent: async () => prepared,
          priceIds,
          transaction,
        },
      );

    // (1) invoice.paid → 報酬が作られる（¥3,980×30%＝¥1,194）。
    await process(`evt_aff_paid_${randomUUID()}`, "invoice.paid", {
      kind: "invoice_sync",
      invoice: {
        attemptCount: 1,
        id: invoiceId,
        paymentState: "paid",
        amountPaid: 3980,
        paidAtSec: eventCreated,
      },
      projection,
    });
    const commission = await db.query<{ commission_amount: number; status: string }>(
      `select commission_amount, status from affiliate_commissions where stripe_invoice_id = $1`,
      [invoiceId],
    );
    expect(commission.rows[0]).toMatchObject({ commission_amount: 1194, status: "pending" });

    // (2) 解約（status canceled）→ 報酬期間が終了として記録される。
    await process(`evt_aff_del_${randomUUID()}`, "customer.subscription.deleted", {
      kind: "subscription_sync",
      projection: { ...projection, status: "canceled", eventCreated: eventCreated + 10 },
    });
    const terminated = await db.query<{ commission_terminated_reason: string | null }>(
      `select commission_terminated_reason from affiliate_attributions where referred_user_id = $1`,
      [referredId],
    );
    expect(terminated.rows[0].commission_terminated_reason).toBe("subscription_cancelled");

    // (3) charge.refunded → 該当invoiceの報酬が取り消される。
    await process(`evt_aff_ref_${randomUUID()}`, "charge.refunded", {
      kind: "charge_refund",
      stripeInvoiceId: invoiceId,
      amountRefunded: 3980,
      fullyRefunded: true,
    });
    const reversed = await db.query<{ status: string }>(
      `select status from affiliate_commissions where stripe_invoice_id = $1`,
      [invoiceId],
    );
    expect(reversed.rows[0].status).toBe("reversed");

    /*
      **staleでも報酬は作られる**（レビュー修正）。Stripeは配送順を保証しないので、
      createdが新しいsubscriptionイベントの後に古いinvoice.paidが届いても、
      profilesの投影だけをスキップし、報酬（冪等）は記録する。
    */
    const staleInvoice = `in_aff_stale_${randomUUID()}`;
    const staleResult = await process(`evt_aff_stale_${randomUUID()}`, "invoice.paid", {
      kind: "invoice_sync",
      invoice: {
        attemptCount: 1,
        id: staleInvoice,
        paymentState: "paid",
        amountPaid: 3980,
        paidAtSec: eventCreated - 100,
      },
      // eventCreated を過去へ（上の subscription.deleted 処理より古い）→ stale 判定になる。
      projection: { ...projection, eventCreated: eventCreated - 100 },
    });
    expect(staleResult).toBe("processed");
    const staleCommission = await db.query<{ status: string }>(
      `select status from affiliate_commissions where stripe_invoice_id = $1`,
      [staleInvoice],
    );
    /*
      **解約より前の支払いなので報酬は作られる**（T-M8-236で修正）。
      以前は `commission_terminated_reason` があるだけで支払日を見ずに捨てていたため、
      配送順の入れ替わり（解約が先に届く）で解約前の支払いが恒久に落ちていた。
      ここで見たいのは「staleで例外にならず、イベントが処理済みになる」こと。
    */
    expect(staleCommission.rowCount).toBe(1);
  });

  it("staleなinvoice.paidでも（解約前なら）報酬が作られ、profilesの投影は動かない", async (context) => {
    if (!database) return context.skip();
    const db = database;
    const inviterId = randomUUID();
    const referredId = randomUUID();
    for (const [id, customer] of [
      [inviterId, "cus_stale_inviter"],
      [referredId, "cus_stale_referred"],
    ] as const) {
      await db.query(
        `insert into auth.users (id, instance_id, aud, role, email)
         values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2)`,
        [id, `${id}@example.com`],
      );
      await db.query("update profiles set stripe_customer_id = $2 where id = $1", [id, customer]);
    }
    const account = await db.query<{ id: string }>(
      `insert into affiliate_accounts (user_id, code) values ($1, 'staletest') returning id`,
      [inviterId],
    );
    await db.query(
      `insert into affiliate_attributions (affiliate_account_id, referred_user_id)
       values ($1, $2)`,
      [account.rows[0].id, referredId],
    );
    const transaction = async <T>(
      callback: (txDb: StripeEventDatabase) => Promise<T>,
    ): Promise<T> => callback(db);
    const priceIds = {
      standard: "price_standard",
      expert: "price_expert",
      premium: "price_premium",
    } as const;
    const eventCreated = 1_784_675_200;
    const projection: SubscriptionProjection = {
      cancelAtPeriodEnd: false,
      scheduledPlan: null,
      scheduledPlanAt: null,
      scheduleUnavailable: false,
      currentPeriodEnd: eventCreated + 2_592_000,
      currentPeriodStart: eventCreated,
      customerId: "cus_stale_referred",
      eventCreated,
      plan: "premium",
      status: "active",
      subscriptionId: "sub_stale_referred",
      trialEnd: null,
      trialStartedAt: null,
      userId: referredId,
    };
    const process = (eventId: string, type: string, prepared: PreparedStripeEvent) =>
      processStripeEvent(
        { id: eventId, type, created: eventCreated, data: { object: { id: "obj" } } } as unknown as Stripe.Event,
        {
          applyEvent: (txDb, _event, value) =>
            applyPreparedStripeEvent(txDb, value).then(() => undefined),
          prepareEvent: async () => prepared,
          priceIds,
          transaction,
        },
      );
    // 先に「新しい」subscriptionイベントを処理して投影の時計を進める。
    await process(`evt_stale_new_${randomUUID()}`, "customer.subscription.updated", {
      kind: "subscription_sync",
      projection: { ...projection, eventCreated: eventCreated + 100 },
    });
    // その後に「古い」invoice.paidが届く（配送順の逆転）→ staleだが報酬は作られる。
    const invoiceId = `in_stale_${randomUUID()}`;
    await process(`evt_stale_old_${randomUUID()}`, "invoice.paid", {
      kind: "invoice_sync",
      invoice: {
        attemptCount: 1,
        id: invoiceId,
        paymentState: "paid",
        amountPaid: 3980,
        paidAtSec: eventCreated,
      },
      projection,
    });
    const commission = await db.query<{ commission_amount: number }>(
      `select commission_amount from affiliate_commissions where stripe_invoice_id = $1`,
      [invoiceId],
    );
    expect(commission.rows[0]).toMatchObject({ commission_amount: 1194 });
    // profilesの投影は新しいイベントのまま（staleが守られている）。
    const prof = await db.query<{ created: string }>(
      `select extract(epoch from subscription_event_created_at)::bigint::text as created
         from profiles where id = $1`,
      [referredId],
    );
    expect(Number(prof.rows[0].created)).toBe(eventCreated + 100);
  });

  /**
   * 予約済みの下位変更（T-M8-260）。webhookが schedule から読んだ予約を profiles へ書き、
   * 取り消しは Stripe の schedule を解除して profiles を空へ戻す。
   */
  it("writes the scheduled plan from the projection and clears it on cancel", async (context) => {
    if (!database) return context.skip();
    const activeDatabase = database;
    const userId = randomUUID();
    await activeDatabase.query(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2)`,
      [userId, `${userId}@example.com`],
    );
    await activeDatabase.query("update profiles set stripe_customer_id = 'cus_sched' where id = $1", [userId]);
    const base: SubscriptionProjection = {
      cancelAtPeriodEnd: false,
      scheduledPlan: "standard",
      scheduledPlanAt: 1_785_279_600,
      scheduleUnavailable: false,
      currentPeriodEnd: 1_785_279_600,
      currentPeriodStart: 1_785_279_600 - 2_592_000,
      customerId: "cus_sched",
      eventCreated: 1_784_675_200,
      plan: "premium",
      status: "active",
      subscriptionId: "sub_sched",
      trialEnd: null,
      trialStartedAt: null,
      userId,
    };
    await expect(applyPreparedStripeEvent(activeDatabase, { kind: "subscription_sync", eventType: "customer.subscription.updated", projection: base })).resolves.toBe("updated");
    const read = () =>
      activeDatabase
        .query<{ scheduled_plan: string | null; scheduled_plan_at: Date | null }>(
          "select scheduled_plan, scheduled_plan_at from profiles where id = $1",
          [userId],
        )
        .then((r) => r.rows[0]);
    expect(await read()).toEqual({ scheduled_plan: "standard", scheduled_plan_at: new Date(1_785_279_600 * 1000) });

    // schedule を読めなかった同期は保存済みの予約を残す（失敗の空で正常の空を上書きしない・原則1）。
    await expect(
      applyPreparedStripeEvent(activeDatabase, {
        kind: "subscription_sync",
        eventType: "customer.subscription.updated",
        projection: { ...base, eventCreated: base.eventCreated + 1, scheduledPlan: null, scheduledPlanAt: null, scheduleUnavailable: true },
      }),
    ).resolves.toBe("updated");
    expect(await read(), "読めなかった回は上書きしない").toEqual({ scheduled_plan: "standard", scheduled_plan_at: new Date(1_785_279_600 * 1000) });
    // 読めて「予約なし」なら消す。
    await expect(
      applyPreparedStripeEvent(activeDatabase, {
        kind: "subscription_sync",
        eventType: "customer.subscription.updated",
        projection: { ...base, eventCreated: base.eventCreated + 2, scheduledPlan: null, scheduledPlanAt: null, scheduleUnavailable: false },
      }),
    ).resolves.toBe("updated");
    expect(await read()).toEqual({ scheduled_plan: null, scheduled_plan_at: null });
    // 以降の取り消しの検証のため予約を戻す。
    await expect(
      applyPreparedStripeEvent(activeDatabase, {
        kind: "subscription_sync",
        eventType: "customer.subscription.updated",
        projection: { ...base, eventCreated: base.eventCreated + 3 },
      }),
    ).resolves.toBe("updated");

    // 取り消し: Stripe の schedule を解除し、profiles の予約を消す。本人の契約IDを profiles から取る。
    const released: string[] = [];
    await expect(
      cancelScheduledPlanChange(
        activeDatabase,
        {
          subscriptions: { retrieve: async (id) => ({ id, schedule: id === "sub_sched" ? "sub_sched_1" : null }) },
          subscriptionSchedules: {
            release: async (id) => {
              released.push(id);
              return { id, status: "released" };
            },
          },
        },
        userId,
      ),
    ).resolves.toBe("released");
    expect(released).toEqual(["sub_sched_1"]);
    expect(await read()).toEqual({ scheduled_plan: null, scheduled_plan_at: null });

    // 予約が無い状態で押しても壊れない（Stripe側に schedule が無い→表示だけ整える）。
    await expect(
      cancelScheduledPlanChange(
        activeDatabase,
        {
          subscriptions: { retrieve: async () => ({ schedule: null }) },
          subscriptionSchedules: { release: async () => { throw new Error("must not release"); } },
        },
        userId,
      ),
    ).resolves.toBe("nothing_scheduled");

    // 予約の片方だけは入らない（CHECK 制約）。
    await activeDatabase.query("savepoint pair_check");
    await expect(
      activeDatabase.query("update profiles set scheduled_plan = 'standard', scheduled_plan_at = null where id = $1", [userId]),
    ).rejects.toThrow(/profiles_scheduled_plan_pair/);
    await activeDatabase.query("rollback to savepoint pair_check");

    // 契約の無い利用者は取り消せない。
    const noSub = randomUUID();
    await activeDatabase.query(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2)`,
      [noSub, `${noSub}@example.com`],
    );
    await expect(
      cancelScheduledPlanChange(
        activeDatabase,
        { subscriptions: { retrieve: async () => ({ schedule: "x" }) }, subscriptionSchedules: { release: async () => ({ id: "x", status: "released" }) } },
        noSub,
      ),
    ).rejects.toMatchObject({ code: "subscription_required" });
  });
});
