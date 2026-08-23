import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { connectLocalDb } from "@/lib/db/test-utils";

import { backfillSubscriptionPeriods } from "./period-backfill";

/**
 * 契約期間の補完（T-M8-258 の移行）。既存契約者の `current_period_start` が null のあいだは
 * 暦月で数える後方互換に落ちるため、日次で Stripe から埋める。期間の2列だけ書き、契約本体と
 * `subscription_event_created_at` は触らない（後続の webhook を stale にしない）。
 */
describe("backfillSubscriptionPeriods (db)", () => {
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

  it("fills only null period columns for active subscriptions and records failures", async (context) => {
    if (!database) return context.skip();
    const db = database;
    const mk = async (status: string, subId: string | null, start: string | null) => {
      const id = randomUUID();
      await db.query(
        `insert into auth.users (id, instance_id, aud, role, email)
         values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2)`,
        [id, `${id}@example.com`],
      );
      await db.query(
        `update profiles set plan = 'premium', subscription_status = $2::subscription_status,
                stripe_subscription_id = $3, current_period_start = $4,
                subscription_event_created_at = '2026-08-01T00:00:00Z'
          where id = $1`,
        [id, status, subId, start],
      );
      return id;
    };
    const target = await mk("active", "sub_fill", null);
    const broken = await mk("active", "sub_missing", null);
    const already = await mk("active", "sub_done", "2026-08-14T15:00:00Z");
    const canceled = await mk("canceled", "sub_gone", null);

    const retrieved: string[] = [];
    const result = await backfillSubscriptionPeriods({
      db,
      stripe: {
        subscriptions: {
          retrieve: async (id) => {
            retrieved.push(id);
            if (id === "sub_missing") throw new Error("No such subscription");
            return {
              id,
              items: { data: [{ current_period_start: 1_787_000_000, current_period_end: 1_789_600_000 }] },
            } as never;
          },
        },
      },
    });
    // ローカルDBの他の契約者（seed等）も対象に入りうるので、自分の行で判定する（transaction内で戻る）。
    expect(result.checked).toBeGreaterThanOrEqual(2);
    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(retrieved).toContain("sub_fill");
    expect(retrieved).toContain("sub_missing");
    expect(retrieved, "同期済み・解約済みは Stripe を読まない").not.toContain("sub_done");
    expect(retrieved).not.toContain("sub_gone");

    const rows = await db.query<{ id: string; start: Date | null; end: Date | null; ev: Date | null }>(
      `select id, current_period_start as start, current_period_end as "end", subscription_event_created_at as ev
         from profiles where id = any($1)`,
      [[target, broken, already, canceled]],
    );
    const by = new Map(rows.rows.map((r) => [r.id, r]));
    expect(by.get(target)?.start).toEqual(new Date(1_787_000_000 * 1000));
    expect(by.get(target)?.end).toEqual(new Date(1_789_600_000 * 1000));
    expect(by.get(target)?.ev, "イベント時刻は進めない").toEqual(new Date("2026-08-01T00:00:00Z"));
    expect(by.get(broken)?.start, "読めなかった契約者は null のまま（翌日に再試行）").toBeNull();
    expect(by.get(already)?.start, "同期済みは触らない").toEqual(new Date("2026-08-14T15:00:00Z"));
    expect(by.get(canceled)?.start, "解約済みは対象外").toBeNull();
  });
});
