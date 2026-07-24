import { describe, expect, it, vi } from "vitest";

import type { XCreatePostResult } from "../x/client";
import type { Queryable } from "../x/token-refresh";
import {
  PostPublishError,
  executePostPublish,
  type PostPublishDeps,
} from "./post-publish";

type Row = Record<string, unknown>;

const LOAD_JOB = /select gj\.draft_id, gj\.input, gj\.trigger/;
const LOAD_DRAFT = /select status, thread, images, tweet_ids/;
const LOCK = /update drafts set status = 'posting'/;
const DAILY = /count\(\*\)::int as n from usage_events/;
const APPEND_TWEET = /update drafts set tweet_ids/;
const CONSUME = /insert into usage_events/;
const POSTED = /update drafts\s+set status = 'posted'/;
const NOTIFY = /insert into notifications/;
const FAILED = /update drafts set status = 'failed'/;
const REVERT_DRAFT = /update drafts set status = 'draft'/;

function makeDb(handler: (sql: string, params: unknown[]) => Row[]) {
  const writes: { sql: string; params: unknown[] }[] = [];
  const db: Queryable = {
    query: async <T = unknown>(sql: string, params: unknown[] = []) => {
      writes.push({ sql, params });
      const rows = handler(sql, params) as T[];
      return { rows, rowCount: rows.length };
    },
  };
  return { db, writes };
}

const COST = { contentCreateUsd: 0.01, contentCreateWithUrlUsd: 0.02, interactionDeleteUsd: 0.005 };

function post(local_id: string, text: string, warnings: string[] = []) {
  return { local_id, text, weighted_length: 10, sources: [], warnings };
}

const JOB = {
  draft_id: "d1",
  input: { mode: "manual" as const },
  trigger: "manual",
  x_account_id: "xa1",
  user_id: "u1",
  plan: "standard",
};

function draftRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    status: "draft",
    thread: [post("p1", "本文1"), post("p2", "本文2")],
    images: [],
    tweet_ids: [],
    quote_url: null,
    ...over,
  };
}

function baseDeps(db: Queryable, over: Partial<PostPublishDeps> = {}): PostPublishDeps {
  let seq = 0;
  const createPost = vi.fn(
    async (): Promise<XCreatePostResult> => ({
      tweetId: `dryrun-tweet-${++seq}`,
      requestId: null,
      quantity: 1,
      dryRun: true,
    }),
  );
  return {
    db,
    jobId: "job1",
    getAccessToken: async () => "tok",
    createPost,
    uploadMedia: vi.fn(async () => ({ mediaId: "dryrun-media", requestId: null, quantity: 1, dryRun: true })),
    downloadImage: vi.fn(async () => ({ data: Buffer.from("img"), mimeType: "image/webp" })),
    costConfig: COST,
    dailyLimit: 50,
    recordStage: async () => {},
    ...over,
  };
}

function okHandler(draft = draftRow()) {
  return (sql: string): Row[] => {
    if (LOAD_JOB.test(sql)) return [JOB];
    if (LOAD_DRAFT.test(sql)) return [draft];
    if (LOCK.test(sql)) return [{ id: "d1" }];
    if (DAILY.test(sql)) return [{ n: 0 }];
    return [];
  };
}

describe("executePostPublish happy path (dry_run)", () => {
  it("posts a thread as a reply chain, saves tweet_ids, consumes, and marks posted", async () => {
    const { db, writes } = makeDb(okHandler());
    const deps = baseDeps(db);
    const res = await executePostPublish(deps);

    expect(res.status).toBe("posted");
    expect(res.tweetIds).toEqual(["dryrun-tweet-1", "dryrun-tweet-2"]);

    // 1ポスト目は reply なし、2ポスト目は直前tweetへ reply
    const createCalls = (deps.createPost as ReturnType<typeof vi.fn>).mock.calls;
    expect(createCalls[0][1]).toMatchObject({ text: "本文1", inReplyToTweetId: undefined });
    expect(createCalls[1][1]).toMatchObject({ text: "本文2", inReplyToTweetId: "dryrun-tweet-1" });

    // 各成功直後に tweet_ids 保存 ＋ consume event
    expect(writes.filter((w) => APPEND_TWEET.test(w.sql))).toHaveLength(2);
    const consumes = writes.filter((w) => CONSUME.test(w.sql));
    expect(consumes).toHaveLength(2);
    expect(consumes[0].params[6]).toBe("draft:d1:tweet:dryrun-tweet-1:post:create");
    expect(consumes[0].params[5]).toBe("post_normal"); // URLなし

    // posted 確定（root_tweet_id, posted_mode）＋ posted 通知
    const posted = writes.find((w) => POSTED.test(w.sql));
    expect(posted?.params).toEqual(["d1", "dryrun-tweet-1", "manual"]);
    expect(posted?.sql).toContain("next_metrics_at = now() + interval '1 day'");
    expect(writes.some((w) => NOTIFY.test(w.sql))).toBe(true);
  });

  it("classifies a post containing a URL as post_url", async () => {
    const draft = draftRow({ thread: [post("p1", "詳細はこちら https://example.com/x")] });
    const { db, writes } = makeDb(okHandler(draft));
    await executePostPublish(baseDeps(db));
    const consume = writes.find((w) => CONSUME.test(w.sql));
    expect(consume?.params[5]).toBe("post_url");
  });

  it("is idempotent when the draft is already posted", async () => {
    const { db, writes } = makeDb((sql) => {
      if (LOAD_JOB.test(sql)) return [JOB];
      if (LOAD_DRAFT.test(sql)) return [draftRow({ status: "posted", tweet_ids: ["t-1"] })];
      return [];
    });
    const res = await executePostPublish(baseDeps(db));
    expect(res).toEqual({ status: "already_done", draftId: "d1", tweetIds: ["t-1"] });
    expect(writes.some((w) => LOCK.test(w.sql))).toBe(false);
  });
});

describe("executePostPublish media upload", () => {
  it("uploads a ready image and attaches media to the first post only", async () => {
    const draft = draftRow({
      images: [{ status: "ready", storage_path: "u1/xa1/d1/i.webp", mime_type: "image/webp" }],
    });
    const { db } = makeDb(okHandler(draft));
    const deps = baseDeps(db);
    await executePostPublish(deps);
    expect(deps.uploadMedia).toHaveBeenCalledTimes(1);
    const createCalls = (deps.createPost as ReturnType<typeof vi.fn>).mock.calls;
    expect(createCalls[0][1].mediaIds).toEqual(["dryrun-media"]);
    expect(createCalls[1][1].mediaIds).toBeUndefined();
  });

  it("fails the draft (retryable) without posting when media upload fails", async () => {
    const draft = draftRow({
      images: [{ status: "ready", storage_path: "u1/xa1/d1/i.webp", mime_type: "image/webp" }],
    });
    const { db, writes } = makeDb(okHandler(draft));
    const deps = baseDeps(db, {
      uploadMedia: vi.fn(async () => {
        throw new Error("upload boom");
      }),
    });
    await expect(executePostPublish(deps)).rejects.toMatchObject({ code: "media_upload_failed" });
    expect(deps.createPost).not.toHaveBeenCalled();
    expect(writes.some((w) => FAILED.test(w.sql))).toBe(true);
  });
});

describe("executePostPublish validation", () => {
  it("rejects when today's posts + planned posts exceed the daily limit and reverts to draft", async () => {
    const { db, writes } = makeDb((sql) => {
      if (LOAD_JOB.test(sql)) return [JOB];
      if (LOAD_DRAFT.test(sql)) return [draftRow()];
      if (LOCK.test(sql)) return [{ id: "d1" }];
      if (DAILY.test(sql)) return [{ n: 49 }]; // 49 + 2 posts > 50
      return [];
    });
    await expect(executePostPublish(baseDeps(db))).rejects.toMatchObject({
      code: "daily_limit_reached",
    });
    expect(writes.some((w) => REVERT_DRAFT.test(w.sql))).toBe(true);
  });

  it("blocks auto posting when a post has an auto-post-blocking warning", async () => {
    const draft = draftRow({ thread: [post("p1", "本文", ["length_exceeded"])] });
    const { db, writes } = makeDb((sql) => {
      if (LOAD_JOB.test(sql)) return [{ ...JOB, input: { mode: "auto" }, trigger: "schedule" }];
      if (LOAD_DRAFT.test(sql)) return [draft];
      if (LOCK.test(sql)) return [{ id: "d1" }];
      return [];
    });
    await expect(executePostPublish(baseDeps(db))).rejects.toMatchObject({
      code: "auto_post_blocked",
    });
    expect(writes.some((w) => FAILED.test(w.sql))).toBe(true);
  });

  it("fails when the X token is unavailable", async () => {
    const { db, writes } = makeDb(okHandler());
    const deps = baseDeps(db, {
      getAccessToken: async () => {
        throw new Error("token expired");
      },
    });
    await expect(executePostPublish(deps)).rejects.toMatchObject({ code: "x_token_invalid" });
    expect(writes.some((w) => FAILED.test(w.sql))).toBe(true);
  });

  it("throws job_conflict when the draft cannot be locked", async () => {
    const { db } = makeDb((sql) => {
      if (LOAD_JOB.test(sql)) return [JOB];
      if (LOAD_DRAFT.test(sql)) return [draftRow()];
      if (LOCK.test(sql)) return []; // 0 rows → not lockable
      return [];
    });
    await expect(executePostPublish(baseDeps(db))).rejects.toBeInstanceOf(PostPublishError);
  });
});
