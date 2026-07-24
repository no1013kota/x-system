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
});
