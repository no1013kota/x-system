import { describe, expect, it } from "vitest";

import { XApiError, type XClientDeps, type XHttp } from "./client";
import { readTweetMetrics, readUserFollowers, readUserTimeline } from "./read-client";
import type { Queryable } from "./token-refresh";

const LEDGER = /insert into external_api_usage_events/;

interface LedgerRow {
  operation: unknown;
  status: unknown;
  key: unknown;
}

function mockDb() {
  const ledger: LedgerRow[] = [];
  const db: Queryable = {
    query: async <T = unknown>(sql: string, params: unknown[] = []) => {
      if (LEDGER.test(sql)) {
        ledger.push({ operation: params[4], status: params[6], key: params[13] });
      }
      return { rows: [] as T[], rowCount: 1 };
    },
  };
  return { db, ledger };
}

/** URL でディスパッチする mock XHttp。handler は {status, json} を返す。 */
function mockHttp(handler: (u: URL) => { status?: number; json?: unknown }): {
  http: XHttp;
  calls: URL[];
} {
  const calls: URL[] = [];
  const http: XHttp = async (req) => {
    const u = new URL(req.url);
    calls.push(u);
    const { status = 200, json = {} } = handler(u);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(json),
      requestId: "req-1",
    };
  };
  return { http, calls };
}

function xDeps(http: XHttp): XClientDeps {
  return { http, mode: "live", sleep: async () => {}, rng: () => 0, newId: () => "id" };
}

const ctx = { userId: "u1", xAccountId: "xa1", jobId: null };

/**
 * 単価snapshot（T-M8-91）。読取は応答のresource数で乗算課金されるため、0でない値を渡して
 * 「単価が台帳へそのまま渡ること」を検証する（0だと単価の配線漏れがテストに映らない）。
 */
const COSTS = {
  contentCreateUsd: 0.015,
  contentCreateWithUrlUsd: 0.2,
  interactionDeleteUsd: 0.01,
  postReadUsd: 0.005,
  userReadUsd: 0.01,
};
const posts = (n: number, prefix: string) =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}-${i}`, text: "t" }));

describe("readUserTimeline", () => {
  it("paginates until the limit and records one x_post_read per page", async () => {
    const { http, calls } = mockHttp((u) => {
      if (u.pathname.endsWith("/tweets")) {
        const token = u.searchParams.get("pagination_token");
        return token
          ? { json: { data: posts(25, "b") } } // page 2: no next_token
          : { json: { data: posts(25, "a"), meta: { next_token: "t1" } } };
      }
      return { json: {} };
    });
    const { db, ledger } = mockDb();
    const res = await readUserTimeline(
      { db, x: xDeps(http), accessToken: "tok", ctx, costs: COSTS },
      { userId: "acc1", limit: 40, idempotencyKeyBase: "learning:s1:posts" },
    );
    expect(res.posts).toHaveLength(40); // sliced to limit across 2 pages
    expect(calls.filter((c) => c.pathname.endsWith("/tweets"))).toHaveLength(2);
    const reads = ledger.filter((l) => l.operation === "x_post_read");
    expect(reads.map((r) => r.key)).toEqual(["learning:s1:posts:page:0", "learning:s1:posts:page:1"]);
    expect(reads.every((r) => r.status === "succeeded")).toBe(true);
  });

  it("stops after one page when there is no next_token", async () => {
    const { http, calls } = mockHttp(() => ({ json: { data: posts(20, "a") } }));
    const { db, ledger } = mockDb();
    const res = await readUserTimeline(
      { db, x: xDeps(http), accessToken: "tok", ctx, costs: COSTS },
      { userId: "acc1", limit: 20, idempotencyKeyBase: "k" },
    );
    expect(res.posts).toHaveLength(20);
    expect(calls).toHaveLength(1);
    expect(ledger).toHaveLength(1);
  });

  it("records a failed x_post_read and rethrows on 401 (auth, no retry)", async () => {
    const { http, calls } = mockHttp(() => ({ status: 401, json: { title: "Unauthorized" } }));
    const { db, ledger } = mockDb();
    await expect(
      readUserTimeline(
        { db, x: xDeps(http), accessToken: "tok", ctx, costs: COSTS },
        { userId: "acc1", limit: 20, idempotencyKeyBase: "k" },
      ),
    ).rejects.toBeInstanceOf(XApiError);
    expect(calls).toHaveLength(1); // 401 not retried
    expect(ledger).toEqual([{ operation: "x_post_read", status: "failed", key: "k:page:0" }]);
  });
});

describe("readTweetMetrics", () => {
  it("chunks tweet ids at 100 and records one x_post_read per chunk", async () => {
    const { http, calls } = mockHttp((u) => {
      const ids = (u.searchParams.get("ids") ?? "").split(",").filter(Boolean);
      return { json: { data: ids.map((id) => ({ id, public_metrics: { like_count: 1 } })) } };
    });
    const { db, ledger } = mockDb();
    const ids = Array.from({ length: 150 }, (_, i) => `t${i}`);
    const res = await readTweetMetrics(
      { db, x: xDeps(http), accessToken: "tok", ctx, costs: COSTS },
      { tweetIds: ids, idempotencyKeyBase: "metrics:xa1:w1" },
    );
    expect(res.tweets).toHaveLength(150); // 100 + 50 merged
    expect(calls).toHaveLength(2);
    expect(ledger.map((l) => l.key)).toEqual(["metrics:xa1:w1:chunk:0", "metrics:xa1:w1:chunk:1"]);
    expect(ledger.every((l) => l.operation === "x_post_read")).toBe(true);
  });
});

describe("readUserFollowers", () => {
  it("looks up followers_count and records x_user_read", async () => {
    const { http } = mockHttp((u) => {
      const ids = (u.searchParams.get("ids") ?? "").split(",");
      return {
        json: {
          data: ids.map((id) => ({ id, username: `u${id}`, public_metrics: { followers_count: 42 } })),
        },
      };
    });
    const { db, ledger } = mockDb();
    const res = await readUserFollowers(
      { db, x: xDeps(http), accessToken: "tok", ctx, costs: COSTS },
      { userIds: ["9"], idempotencyKey: "follower:xa1:2026-07-24" },
    );
    expect(res.users[0].followersCount).toBe(42);
    expect(ledger).toEqual([
      { operation: "x_user_read", status: "succeeded", key: "follower:xa1:2026-07-24" },
    ]);
  });
});
