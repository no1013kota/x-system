import { randomBytes, randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";


import { encryptWithKey } from "../crypto/envelope";
import { closePool, getPool, withTransaction } from "../db/pool";
import type { ImageGen } from "../ai/image";
import { emptyUsage, type TextGen } from "../ai/types";
import { X_SCOPES } from "../x/oauth";
import type { Queryable } from "../x/token-refresh";
import { executeImageGeneration, type ImageGenerationDeps } from "./image-generation";
import { failJob } from "./worker";

/**
 * DB integration for image_generation の画像枠 reserve/refund（T-M6-04, 要件03 §7.5）。
 * 画像最終失敗で画像枠だけ返還し、親jobで消費済みの生成枠は返還しないことを検証する。
 */
const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQAY3Y2wAAAAAElFTkSuQmCC",
  "base64",
);

describe("image_generation 枠 reserve/refund (local DB)", () => {
  let available = false;
  const testKey = randomBytes(32);
  const encrypt = (p: string) => encryptWithKey(p, testKey);
  const db: Queryable = {
    query: <T = unknown>(sql: string, params?: unknown[]) =>
      getPool().query(sql, params) as unknown as Promise<{ rows: T[]; rowCount: number | null }>,
  };

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

  const textGen: TextGen = {
    generate: async () => ({
      provider: "anthropic",
      requestId: null,
      text: '{"prompt":"a cat on a roof","aspect":"16:9"}',
      citations: [],
      usage: emptyUsage(),
      stopReason: "end_turn",
    }),
  };
  function imageGenOf(fail: boolean): ImageGen {
    return {
      generate: async () => {
        if (fail) throw new Error("image provider 500");
        return {
          provider: "openai",
          requestId: null,
          image: { bytes: PIXEL_PNG, declaredMime: "image/png" },
          requestedSize: "1536x1024",
        };
      },
    };
  }
  function deps(jobId: string, fail: boolean): ImageGenerationDeps {
    return {
      db,
      jobId,
      runInTx: (fn) => withTransaction((c) => fn(c as unknown as Queryable)),
      resolveTextProvider: async () => ({ textGen, provider: "anthropic", model: "m" }),
      resolveImage: async () => ({ imageGen: imageGenOf(fail), provider: "openai" }),
      uploadImage: async () => {},
      recordStage: async () => {},
      makeDeadline: () => ({ remainingMs: () => 90_000, canStartCall: () => true, callTimeoutMs: () => 90_000 }),
    };
  }

  async function seed(c: PoolClient): Promise<{ uid: string; xid: string; jobId: string }> {
    const uid = randomUUID();
    await c.query(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2)`,
      [uid, `${uid}@example.com`],
    );
    await c.query(
      `insert into profiles (id, email, plan, subscription_status, notification_config)
       values ($1,$2,'premium','active','{"draft_created":{"in_app":true,"email":false}}'::jsonb)
       on conflict (id) do update set plan = 'premium', subscription_status = 'active'`,
      [uid, `${uid}@example.com`],
    );
    const xid = (
      await c.query<{ id: string }>(
        `insert into x_accounts (user_id, x_user_id, handle, name, auth_type, status,
            access_token_ciphertext, refresh_token_ciphertext, oauth_scopes, token_expires_at, base_md, base_md_version)
         values ($1,$2,'h','n','byok','active',$3,$3,$4, now()+interval '1 hour','## 3. トーン&マナー\n- 断定調',1)
         returning id`,
        [uid, `x-${randomUUID()}`, encrypt("t"), X_SCOPES],
      )
    ).rows[0].id;
    const draftId = (
      await c.query<{ id: string }>(
        `insert into drafts (x_account_id, pattern_id, thread, initial_thread, status, images)
         values ($1, (select id from post_patterns where x_account_id = $1 and seed_key = 'p1'), $2::jsonb, $2::jsonb, 'draft', '[]'::jsonb) returning id`,
        [xid, JSON.stringify([{ local_id: "p1", text: "本文", weighted_length: 2, sources: [], warnings: [] }])],
      )
    ).rows[0].id;
    const jobId = (
      await c.query<{ id: string }>(
        `insert into generation_jobs (x_account_id, kind, trigger, draft_id, status)
         values ($1,'image_generation','manual',$2,'running') returning id`,
        [xid, draftId],
      )
    ).rows[0].id;
    // 親（post_generation）の消費済みクレジット1を模す（T-M8-109: 文章・画像は同一counter）。
    await c.query(
      `insert into usage_counters (user_id, month, ai_credits_used)
       values ($1, to_char((now() at time zone 'Asia/Tokyo'), 'YYYY-MM'), 1)`,
      [uid],
    );
    return { uid, xid, jobId };
  }

  async function credits(uid: string): Promise<number> {
    const r = (
      await db.query<{ ai_credits_used: number }>(
        `select ai_credits_used from usage_counters where user_id = $1`,
        [uid],
      )
    ).rows[0];
    return r?.ai_credits_used ?? 0;
  }
  const cleanup = async (uid: string) => {
    await withTransaction((c) => c.query(`delete from usage_events where user_id = $1`, [uid]));
    await withTransaction((c) => c.query(`delete from usage_counters where user_id = $1`, [uid]));
    await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));
  };

  it("**失敗しても画像分は引かれない**（予約を廃止したので返還も要らない・T-M8-324）", async () => {
    const { uid, jobId } = await withTransaction((c) => seed(c));
    try {
      await expect(executeImageGeneration(deps(jobId, true))).rejects.toThrow();
      // handler は返還しない（retry差し戻しでクレジットが消える事故を防ぐため）。
      // 実費が確定していないので画像分は0。親の消費1だけが残る。
      // 以前は開始時に見積もりを押さえ、失敗確定で返していた（数字が上下して見えた）。
      expect(await credits(uid)).toBe(1);
      // 失敗確定でも変わらない（返すものが無い）。
      await failJob(jobId, "image_generation", new Error("terminal"));
      expect(await credits(uid)).toBe(1);
    } finally {
      await cleanup(uid);
    }
  });

  it("画像成功で見積もりreserve→実費（原価不明の空文字モデル=最低1）へ精算される", async () => {
    const { uid, jobId } = await withTransaction((c) => seed(c));
    try {
      const res = await executeImageGeneration(deps(jobId, false));
      expect(res.status).toBe("created");
      // 親1 + settle後の画像実費1（テストのresolveImageはmodel未指定→原価0→最低1・T-M8-109）。
      expect(await credits(uid)).toBe(2);
    } finally {
      await cleanup(uid);
    }
  });
});
