import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { connectLocalDb } from "@/lib/db/test-utils";

import { cancelScheduledCancellation } from "./scheduled-cancellation";

/**
 * 解約予定の取り消し（T-M8-271）。押したその場で Stripe の予定を消し、画面の表示も戻す。
 * 本人の契約だけを対象にする（契約IDは profiles から取る）。
 */
describe("cancelScheduledCancellation (db)", () => {
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

  it("clears the cancel schedule on Stripe and in the profile, and refuses foreign or ended subscriptions", async (context) => {
    if (!database) return context.skip();
    const db = database;
    const userId = randomUUID();
    await db.query(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2)`,
      [userId, `${userId}@example.com`],
    );
    await db.query(
      `update profiles set stripe_customer_id = 'cus_keep', stripe_subscription_id = 'sub_keep',
              subscription_status = 'active', cancel_at_period_end = true where id = $1`,
      [userId],
    );
    const read = () =>
      db
        .query<{ cancel_at_period_end: boolean }>(
          "select cancel_at_period_end from profiles where id = $1",
          [userId],
        )
        .then((r) => r.rows[0].cancel_at_period_end);

    const updates: { id: string; params: unknown }[] = [];
    const gateway = (over: { status?: string; cancel_at_period_end?: boolean; cancel_at?: number | null } = {}) => ({
      subscriptions: {
        retrieve: async () => ({ status: "active", cancel_at_period_end: true, cancel_at: null, ...over }),
        update: async (id: string, params: unknown) => {
          updates.push({ id, params });
          return { status: "active", cancel_at_period_end: false, cancel_at: null };
        },
      },
    });

    expect(await cancelScheduledCancellation(db, gateway(), userId)).toBe("resumed");
    // **両方は送らない**（Stripeが400を返す・2026-08-23 実測）。日時が無ければ boolean を落とす。
    expect(updates).toEqual([{ id: "sub_keep", params: { cancel_at_period_end: false } }]);
    expect(await read(), "webhookを待たずに画面の表示も戻す").toBe(false);

    // トライアル中の解約は boolean ではなく cancel_at だけが立つ（T-M8-57）。それも取り消せる。
    updates.length = 0;
    await db.query(`update profiles set cancel_at_period_end = true where id = $1`, [userId]);
    expect(
      await cancelScheduledCancellation(
        db,
        gateway({ cancel_at_period_end: false, cancel_at: 1_790_000_000 }),
        userId,
      ),
    ).toBe("resumed");
    expect(updates, "日時が入っていれば cancel_at だけを消す").toEqual([
      { id: "sub_keep", params: { cancel_at: null } },
    ]);

    // Stripe側に予定が無ければ Stripe を変更せず、表示だけ整える。
    updates.length = 0;
    await db.query(`update profiles set cancel_at_period_end = true where id = $1`, [userId]);
    expect(
      await cancelScheduledCancellation(db, gateway({ cancel_at_period_end: false, cancel_at: null }), userId),
    ).toBe("nothing_scheduled");
    expect(updates).toHaveLength(0);
    expect(await read()).toBe(false);

    // 解約済みはここでは戻せない（「プランを再開」が別経路・T-M8-264）。
    await expect(
      cancelScheduledCancellation(db, gateway({ status: "canceled" }), userId),
    ).rejects.toMatchObject({ code: "subscription_required" });

    // 契約の無い利用者。
    const noSub = randomUUID();
    await db.query(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2)`,
      [noSub, `${noSub}@example.com`],
    );
    await expect(cancelScheduledCancellation(db, gateway(), noSub)).rejects.toMatchObject({
      code: "subscription_required",
    });
  });
});
