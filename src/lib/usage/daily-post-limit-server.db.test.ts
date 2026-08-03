import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closePool, getPool, withTransaction } from "../db/pool";
import { countTodaysPostsForXAccount } from "./daily-post-limit-server";

/**
 * 当日（JST）の投稿数の数え方（T-M8-26・要決定D-15 案A）。
 *
 * この問い合わせは**画面のバナーと投稿jobの両方**が使う。数え方がずれると
 * 「バナーは出ないのに投稿は弾かれる」（またはその逆）というもっとも分かりにくい状態になるので、
 * 境界をDBに対して固定する。特に見えにくいのは次の3つ。
 *
 * - **JSTの日付の境界**（UTCで数えると9時間ずれ、深夜〜朝の判定が壊れる）
 * - **数える種別**（削除＝`post_delete` や生成＝`generation` を数えると、投稿していないのに上限に達する）
 *   なお `post_create` の `reason` は `usage_events_post_op` 制約で `consume` に限られるため、
 *   返却（`refund`）行は**そもそも作れない**。クエリの `reason = 'consume'` は念のための条件。
 * - **Xアカウント単位**（別アカウントの投稿を数えると、切り替えた瞬間に投稿できなくなる）
 */
describe("countTodaysPostsForXAccount (db)", () => {
  let available = false;
  beforeAll(async () => {
    try {
      const c = await getPool().connect();
      c.release();
      available = true;
    } catch {
      available = false;
    }
  });
  afterAll(async () => {
    await closePool();
  });
  beforeEach((ctx) => {
    if (!available) ctx.skip();
  });

  async function makeAccount(c: PoolClient): Promise<{ userId: string; xAccountId: string }> {
    const userId = randomUUID();
    await c.query(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2)`,
      [userId, `${userId}@example.com`],
    );
    const { rows } = await c.query<{ id: string }>(
      `insert into x_accounts (user_id, x_user_id, handle, name, auth_type, status)
       values ($1, $2, $3, 'daily limit test', 'managed', 'active')
       returning id`,
      [userId, `x-${userId}`, `dl_${randomUUID().slice(0, 8)}`],
    );
    return { userId, xAccountId: rows[0].id };
  }

  /**
   * 消費イベントを1件積む。`offset` は now() からの間隔（SQLのinterval文字列）。
   *
   * `counter_type` は operation に合わせる（`usage_events_post_op` 制約が投稿系の組み合わせを縛る）。
   */
  async function addEvent(
    c: PoolClient,
    seed: { userId: string; xAccountId: string },
    opts: { operation: "post_create" | "post_delete" | "generation"; offset: string },
  ): Promise<void> {
    const counterType = opts.operation === "generation" ? "generation" : "post_normal";
    await c.query(
      `insert into usage_events
         (user_id, x_account_id, month, counter_type, operation, delta, reason,
          idempotency_key, created_at)
       values ($1, $2, to_char(now() at time zone 'Asia/Tokyo', 'YYYY-MM'),
               $3::usage_counter_type, $4::usage_event_operation, 1, 'consume',
               $5, now() + $6::interval)`,
      [seed.userId, seed.xAccountId, counterType, opts.operation, randomUUID(), opts.offset],
    );
  }

  const cleanup = async (seed: { userId: string }) => {
    await withTransaction(async (c) => {
      await c.query(`delete from usage_events where user_id = $1`, [seed.userId]);
      await c.query(`delete from auth.users where id = $1`, [seed.userId]);
    });
  };

  it("当日JSTの post_create だけを数える（削除・生成は数えない）", async () => {
    const seed = await withTransaction(makeAccount);
    try {
      await withTransaction(async (c) => {
        await addEvent(c, seed, { operation: "post_create", offset: "0" });
        await addEvent(c, seed, { operation: "post_create", offset: "-1 minute" });
        // 削除は「Xへ出た本数」ではないので数えない。
        await addEvent(c, seed, { operation: "post_delete", offset: "0" });
        // 生成（下書きを作っただけ）も投稿ではない。
        await addEvent(c, seed, { operation: "generation", offset: "0" });
      });
      expect(await countTodaysPostsForXAccount(getPool(), seed.xAccountId)).toBe(2);
    } finally {
      await cleanup(seed);
    }
  });

  it("**別のJST日付の投稿は数えない**（UTCで数えると9時間ずれる）", async () => {
    const seed = await withTransaction(makeAccount);
    try {
      await withTransaction(async (c) => {
        await addEvent(c, seed, { operation: "post_create", offset: "0" });
        // 前日・翌日のJST日付になる時刻。日付が変わる境界は必ず跨ぐ。
        await addEvent(c, seed, { operation: "post_create", offset: "-25 hours" });
        await addEvent(c, seed, { operation: "post_create", offset: "25 hours" });
      });
      expect(await countTodaysPostsForXAccount(getPool(), seed.xAccountId)).toBe(1);
    } finally {
      await cleanup(seed);
    }
  });

  it("**別のXアカウントの投稿は数えない**（上限はアカウント単位）", async () => {
    const seed = await withTransaction(makeAccount);
    const other = await withTransaction(makeAccount);
    try {
      await withTransaction(async (c) => {
        await addEvent(c, seed, { operation: "post_create", offset: "0" });
        await addEvent(c, other, { operation: "post_create", offset: "0" });
        await addEvent(c, other, { operation: "post_create", offset: "0" });
      });
      expect(await countTodaysPostsForXAccount(getPool(), seed.xAccountId)).toBe(1);
      expect(await countTodaysPostsForXAccount(getPool(), other.xAccountId)).toBe(2);
    } finally {
      await cleanup(seed);
      await cleanup(other);
    }
  });

  it("1件も無ければ0（行が無いことを失敗と混同しない）", async () => {
    const seed = await withTransaction(makeAccount);
    try {
      expect(await countTodaysPostsForXAccount(getPool(), seed.xAccountId)).toBe(0);
    } finally {
      await cleanup(seed);
    }
  });
});
