import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { ProviderCall } from "../ai/normalize";
import { closePool, getPool, withTransaction } from "./pool";
import {
  providerCallToUsageEvent,
  recordExternalApiUsage,
} from "./api-usage-ledger";
import type { Queryable } from "../x/token-refresh";

/**
 * DB integration for the cost ledger (T-M3-03, 要件02 §3.17・要件04 §10):
 * idempotent external_api_usage_events insert keyed on idempotency_key. Skips without the stack.
 */
describe("external_api_usage_events ledger (local DB)", () => {
  let available = false;
  const db: Queryable = {
    query: <T = unknown>(sql: string, params?: unknown[]) =>
      getPool().query(sql, params) as unknown as Promise<{
        rows: T[];
        rowCount: number | null;
      }>,
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

  async function makeUser(c: PoolClient): Promise<string> {
    const uid = randomUUID();
    await c.query(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2)`,
      [uid, `${uid}@example.com`],
    );
    await c.query(
      `insert into profiles (id, email) values ($1,$2) on conflict (id) do nothing`,
      [uid, `${uid}@example.com`],
    );
    return uid;
  }

  it("records a provider call idempotently by idempotency_key", async () => {
    const uid = await withTransaction((c) => makeUser(c));
    const key = `job-${randomUUID()}:anthropic:0`;
    try {
      const call: ProviderCall = {
        provider: "anthropic",
        model: "claude",
        operation: "text_generation",
        request_id: "req_1",
        status: "succeeded",
        stop_reason: "end_turn",
        latency_ms: 1200,
        input_tokens: 1000,
        output_tokens: 500,
        web_search_count: 2,
        cache_hit: false,
        citations: [],
        error_code: null,
        estimated_cost_usd: 0.02,
      };
      const event = providerCallToUsageEvent(call, { userId: uid, idempotencyKey: key });

      const first = await recordExternalApiUsage(db, event);
      const second = await recordExternalApiUsage(db, event); // retry / duplicate
      expect(first).toBe(true);
      expect(second).toBe(false);

      const rows = (
        await db.query<{
          n: number;
          provider: string;
          operation: string;
          status: string;
          estimated_cost_usd: string;
        }>(
          `select count(*)::int as n, min(provider) as provider, min(operation) as operation,
                  min(status) as status, min(estimated_cost_usd) as estimated_cost_usd
             from external_api_usage_events where idempotency_key = $1`,
          [key],
        )
      ).rows[0];
      expect(rows.n).toBe(1);
      expect(rows.provider).toBe("anthropic");
      expect(rows.operation).toBe("text_generation");
      expect(rows.status).toBe("succeeded");
      expect(Number(rows.estimated_cost_usd)).toBeCloseTo(0.02, 6);
    } finally {
      await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));
    }
  });

  it("records failed calls too (成功・失敗を問わず記録)", async () => {
    const uid = await withTransaction((c) => makeUser(c));
    try {
      const inserted = await recordExternalApiUsage(db, {
        userId: uid,
        provider: "openai",
        operation: "text_generation",
        status: "failed",
        httpStatus: 503,
        errorCode: "provider_error",
        unitCostUsd: 0,
        estimatedCostUsd: 0,
        idempotencyKey: `fail-${randomUUID()}`,
      });
      expect(inserted).toBe(true);
      const row = (
        await db.query<{ status: string; error_code: string; http_status: number }>(
          `select status, error_code, http_status from external_api_usage_events
            where user_id = $1`,
          [uid],
        )
      ).rows[0];
      expect(row.status).toBe("failed");
      expect(row.error_code).toBe("provider_error");
      expect(row.http_status).toBe(503);
    } finally {
      await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));
    }
  });

  it("accepts quantity 0 (X読取の0件応答は$0で正直に記録する)", async () => {
    // 制約は quantity >= 0（20260815000002）。毎朝の自動読取で投稿0件の日は quantity=0 になる。
    const uid = await withTransaction((c) => makeUser(c));
    try {
      const inserted = await recordExternalApiUsage(db, {
        userId: uid,
        provider: "x",
        operation: "x_post_read",
        status: "succeeded",
        quantity: 0,
        unitCostUsd: 0.005,
        estimatedCostUsd: 0,
        idempotencyKey: `empty-read-${randomUUID()}`,
      });
      expect(inserted).toBe(true);
      const row = (
        await db.query<{ quantity: number; estimated_cost_usd: string }>(
          `select quantity, estimated_cost_usd from external_api_usage_events where user_id = $1`,
          [uid],
        )
      ).rows[0];
      expect(row.quantity).toBe(0);
      expect(Number(row.estimated_cost_usd)).toBe(0);
    } finally {
      await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));
    }
  });

  /**
   * 誰の負担か（payer・T-M8-422）は記録時点のプラン／auth_type で決まる。列を持たなかった間は
   * BYOK の費用が /admin の「原価」に混ざっていた。ここは**実際に insert して**列と CHECK を確かめる
   * （CLAUDE.md「DBへ書く値の形式」の行）。
   */
  it("payer は記録時点のプラン／auth_type で決まり、明示指定が優先し、他の値は CHECK が弾く", async () => {
    const uid = await withTransaction((c) => makeUser(c));
    const payerOf = async (key: string) =>
      (await db.query<{ payer: string }>(
        `select payer from external_api_usage_events where idempotency_key = $1`,
        [key],
      )).rows[0]?.payer;
    const base = (key: string, extra: Partial<Parameters<typeof recordExternalApiUsage>[1]> = {}) => ({
      userId: uid,
      provider: "anthropic" as const,
      operation: "text_generation",
      status: "succeeded" as const,
      unitCostUsd: 0.01,
      estimatedCostUsd: 0.01,
      idempotencyKey: key,
      ...extra,
    });
    try {
      // プラン無し → 運営負担（小さく見せない側）。
      const k0 = `payer-${randomUUID()}`;
      await recordExternalApiUsage(db, base(k0));
      expect(await payerOf(k0)).toBe("operator");
      // スタンダード（BYOK）→ 利用者負担。
      await db.query(`update profiles set plan = 'standard' where id = $1`, [uid]);
      const k1 = `payer-${randomUUID()}`;
      await recordExternalApiUsage(db, base(k1));
      expect(await payerOf(k1)).toBe("user");
      // プレミアム（運営キー）→ 運営負担。
      await db.query(`update profiles set plan = 'premium' where id = $1`, [uid]);
      const k2 = `payer-${randomUUID()}`;
      await recordExternalApiUsage(db, base(k2));
      expect(await payerOf(k2)).toBe("operator");
      // X は auth_type で決まる（byok=利用者自身のXアプリ）。
      const xid = (
        await db.query<{ id: string }>(
          `insert into x_accounts (user_id, x_user_id, handle, name, auth_type, status)
           values ($1, $2, 'h', 'n', 'byok', 'active') returning id`,
          [uid, `x-${uid.slice(0, 8)}`],
        )
      ).rows[0].id;
      const k3 = `payer-${randomUUID()}`;
      await recordExternalApiUsage(db, base(k3, { provider: "x", operation: "x_post_create", xAccountId: xid }));
      expect(await payerOf(k3)).toBe("user");
      await db.query(`update x_accounts set auth_type = 'managed' where id = $1`, [xid]);
      const k4 = `payer-${randomUUID()}`;
      await recordExternalApiUsage(db, base(k4, { provider: "x", operation: "x_post_create", xAccountId: xid }));
      expect(await payerOf(k4)).toBe("operator");
      // 明示指定が優先する。
      const k5 = `payer-${randomUUID()}`;
      await recordExternalApiUsage(db, base(k5, { payer: "user" }));
      expect(await payerOf(k5)).toBe("user");
      // CHECK: それ以外の値は入らない。
      await expect(
        db.query(
          `insert into external_api_usage_events
             (user_id, provider, operation, status, idempotency_key, payer)
           values ($1, 'anthropic', 'text_generation', 'succeeded', $2, 'someone')`,
          [uid, `payer-${randomUUID()}`],
        ),
      ).rejects.toThrow(/external_api_usage_payer_valid/);
    } finally {
      await db.query(`delete from auth.users where id = $1`, [uid]);
    }
  });
});
