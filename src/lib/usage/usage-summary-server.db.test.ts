import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closePool, getPool, withTransaction } from "../db/pool";
import { loadUsageSummaryForUser } from "./usage-summary-server";

/**
 * DB integration for premium 残量サマリ読取（T-M6-12, 要件03 §8）。当月(JST)の usage_counters を読み、
 * premium のみサマリを返し、非premium は null、counter行が無ければ全0（満枠）になることを検証する。
 */
describe("loadUsageSummaryForUser (db)", () => {
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

  async function makeUser(c: PoolClient): Promise<string> {
    const uid = randomUUID();
    await c.query(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2)`,
      [uid, `${uid}@example.com`],
    );
    await c.query(`insert into profiles (id, email) values ($1, $2) on conflict (id) do nothing`, [
      uid,
      `${uid}@example.com`,
    ]);
    return uid;
  }
  const cleanup = async (uid: string) => {
    await withTransaction((c) => c.query(`delete from usage_counters where user_id = $1`, [uid]));
    await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));
  };

  /** 未同期（current_period_start が null）の利用者は従来どおり JST 暦月で数える（T-M8-258 の後方互換）。 */
  it("returns the current-month summary for premium", async () => {
    const uid = await withTransaction((c) => makeUser(c));
    try {
      await withTransaction((c) =>
        c.query(
          `insert into usage_counters
             (user_id, month, normal_posts_count, url_posts_count, ai_credits_used)
           values ($1, to_char((now() at time zone 'Asia/Tokyo'), 'YYYY-MM'), 38, 8, 220)`,
          [uid],
        ),
      );
      const s = await loadUsageSummaryForUser(uid, "premium");
      expect(s).toEqual({
        ai_credits: { used: 220, limit: 1000, remaining: 780 },
        normal_posts: { used: 38, limit: 200, remaining: 162 },
        url_posts: { used: 8, limit: 20, remaining: 12 },
        concealed: false,
        paused: false,
        resetsAt: null,
      });
    } finally {
      await cleanup(uid);
    }
  });

  /**
   * 契約期間が同期済みなら、期間キー（開始日の JST 日付）の行だけを読み、暦月の行は無視する（T-M8-258）。
   * リセット日は契約の次回更新日。
   */
  it("reads the subscription-period row (not the calendar month) once the period is synced", async () => {
    const uid = await withTransaction((c) => makeUser(c));
    try {
      await withTransaction((c) =>
        c.query(
          `update profiles
              set current_period_start = '2026-08-14T15:00:00Z', -- 8/15 00:00 JST
                  current_period_end = '2026-09-14T15:00:00Z'
            where id = $1`,
          [uid],
        ),
      );
      await withTransaction((c) =>
        c.query(
          `insert into usage_counters (user_id, month, normal_posts_count, url_posts_count, ai_credits_used)
           values ($1, to_char((now() at time zone 'Asia/Tokyo'), 'YYYY-MM'), 99, 9, 999),
                  ($1, '2026-08-15', 3, 1, 50)`,
          [uid],
        ),
      );
      const s = await loadUsageSummaryForUser(uid, "premium");
      expect(s?.normal_posts, "暦月の行（99）ではなく期間の行（3）").toEqual({ used: 3, limit: 200, remaining: 197 });
      expect(s?.ai_credits.used).toBe(50);
      expect(new Date(s?.resetsAt ?? "").toISOString()).toBe("2026-09-14T15:00:00.000Z");

      // トライアル中はリセット日を出さない（リセットは最初の有料期間の終わり・D-38）。
      await withTransaction((c) =>
        c.query(
          `update profiles set trial_used_at = current_period_start, trial_ends_at = current_period_end where id = $1`,
          [uid],
        ),
      );
      expect((await loadUsageSummaryForUser(uid, "premium"))?.resetsAt).toBeNull();
    } finally {
      await cleanup(uid);
    }
  });

  it("returns null for non-premium (standard/md do not have monthly quotas)", async () => {
    const uid = await withTransaction((c) => makeUser(c));
    try {
      expect(await loadUsageSummaryForUser(uid, "standard")).toBeNull();
      expect(await loadUsageSummaryForUser(uid, "md")).toBeNull();
    } finally {
      await cleanup(uid);
    }
  });

  it("returns all-zero (full remaining) when no counter row exists this month", async () => {
    const uid = await withTransaction((c) => makeUser(c));
    try {
      const s = await loadUsageSummaryForUser(uid, "premium");
      expect(s?.normal_posts).toEqual({ used: 0, limit: 200, remaining: 200 });
      expect(s?.ai_credits).toEqual({ used: 0, limit: 1000, remaining: 1000 });
    } finally {
      await cleanup(uid);
    }
  });
});
