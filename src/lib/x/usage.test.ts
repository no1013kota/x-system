import { describe, expect, it } from "vitest";

import { XApiError, type XApiMeta } from "./client";
import type { Queryable } from "./token-refresh";
import { recordedXCall } from "./usage";

function makeDb() {
  const writes: { sql: string; params: unknown[] }[] = [];
  const db: Queryable = {
    query: async <T = unknown>(sql: string, params: unknown[] = []) => {
      writes.push({ sql, params });
      // recordExternalApiUsage は insert ... on conflict do nothing。rowCount=1 を返す。
      return { rows: [] as T[], rowCount: 1 };
    },
  };
  return { db, writes };
}

const ctx = { userId: "u1", xAccountId: "xa1", jobId: "job1" };

/** external_api_usage_events insert の params 位置（api-usage-ledger.ts の順序）。 */
const P = {
  provider: 3,
  operation: 4,
  requestId: 5,
  status: 6,
  httpStatus: 7,
  errorCode: 8,
  quantity: 9,
  unitCost: 11,
  estimatedCost: 12,
  idempotencyKey: 13,
} as const;

const liveCreate = (): XApiMeta & { tweetId: string } => ({
  tweetId: "t-1",
  requestId: "rq-1",
  quantity: 1,
  dryRun: false,
});

describe("recordedXCall", () => {
  it("records a succeeded cost event for a live call", async () => {
    const { db, writes } = makeDb();
    const res = await recordedXCall(
      db,
      { ctx, operation: "x_post_create", unitCostUsd: 0.02, idempotencyKey: "k1" },
      async () => liveCreate(),
    );
    expect(res.tweetId).toBe("t-1");
    expect(writes).toHaveLength(1);
    const p = writes[0].params;
    expect(p[P.provider]).toBe("x");
    expect(p[P.operation]).toBe("x_post_create");
    expect(p[P.status]).toBe("succeeded");
    expect(p[P.requestId]).toBe("rq-1");
    expect(p[P.unitCost]).toBe(0.02);
    expect(p[P.estimatedCost]).toBe(0.02);
    expect(p[P.idempotencyKey]).toBe("k1");
  });

  it("does not record cost for a dry_run result", async () => {
    const { db, writes } = makeDb();
    const res = await recordedXCall(
      db,
      { ctx, operation: "x_post_create", unitCostUsd: 0.02, idempotencyKey: "k2" },
      async () => ({ tweetId: "dryrun-t", requestId: null, quantity: 1, dryRun: true }),
    );
    expect(res.dryRun).toBe(true);
    expect(writes).toHaveLength(0);
  });

  it("records a failed event and rethrows the API error", async () => {
    const { db, writes } = makeDb();
    await expect(
      recordedXCall(
        db,
        { ctx, operation: "x_post_delete", unitCostUsd: 0.005, idempotencyKey: "k3" },
        async () => {
          throw new XApiError(429, "TooManyRequests", "rate_limit");
        },
      ),
    ).rejects.toBeInstanceOf(XApiError);
    expect(writes).toHaveLength(1);
    const p = writes[0].params;
    expect(p[P.status]).toBe("failed");
    expect(p[P.httpStatus]).toBe(429);
    expect(p[P.errorCode]).toBe("TooManyRequests");
    expect(p[P.estimatedCost]).toBe(0); // 失敗はresource未作成→原価0（単価は監査用に残す）
    expect(p[P.unitCost]).toBe(0.005);
  });

  it("multiplies unit cost by resource quantity for reads", async () => {
    const { db, writes } = makeDb();
    await recordedXCall(
      db,
      { ctx, operation: "x_post_read", unitCostUsd: 0.005, idempotencyKey: "k4" },
      async () => ({ tweets: [], requestId: "rq", quantity: 3, dryRun: false }) as XApiMeta,
    );
    expect(writes[0].params[P.quantity]).toBe(3);
    expect(writes[0].params[P.estimatedCost]).toBeCloseTo(0.015, 10);
  });

  it("records an empty read as quantity 0 with $0 (per-resource billing)", async () => {
    // 直近30日に投稿が無いアカウントの毎朝の自動読取（T-M8-94）で毎日発生する形。
    // 以前は Math.max(1, quantity) で最低1件分（$0.005/日）を過大計上していた。
    const { db, writes } = makeDb();
    await recordedXCall(
      db,
      { ctx, operation: "x_post_read", unitCostUsd: 0.005, idempotencyKey: "k5" },
      async () => ({ posts: [], requestId: "rq", quantity: 0, dryRun: false }) as XApiMeta,
    );
    expect(writes).toHaveLength(1); // 呼び出しの痕跡は残す（記録しない、にはしない）
    expect(writes[0].params[P.quantity]).toBe(0);
    expect(writes[0].params[P.estimatedCost]).toBe(0);
  });
});
