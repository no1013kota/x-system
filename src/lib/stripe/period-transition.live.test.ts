import { randomUUID } from "node:crypto";

import { loadEnvConfig } from "@next/env";

// env（STRIPE_SECRET_KEY 等）を import 前に読み込む（suggestion.live.test.ts と同じ作法）。
const testNodeEnv = process.env.NODE_ENV;
Reflect.set(process.env, "NODE_ENV", "development");
Object.assign(process.env, loadEnvConfig(process.cwd(), true, console, true).combinedEnv);
if (testNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
else Reflect.set(process.env, "NODE_ENV", testNodeEnv);

import Stripe from "stripe";
import { afterAll, describe, expect, it } from "vitest";

import { closePool, getPool } from "../db/pool";
import { reserveUsage } from "../usage/generation-reserve";
import { loadUsageSummary } from "../usage/usage-summary-server";
import { cancelScheduledPlanChange } from "./scheduled-plan-change";
import { applyPreparedStripeEvent, prepareStripeEvent } from "./subscription-sync";

/**
 * 期間末の下位変更が Stripe → アプリへ正しく効くことの実物検証（T-M8-261）。
 * `npm run check:stripe-period` で実行する（STRIPE_LIVE=1 ゲート。通常の `npm test` / CI では skip）。
 *
 * Stripe の **テストクロック**で「プレミアム契約 → 期間末にスタンダードへ下位変更を予約 → 取り消し →
 * 再予約 → 期間末を越える」を流し、webhook と同じ同期関数（prepareStripeEvent / applyPreparedStripeEvent）を
 * 実DBへ通す。予約の schedule は **Portal が実際に作る形**（2026-08-23 テストモードの Portal を
 * 実ブラウザで操作して観測: phases=[現在の期間, 新Priceが1秒], end_behavior=release。別Productの
 * Price 間でも期間末予約になった）に合わせて API で作る。見るもの:
 * - 予約が `scheduled_plan` / `scheduled_plan_at` に載り、取り消し（schedule release）で消える
 * - 期間末を越えると plan が standard・`current_period_start` が新期間・予約表示が消える
 * - 利用枠が新しい期間キーで 0 から始まる（前期間の reserve は前期間の行に残る）
 *
 * 単体・実DBテストで見えないのは「Stripe が実際にどういう schedule / 期間を返すか」なので、
 * schedule の形（phases・status）と期間の進み方だけは本物で確かめる。テストモードの鍵でしか動かさない。
 */
const ENABLED = process.env.STRIPE_LIVE === "1";
const SECRET = process.env.STRIPE_SECRET_KEY ?? "";
const PRICES = {
  standard: process.env.STRIPE_PRICE_STANDARD_MONTHLY ?? "",
  premium: process.env.STRIPE_PRICE_PREMIUM_MONTHLY ?? "",
  expert: process.env.STRIPE_PRICE_EXPERT_MONTHLY ?? "",
};

/** 同期関数（StripeEventDatabase＝pg の QueryResult）と利用枠（Queryable）の両方へ渡せる形。 */
const db = {
  query: <T extends object = Record<string, unknown>>(sql: string, params?: unknown[]) =>
    getPool().query<T>(sql, params),
};
const usageDb = {
  query: <T = unknown>(sql: string, params?: unknown[]) =>
    getPool().query(sql, params) as unknown as Promise<{ rows: T[]; rowCount: number | null }>,
};

function syntheticEvent(type: string, subscriptionId: string, createdSec: number): Stripe.Event {
  return {
    id: `evt_live_${randomUUID()}`,
    type,
    created: createdSec,
    data: { object: { id: subscriptionId, object: "subscription" } },
  } as unknown as Stripe.Event;
}

async function waitForClock(stripe: Stripe, clockId: string): Promise<Stripe.TestHelpers.TestClock> {
  const deadline = Date.now() + 120_000;
  for (;;) {
    const clock = await stripe.testHelpers.testClocks.retrieve(clockId);
    if (clock.status === "ready") return clock;
    if (clock.status === "internal_failure") throw new Error("Stripe test clock failed to advance.");
    if (Date.now() > deadline) throw new Error("Stripe test clock did not become ready in time.");
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

describe.skipIf(!ENABLED)("Stripe 期間末の下位変更（テストクロック・実物）", () => {
  afterAll(async () => {
    await closePool();
  });

  it("予約→取り消し→再予約→期間末越えが profiles と利用枠へ正しく効く", async () => {
    expect(SECRET.startsWith("sk_test_"), "テストモードの鍵でのみ実行する").toBe(true);
    expect(PRICES.premium && PRICES.standard, "Price ID が env に無い").toBeTruthy();
    // `./client` は import 時に env を検証するため、env 読み込み後に動的 import する。
    const { STRIPE_API_VERSION } = await import("./client");
    const stripe = new Stripe(SECRET, { apiVersion: STRIPE_API_VERSION });

    const userId = randomUUID();
    const email = `live-period-${userId.slice(0, 8)}@example.com`;
    let clockId: string | null = null;
    try {
      // --- 利用者（profile は trigger で作られる）---
      await db.query(
        `insert into auth.users (id, instance_id, aud, role, email)
         values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2)`,
        [userId, email],
      );

      // --- Stripe: テストクロック・顧客・プレミアム契約（トライアル無し）---
      const nowSec = Math.floor(Date.now() / 1000);
      const clock = await stripe.testHelpers.testClocks.create({ frozen_time: nowSec, name: `exos-period-${userId.slice(0, 8)}` });
      clockId = clock.id;
      const customer = await stripe.customers.create({
        email,
        test_clock: clock.id,
        metadata: { user_id: userId, exos_live_test: "T-M8-261" },
        payment_method: "pm_card_visa",
        invoice_settings: { default_payment_method: "pm_card_visa" },
      });
      await db.query(`update profiles set stripe_customer_id = $2 where id = $1`, [userId, customer.id]);
      const created = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: PRICES.premium }],
        metadata: { user_id: userId },
      });
      const sync = async (subscriptionId: string, createdSec: number) => {
        const prepared = await prepareStripeEvent(
          syntheticEvent("customer.subscription.updated", subscriptionId, createdSec),
          stripe,
          PRICES,
        );
        return applyPreparedStripeEvent(db, prepared);
      };
      const profile = () =>
        db
          .query<{
            plan: string | null;
            subscription_status: string;
            scheduled_plan: string | null;
            scheduled_plan_at: Date | null;
            current_period_start: Date | null;
            current_period_end: Date | null;
          }>(
            `select plan, subscription_status, scheduled_plan, scheduled_plan_at,
                    current_period_start, current_period_end
               from profiles where id = $1`,
            [userId],
          )
          .then((r) => r.rows[0]);

      expect(await sync(created.id, nowSec + 1)).toBe("updated");
      const p1 = await profile();
      expect(p1).toMatchObject({ plan: "premium", subscription_status: "active", scheduled_plan: null });
      const periodStart1 = p1.current_period_start!;
      const periodEnd1 = p1.current_period_end!;
      expect(Math.abs(periodStart1.getTime() / 1000 - nowSec)).toBeLessThan(120);

      // 今期に使う（期間キー＝期間開始日の JST 日付）。
      const xid = (
        await db.query<{ id: string }>(
          `insert into x_accounts (user_id, x_user_id, handle, name, auth_type)
           values ($1, $2, 'live', 'live', 'byok') returning id`,
          [userId, `live_${userId.slice(0, 8)}`],
        )
      ).rows[0].id;
      const jobId = (
        await db.query<{ id: string }>(
          `insert into generation_jobs (x_account_id, kind, trigger, pattern_id, status)
           values ($1, 'post_generation', 'manual',
                   (select id from post_patterns where x_account_id = $1 and seed_key = 'p1'), 'queued')
           returning id`,
          [xid],
        )
      ).rows[0].id;
      await reserveUsage(usageDb, { userId, jobId, type: "generation", limit: 1000, amount: 16 });
      const periodKey1 = (
        await db.query<{ month: string }>(`select month from usage_counters where user_id = $1`, [userId])
      ).rows[0].month;
      expect(periodKey1).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect((await loadUsageSummary(usageDb, userId, "premium"))?.ai_credits.used).toBe(16);

      // --- 期間末の下位変更を予約（Portal の値下げ予約と同じ形: schedule を付ける）---
      const scheduleFor = async () => {
        const sub = await stripe.subscriptions.retrieve(created.id);
        const current = sub.items.data[0];
        const schedule = await stripe.subscriptionSchedules.create({ from_subscription: created.id });
        await stripe.subscriptionSchedules.update(schedule.id, {
          end_behavior: "release",
          phases: [
            {
              items: [{ price: current.price.id, quantity: 1 }],
              start_date: schedule.phases[0].start_date,
              end_date: schedule.phases[0].end_date,
            },
            // Portal と同じく新Priceのフェーズは1秒で終わり、schedule は release されて契約から外れる。
            {
              items: [{ price: PRICES.standard, quantity: 1 }],
              end_date: schedule.phases[0].end_date + 1,
            },
          ],
        });
        return schedule.id;
      };
      await scheduleFor();
      expect(await sync(created.id, nowSec + 2)).toBe("updated");
      const p2 = await profile();
      expect(p2.scheduled_plan).toBe("standard");
      expect(p2.scheduled_plan_at?.getTime()).toBe(periodEnd1.getTime());
      expect(p2.plan, "切替日までは現在プランのまま").toBe("premium");

      // --- 取り消し（アプリの「プラン変更の予約を取り消す」）---
      expect(await cancelScheduledPlanChange(usageDb, stripe, userId)).toBe("released");
      const afterRelease = await stripe.subscriptions.retrieve(created.id);
      expect(afterRelease.schedule, "Stripe 側の schedule が外れている").toBeNull();
      expect((await profile()).scheduled_plan).toBeNull();
      expect(await sync(created.id, nowSec + 3)).toBe("updated");
      expect((await profile()).scheduled_plan, "同期し直しても予約は戻らない").toBeNull();

      // --- 再予約して期間末を越える ---
      await scheduleFor();
      expect(await sync(created.id, nowSec + 4)).toBe("updated");
      expect((await profile()).scheduled_plan).toBe("standard");
      await stripe.testHelpers.testClocks.advance(clock.id, {
        frozen_time: Math.floor(periodEnd1.getTime() / 1000) + 3_600,
      });
      await waitForClock(stripe, clock.id);
      const renewed = await stripe.subscriptions.retrieve(created.id);
      expect(renewed.items.data[0].price.id, "Stripe 側で下位の Price へ切り替わっている").toBe(PRICES.standard);
      expect(renewed.schedule, "効いた予約の schedule は契約から外れている（release）").toBeNull();
      expect(await sync(created.id, Math.floor(periodEnd1.getTime() / 1000) + 3_601)).toBe("updated");
      const p3 = await profile();
      expect(p3.plan).toBe("standard");
      expect(p3.scheduled_plan, "効いた予約は表示から消える").toBeNull();
      expect(p3.current_period_start!.getTime(), "新しい期間は前の期間末から始まる").toBe(periodEnd1.getTime());

      // 利用枠: 新しい期間キーの行は無い（＝0 から）。前期間の行はそのまま残る（監査用）。
      const rows = (
        await db.query<{ month: string; ai_credits_used: number }>(
          `select month, ai_credits_used from usage_counters where user_id = $1 order by month`,
          [userId],
        )
      ).rows;
      expect(rows).toEqual([{ month: periodKey1, ai_credits_used: 16 }]);
      // standard は枠を持たない（null）。premium のまま新期間なら 0 から始まることを期間キーで確かめる。
      const newKey = (
        await db.query<{ key: string }>(
          `select to_char((current_period_start at time zone 'Asia/Tokyo'), 'YYYY-MM-DD') as key from profiles where id = $1`,
          [userId],
        )
      ).rows[0].key;
      expect(newKey).not.toBe(periodKey1);
      expect(await loadUsageSummary(usageDb, userId, "standard")).toBeNull();
    } finally {
      // Stripe: テストクロックを消すと顧客・契約・schedule も消える。
      if (clockId) await stripe.testHelpers.testClocks.del(clockId).catch(() => undefined);
      await db.query(`delete from usage_events where user_id = $1`, [userId]);
      await db.query(`delete from usage_counters where user_id = $1`, [userId]);
      await db.query(`delete from generation_jobs where x_account_id in (select id from x_accounts where user_id = $1)`, [userId]);
      await db.query(`delete from x_accounts where user_id = $1`, [userId]);
      await db.query(`delete from auth.users where id = $1`, [userId]);
    }
  }, 300_000);

  /**
   * トライアル→有料化で**利用枠が満額へ戻る**（運営者の指示 2026-08-23・D-38 再決定）。
   * Stripe の実挙動（トライアル中 `current_period_end = trial_end`、有料化で
   * `current_period_start = trial_end`）に依存するので、実物で確かめる。
   */
  it("トライアルと有料期間はそれぞれ別の枠になる（有料化で0から）", async () => {
    expect(SECRET.startsWith("sk_test_")).toBe(true);
    const { STRIPE_API_VERSION } = await import("./client");
    const stripe = new Stripe(SECRET, { apiVersion: STRIPE_API_VERSION });
    const userId = randomUUID();
    const email = `live-trial-${userId.slice(0, 8)}@example.com`;
    let clockId: string | null = null;
    try {
      await db.query(
        `insert into auth.users (id, instance_id, aud, role, email)
         values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2)`,
        [userId, email],
      );
      const nowSec = Math.floor(Date.now() / 1000);
      const clock = await stripe.testHelpers.testClocks.create({ frozen_time: nowSec, name: `exos-trial-${userId.slice(0, 8)}` });
      clockId = clock.id;
      const customer = await stripe.customers.create({
        email,
        test_clock: clock.id,
        payment_method: "pm_card_visa",
        invoice_settings: { default_payment_method: "pm_card_visa" },
      });
      await db.query(`update profiles set stripe_customer_id = $2 where id = $1`, [userId, customer.id]);
      const created = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: PRICES.premium }],
        trial_period_days: 7,
        metadata: { user_id: userId },
      });
      const sync = async (createdSec: number) => {
        const prepared = await prepareStripeEvent(
          syntheticEvent("customer.subscription.updated", created.id, createdSec),
          stripe,
          PRICES,
        );
        return applyPreparedStripeEvent(db, prepared);
      };
      const periodKey = () =>
        db
          .query<{ key: string }>(
            `select (select coalesce(to_char((p.current_period_start at time zone 'Asia/Tokyo'), 'YYYY-MM-DD'), 'none')
                from profiles p where p.id = $1) as key`,
            [userId],
          )
          .then((r) => r.rows[0].key);

      expect(await sync(nowSec + 1)).toBe("updated");
      const trial = (
        await db.query<{ status: string; start: Date; end: Date; trial_end: Date }>(
          `select subscription_status as status, current_period_start as start, current_period_end as "end", trial_ends_at as trial_end
             from profiles where id = $1`,
          [userId],
        )
      ).rows[0];
      expect(trial.status).toBe("trialing");
      expect(trial.end.getTime(), "トライアル中は期間末＝トライアル終了").toBe(trial.trial_end.getTime());
      const keyInTrial = await periodKey();

      // 有料化（トライアル終了 +1h）。
      const trialEndSec = Math.floor(trial.trial_end.getTime() / 1000);
      await stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: trialEndSec + 3_600 });
      await waitForClock(stripe, clock.id);
      const paid = await stripe.subscriptions.retrieve(created.id);
      expect(paid.status).toBe("active");
      expect(paid.items.data[0].current_period_start, "有料期間はトライアル終了から始まる").toBe(trialEndSec);
      expect(paid.trial_end, "trial_end は有料化後も残る").toBe(trialEndSec);
      expect(await sync(trialEndSec + 3_601)).toBe("updated");
      expect(await periodKey(), "有料化で新しい期間キーになる（枠が満額へ戻る）").not.toBe(keyInTrial);
      const resetsAt = (await loadUsageSummary(usageDb, userId, "premium"))?.resetsAt ?? "";
      expect(new Date(resetsAt).getTime(), "リセット日は有料期間の終わり").toBe(
        paid.items.data[0].current_period_end * 1000,
      );

      // 2回目の有料期間。
      const firstPaidEnd = paid.items.data[0].current_period_end;
      await stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: firstPaidEnd + 3_600 });
      await waitForClock(stripe, clock.id);
      expect(await sync(firstPaidEnd + 3_601)).toBe("updated");
      expect(await periodKey(), "2回目の有料期間でもさらに新しいキー").not.toBe(keyInTrial);
    } finally {
      if (clockId) await stripe.testHelpers.testClocks.del(clockId).catch(() => undefined);
      await db.query(`delete from auth.users where id = $1`, [userId]);
    }
  }, 300_000);
});
