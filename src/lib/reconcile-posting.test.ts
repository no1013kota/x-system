import { describe, expect, it, vi } from "vitest";

import { reconcileDraftPosting, type ReconcileDeps } from "./reconcile-posting";
import type { Queryable } from "./x/token-refresh";

type Row = Record<string, unknown>;

const LOAD = /select d\.status, d\.thread, d\.tweet_ids/;
const POSTED = /status = 'posted'/;
const USAGE = /insert into usage_events/;
const UPD_ERROR = /update drafts set last_post_error/;

function makeDb(handler: (sql: string) => Row[]) {
  const writes: { sql: string; params: unknown[] }[] = [];
  const db: Queryable = {
    query: async <T = unknown>(sql: string, params: unknown[] = []) => {
      writes.push({ sql, params });
      const rows = handler(sql) as T[];
      return { rows, rowCount: rows.length };
    },
  };
  return { db, writes };
}

function post(local_id: string, text: string) {
  return { local_id, text, weighted_length: 5, sources: [], warnings: [] };
}

function draftRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    status: "failed",
    thread: [post("p1", "本文1"), post("p2", "本文2")],
    tweet_ids: [],
    last_post_error: null,
    quote_url: null,
    x_account_id: "xa1",
    x_user_id: "xu1",
    user_id: "u1",
    ...over,
  };
}

function deps(db: Queryable, over: Partial<ReconcileDeps> = {}): ReconcileDeps {
  return {
    db,
    getAccessToken: async () => "tok",
    getRecentPosts: async () => [],
    checkTweetExists: async () => true,
    now: () => 1_700_000_000_000,
    ...over,
  };
}

describe("reconcileDraftPosting — create reconcile", () => {
  it("completes the thread and marks posted when all posts are found", async () => {
    const { db, writes } = makeDb((sql) => (LOAD.test(sql) ? [draftRow({ tweet_ids: ["t-0"] })] : []));
    const getRecentPosts = vi.fn(async () => [
      { id: "t-0", text: "本文1", createdAt: null, inReplyToId: null },
      { id: "c-1", text: "本文2", createdAt: null, inReplyToId: "t-0" },
    ]);
    const res = await reconcileDraftPosting(deps(db, { getRecentPosts }), {
      userId: "u1",
      draftId: "d1",
    });
    expect(res).toEqual({ status: "posted", draftId: "d1" });
    // 新規確定分 c-1 のみ post_create consume を補完
    const consume = writes.find((w) => USAGE.test(w.sql));
    expect(consume?.params[3]).toBe("c-1");
    expect(consume?.params[5]).toBe("post_create");
    // tweet_ids 完備 + posted 確定
    const posted = writes.find((w) => POSTED.test(w.sql));
    expect(JSON.parse(posted?.params[1] as string)).toEqual(["t-0", "c-1"]);
    expect(posted?.params[2]).toBe("t-0");
  });

  it("stays failed when a post cannot be matched uniquely", async () => {
    const { db, writes } = makeDb((sql) => (LOAD.test(sql) ? [draftRow({ tweet_ids: ["t-0"] })] : []));
    const getRecentPosts = vi.fn(async () => [
      { id: "t-0", text: "本文1", createdAt: null, inReplyToId: null },
    ]); // 本文2 の候補なし
    const res = await reconcileDraftPosting(deps(db, { getRecentPosts }), {
      userId: "u1",
      draftId: "d1",
    });
    expect(res).toEqual({ status: "still_failed", draftId: "d1" });
    expect(writes.some((w) => POSTED.test(w.sql))).toBe(false);
  });
});

describe("reconcileDraftPosting — delete reconcile", () => {
  const rolledBack = () =>
    draftRow({
      tweet_ids: ["t-0", "t-1"],
      last_post_error: { code: "post_create_failed", ambiguous_delete_tweet_ids: ["t-0", "t-1"], deleted_tweet_ids: [] },
    });

  it("confirms deletions and completes post_delete consume, clearing ambiguity", async () => {
    const { db, writes } = makeDb((sql) => (LOAD.test(sql) ? [rolledBack()] : []));
    const res = await reconcileDraftPosting(
      deps(db, { checkTweetExists: async () => false }), // 両方消えている
      { userId: "u1", draftId: "d1" },
    );
    expect(res).toMatchObject({ status: "deletes_reconciled", remaining: [] });
    const deletes = writes.filter((w) => USAGE.test(w.sql) && w.params[5] === "post_delete");
    expect(deletes).toHaveLength(2);
    const errUpd = writes.find((w) => UPD_ERROR.test(w.sql));
    const err = JSON.parse(errUpd?.params[1] as string);
    expect(err.ambiguous_delete_tweet_ids).toEqual([]);
    expect(err.deleted_tweet_ids).toEqual(["t-0", "t-1"]);
  });

  it("keeps still-existing tweets as unresolved (failed maintained)", async () => {
    const { db, writes } = makeDb((sql) => (LOAD.test(sql) ? [rolledBack()] : []));
    const res = await reconcileDraftPosting(
      deps(db, { checkTweetExists: async (_t, id) => id === "t-1" }), // t-1 はまだ存在
      { userId: "u1", draftId: "d1" },
    );
    expect(res.status).toBe("deletes_reconciled");
    expect((res as { remaining: string[] }).remaining).toContain("t-1");
    const deletes = writes.filter((w) => USAGE.test(w.sql) && w.params[5] === "post_delete");
    expect(deletes).toHaveLength(1); // t-0 のみ
  });
});

describe("reconcileDraftPosting — guards", () => {
  it("rejects a non-failed draft", async () => {
    const { db } = makeDb((sql) => (LOAD.test(sql) ? [draftRow({ status: "draft" })] : []));
    await expect(
      reconcileDraftPosting(deps(db), { userId: "u1", draftId: "d1" }),
    ).rejects.toMatchObject({ code: "job_conflict" });
  });

  it("throws not_found for an unowned draft", async () => {
    const { db } = makeDb(() => []);
    await expect(
      reconcileDraftPosting(deps(db), { userId: "u1", draftId: "d1" }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
