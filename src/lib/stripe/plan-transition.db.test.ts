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
    // 初期planは premium にする（最初の sync("standard") が「同一plan」で早期returnしないため）。
    await db.query(
      `update profiles
          set plan = 'premium', subscription_status = 'active',
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
        (id, x_account_id, pattern_id, thread, initial_thread, tweet_ids, tweet_metrics)
       values ($1, $2, (select id from post_patterns where x_account_id = $2 and seed_key = 'p2'), '[{"text":"preserved"}]'::jsonb, '[{"text":"preserved"}]'::jsonb, '["tweet_1"]'::jsonb, '{"tweet_1":{"likes":7}}'::jsonb)`,
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

    // standard の上限は1（2026-08-20運営者の指示）。選択中を最優先で残し、他は disabled。
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
    // disabled はデータ・tokenを消さない（再有効化で戻せる）。
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

    // 選択なし・4件activeから上限1へ: 最古だけ残り、選択は最古へフォールバック。
    const fourthId = randomUUID();
    await db.query(
      `insert into x_accounts
         (id, user_id, x_user_id, handle, name, auth_type,
          access_token_ciphertext, refresh_token_ciphertext, status,
          base_md, base_md_version, created_at)
       values ($1, $2, $3, $4, $4, 'byok', 'ct', 'rt', 'active', 'base fourth', 1,
               '2026-07-04T00:00:00Z')`,
      [fourthId, userId, `x_${fourthId}`, "fourth"],
    );
    await db.query(
      "update x_accounts set status = 'active' where user_id = $1",
      [userId],
    );
    await db.query(
      "update profiles set plan = 'premium', active_x_account_id = null where id = $1",
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

    // BYOK→運営キー系: 全byokが disabled も含めて expired になる（tokenは消さない）。
    await expect(sync("premium")).resolves.toBe("updated");
    const byokAfterPremium = await db.query(
      `select count(*)::int as total,
              count(*) filter (where status = 'expired')::int as expired,
              count(*) filter (where access_token_ciphertext is not null)::int as tokens
         from x_accounts where user_id = $1 and auth_type = 'byok'`,
      [userId],
    );
    expect(byokAfterPremium.rows[0]).toEqual({
      expired: 4,
      tokens: 4,
      total: 4,
    });

    // 運営キー系どうし（premium→expert）はauth_typeを失効させず、expertの上限3で
    // 「選択中→最古」の順に残す（汎用の絞り込み・T-M8-168）。
    const managedIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    for (const [i, id] of managedIds.entries()) {
      await db.query(
        `insert into x_accounts
          (id, user_id, x_user_id, handle, name, auth_type,
           access_token_ciphertext, refresh_token_ciphertext, status, created_at)
         values ($1, $2, $3, $4, $4, 'managed', 'm_access', 'm_refresh', 'active', $5)`,
        [id, userId, `managed_x_${i}`, `managed${i}`, `2026-07-1${i}T00:00:00Z`],
      );
    }
    await db.query(
      "update profiles set active_x_account_id = $2 where id = $1",
      [userId, managedIds[1]],
    );
    await expect(sync("expert")).resolves.toBe("updated");
    const managedTrim = await db.query<{ id: string; status: string }>(
      `select id, status from x_accounts
        where user_id = $1 and auth_type = 'managed' order by created_at`,
      [userId],
    );
    expect(managedTrim.rows).toEqual([
      { id: managedIds[0], status: "active" },
      { id: managedIds[1], status: "active" },
      { id: managedIds[2], status: "active" },
      { id: managedIds[3], status: "disabled" },
    ]);
    const selectionAfterExpert = await db.query(
      "select active_x_account_id from profiles where id = $1",
      [userId],
    );
    expect(selectionAfterExpert.rows[0].active_x_account_id).toBe(managedIds[1]);

    // 運営キー系→BYOKへの降格（managed失効＋BYOK purposes再検証）。BYOKプランは standard。
    await db.query(
      `insert into user_api_keys
        (user_id, provider, credentials_ciphertext, status)
       values ($1, 'anthropic', 'anthropic_secret', 'valid'),
              ($1, 'openai', 'openai_secret', 'invalid')`,
      [userId],
    );
    await db.query(
      `update profiles
          set ai_purpose_config = '{"text":"anthropic","image":"openai"}'::jsonb
        where id = $1`,
      [userId],
    );
    await expect(sync("standard")).resolves.toBe("updated");
    const afterByok = await db.query(
      `select p.active_x_account_id, p.ai_purpose_config,
              x.status, x.access_token_ciphertext,
              (select count(*)::int from user_api_keys k
                where k.user_id = p.id) as key_count
         from profiles p join x_accounts x on x.id = $2
        where p.id = $1`,
      [userId, managedIds[1]],
    );
    expect(afterByok.rows[0]).toEqual({
      access_token_ciphertext: "m_access",
      active_x_account_id: null,
      ai_purpose_config: { image: null, image_model: null, text: "anthropic", text_model: null },
      key_count: 2,
      status: "expired",
    });
  });
});
