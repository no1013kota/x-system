import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { connectLocalDb } from "@/lib/db/test-utils";

import {
  applyPreparedStripeEvent,
  type SubscriptionProjection,
} from "./subscription-sync";

describe("Stripe plan transition side effects", () => {
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

  it("enforces X compatibility/limits and revalidates BYOK purposes without deleting data", async (context) => {
    if (!database) return context.skip();
    const db = database;
    const userId = randomUUID();
    await db.query(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1, '00000000-0000-0000-0000-000000000000',
               'authenticated', 'authenticated', $2)`,
      [userId, `${userId}@example.com`],
    );
    await db.query(
      `update profiles
          set plan = 'md', subscription_status = 'active',
              stripe_customer_id = $2, stripe_subscription_id = $3
        where id = $1`,
      [userId, `cus_${userId}`, `sub_${userId}`],
    );

    const oldestId = randomUUID();
    const selectedId = randomUUID();
    const newestId = randomUUID();
    for (const [id, handle, createdAt] of [
      [oldestId, "oldest", "2026-07-01T00:00:00Z"],
      [selectedId, "selected", "2026-07-02T00:00:00Z"],
      [newestId, "newest", "2026-07-03T00:00:00Z"],
    ]) {
      await db.query(
        `insert into x_accounts
          (id, user_id, x_user_id, handle, name, auth_type,
           access_token_ciphertext, refresh_token_ciphertext, status,
           base_md, base_md_version, created_at)
         values ($1, $2, $3, $4, $4, 'byok', $5, $6, 'active', $7, 1, $8)`,
        [
          id,
          userId,
          `x_${handle}`,
          handle,
          `access_${handle}`,
          `refresh_${handle}`,
          `base ${handle}`,
          createdAt,
        ],
      );
    }
    await db.query(
      "update profiles set active_x_account_id = $2 where id = $1",
      [userId, selectedId],
    );
    await db.query(
      `insert into base_md_versions
        (x_account_id, version, content, change_source)
       values ($1, 1, 'preserved base history', 'settings')`,
      [newestId],
    );
    const draftId = randomUUID();
    await db.query(
      `insert into drafts
        (id, x_account_id, pattern, thread, initial_thread, tweet_ids,
         tweet_metrics)
       values ($1, $2, 'p2', '[{"text":"preserved"}]'::jsonb,
               '[{"text":"preserved"}]'::jsonb,
               '["tweet_1"]'::jsonb, '{"tweet_1":{"likes":7}}'::jsonb)`,
      [draftId, newestId],
    );

    let eventCreated = 1_784_675_200;
    const sync = (plan: SubscriptionProjection["plan"]) =>
      applyPreparedStripeEvent(db, {
        kind: "subscription_sync",
        projection: {
          cancelAtPeriodEnd: false,
          currentPeriodEnd: eventCreated + 2_592_000,
          customerId: `cus_${userId}`,
          eventCreated: eventCreated++,
          plan,
          status: "active",
          subscriptionId: `sub_${userId}`,
          trialEnd: null,
          trialStartedAt: null,
          userId,
        },
      });

    await expect(sync("standard")).resolves.toBe("updated");
    const limited = await db.query<{
      access_token_ciphertext: string;
      base_md: string;
      id: string;
      refresh_token_ciphertext: string;
      status: string;
    }>(
      `select id, status, access_token_ciphertext,
              refresh_token_ciphertext, base_md
         from x_accounts where user_id = $1 order by created_at`,
      [userId],
    );
    expect(limited.rows.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: oldestId, status: "disabled" },
      { id: selectedId, status: "active" },
      { id: newestId, status: "disabled" },
    ]);
    expect(limited.rows.every((row) => row.access_token_ciphertext)).toBe(true);
    expect(limited.rows.every((row) => row.refresh_token_ciphertext)).toBe(true);
    expect(limited.rows.map((row) => row.base_md)).toEqual([
      "base oldest",
      "base selected",
      "base newest",
    ]);
    const preserved = await db.query(
      `select d.thread, d.tweet_ids, d.tweet_metrics,
              (select count(*)::int from base_md_versions b
                where b.x_account_id = $2) as base_history_count
         from drafts d where d.id = $1`,
      [draftId, newestId],
    );
    expect(preserved.rows[0]).toMatchObject({
      base_history_count: 1,
      thread: [{ text: "preserved" }],
      tweet_ids: ["tweet_1"],
      tweet_metrics: { tweet_1: { likes: 7 } },
    });

    await db.query(
      "update x_accounts set status = 'active' where user_id = $1",
      [userId],
    );
    await db.query(
      "update profiles set plan = 'md', active_x_account_id = null where id = $1",
      [userId],
    );
    await expect(sync("standard")).resolves.toBe("updated");
    const oldestFallback = await db.query(
      `select p.active_x_account_id,
              array_agg(x.id order by x.created_at)
                filter (where x.status = 'active') as active_ids
         from profiles p join x_accounts x on x.user_id = p.id
        where p.id = $1 group by p.id`,
      [userId],
    );
    expect(oldestFallback.rows[0]).toEqual({
      active_ids: [oldestId],
      active_x_account_id: oldestId,
    });

    await expect(sync("premium")).resolves.toBe("updated");
    const byokAfterPremium = await db.query(
      `select count(*)::int as total,
              count(*) filter (where status = 'expired')::int as expired,
              count(*) filter (where access_token_ciphertext is not null)::int as tokens
         from x_accounts where user_id = $1 and auth_type = 'byok'`,
      [userId],
    );
    expect(byokAfterPremium.rows[0]).toEqual({
      expired: 3,
      tokens: 3,
      total: 3,
    });

    const managedId = randomUUID();
    await db.query(
      `insert into x_accounts
        (id, user_id, x_user_id, handle, name, auth_type,
         access_token_ciphertext, refresh_token_ciphertext, status)
       values ($1, $2, 'managed_x', 'managed', 'managed', 'managed',
               'managed_access', 'managed_refresh', 'active')`,
      [managedId, userId],
    );
    await db.query(
      `insert into user_api_keys
        (user_id, provider, credentials_ciphertext, status)
       values ($1, 'anthropic', 'anthropic_secret', 'valid'),
              ($1, 'openai', 'openai_secret', 'invalid')`,
      [userId],
    );
    await db.query(
      `update profiles
          set active_x_account_id = $2,
              ai_purpose_config = '{"text":"anthropic","image":"openai"}'::jsonb
        where id = $1`,
      [userId, managedId],
    );
    await expect(sync("md")).resolves.toBe("updated");
    const afterByok = await db.query(
      `select p.active_x_account_id, p.ai_purpose_config,
              x.status, x.access_token_ciphertext,
              (select count(*)::int from user_api_keys k
                where k.user_id = p.id) as key_count
         from profiles p join x_accounts x on x.id = $2
        where p.id = $1`,
      [userId, managedId],
    );
    expect(afterByok.rows[0]).toEqual({
      access_token_ciphertext: "managed_access",
      active_x_account_id: null,
      ai_purpose_config: { image: null, image_model: null, text: "anthropic", text_model: null },
      key_count: 2,
      status: "expired",
    });
  });
});
