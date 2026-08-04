import { describe, expect, it, vi } from "vitest";

import { XApiError, type XCreatePostResult, type XDeletePostResult } from "../x/client";
import type { Queryable } from "../x/token-refresh";
import {
  PostPublishError,
  executePostPublish,
  requiredPostSlots,
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
const FAILED = /update drafts\s+set status = 'failed'/;
const REVERT_DRAFT = /update drafts set status = 'draft'/;
const REVERT_WITH_REASON = /update drafts set status = 'draft', last_post_error/;
const CONSENT = /select \(automation_consent_version/;
const CANCEL_JOB = /update generation_jobs set status = 'canceled'/;
// consume は create/delete で同一SQL。operation は param($7=params[6]) で判別する。
const DELETE_CONSUME = (w: { sql: string; params: unknown[] }) =>
  CONSUME.test(w.sql) && w.params[6] === "post_delete";

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
  x_user_id: "xu1",
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
    runInTx: (fn) => fn(db),
    getAccessToken: async () => "tok",
    createPost,
    deletePost: vi.fn(
      async (): Promise<XDeletePostResult> => ({
        deleted: true,
        requestId: null,
        quantity: 1,
        dryRun: true,
      }),
    ),
    uploadMedia: vi.fn(async () => ({ mediaId: "dryrun-media", requestId: null, quantity: 1, dryRun: true })),
    downloadImage: vi.fn(async () => ({ data: Buffer.from("img"), mimeType: "image/webp" })),
    getRecentPosts: vi.fn(async () => []),
    checkTweetExists: vi.fn(async () => true), // 既定: 削除失敗時はまだ存在（remaining）
    costConfig: COST,
    dailyLimit: 50,
    postingLive: false, // 既定 dry_run（consume eventは記帳、premium月次counterは加算しない）
    now: () => 1_700_000_000_000,
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
    expect(consumes[0].params[7]).toBe("draft:d1:tweet:dryrun-tweet-1:post:create");
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

  it("stops手動投稿 without any X call when a post exceeds the weighted limit (T-M8-39)", async () => {
    // 手動投稿でもサーバ側で止める。Xは280超過を400で拒否するため、3本目で拒否されると
    // 1〜2本目がX上に残る（取り返しがつかない）。**1本も作らない**ことまで確かめる。
    const draft = draftRow({
      thread: [post("p1", "短い"), post("p2", "あ".repeat(141)), post("p3", "短い")],
    });
    const { db, writes } = makeDb(okHandler(draft));
    const deps = baseDeps(db);
    await expect(executePostPublish(deps)).rejects.toMatchObject({ code: "length_exceeded" });
    expect(deps.createPost).not.toHaveBeenCalled();
    // **`failed` にしない**（T-M8-51）。`failed` にすると `editable` が false になり、
    // `tweet_ids` が空なので複製もできず、メッセージの「編集して短くしてから投稿してください」を
    // 実行できない行き止まりになる。Xへ1件も出していないので `draft` へ戻して理由だけ残す。
    expect(writes.some((w) => FAILED.test(w.sql))).toBe(false);
    const reverted = writes.find((w) => REVERT_WITH_REASON.test(w.sql));
    expect(reverted).toBeDefined();
    // 運営者が何をすればよいか分かる文言か（何本目・Xには出ていない）
    expect(JSON.stringify(reverted?.params)).toContain("2本目");
    expect(JSON.stringify(reverted?.params)).toContain("1件も行っていません");
  });

  it("quote_url を合成した結果で超過する場合も止める（P-5・T-M8-39）", async () => {
    // 保存済みの weighted_length では見えない超過。引用URLは1本目の末尾へ足されるため、
    // 「そのとき投稿する本文」から測り直さないと通り抜ける。
    const draft = draftRow({
      thread: [post("p1", "あ".repeat(135))],
      quote_url: "https://x.com/someone/status/1234567890",
    });
    const { db } = makeDb(okHandler(draft));
    const deps = baseDeps(db);
    await expect(executePostPublish(deps)).rejects.toMatchObject({ code: "length_exceeded" });
    expect(deps.createPost).not.toHaveBeenCalled();
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

describe("executePostPublish resume & rollback (要件04 §11)", () => {
  const draft3 = () =>
    draftRow({ thread: [post("p1", "本文1"), post("p2", "本文2"), post("p3", "本文3")] });

  it("resumes once from the saved position and reaches posted", async () => {
    const { db, writes } = makeDb(okHandler(draft3()));
    let n = 0;
    const createPost = vi.fn(async () => {
      n += 1;
      if (n === 2) throw new Error("boom at index 1"); // 初回passの index1 で失敗
      return { tweetId: `t-${n}`, requestId: null, quantity: 1, dryRun: false };
    });
    const res = await executePostPublish(baseDeps(db, { createPost }));

    expect(res.status).toBe("posted");
    expect(res.tweetIds).toHaveLength(3);
    // 呼び出し: index0, index1(fail), index1(resume), index2 = 4回
    expect(createPost).toHaveBeenCalledTimes(4);
    expect(writes.some((w) => POSTED.test(w.sql))).toBe(true);
    expect(writes.some((w) => FAILED.test(w.sql))).toBe(false);
  });

  it("rolls back successful posts in reverse when the resume also fails", async () => {
    const draft = draftRow({ thread: [post("p1", "本文1"), post("p2", "本文2")] });
    const { db, writes } = makeDb(okHandler(draft));
    let n = 0;
    const createPost = vi.fn(async () => {
      n += 1;
      if (n >= 2) throw new Error("index1 always fails"); // index1 は両passで失敗
      return { tweetId: "t-1", requestId: null, quantity: 1, dryRun: false };
    });
    const deletePost = vi.fn<(accessToken: string, tweetId: string) => Promise<XDeletePostResult>>(
      async () => ({ deleted: true, requestId: null, quantity: 1, dryRun: false }),
    );

    await expect(
      executePostPublish(baseDeps(db, { createPost, deletePost })),
    ).rejects.toMatchObject({ code: "post_create_failed" });

    // 逆順削除: 成功済み t-1 を削除
    expect(deletePost).toHaveBeenCalledTimes(1);
    expect(deletePost.mock.calls[0][1]).toBe("t-1");
    // post_delete consume（冪等key・counter_type）
    const del = writes.find((w) => DELETE_CONSUME(w));
    expect(del?.params[7]).toBe("draft:d1:tweet:t-1:post:delete");
    expect(del?.params[5]).toBe("post_normal");
    // draft failed ＋ last_post_error（deleted/remaining）＋ error通知
    const failed = writes.find((w) => FAILED.test(w.sql));
    const err = JSON.parse(failed?.params[1] as string);
    expect(err.deleted_tweet_ids).toEqual(["t-1"]);
    expect(err.remaining_tweet_ids).toEqual([]);
    expect(err.failed_post_index).toBe(1);
    expect(failed?.params[2]).toBe(false); // 残存なし→next_metrics設定しない
    expect(writes.some((w) => NOTIFY.test(w.sql))).toBe(true);
  });

  it("keeps still-existing tweets in remaining_tweet_ids and sets next_metrics_at", async () => {
    const draft = draftRow({ thread: [post("p1", "本文1"), post("p2", "本文2")] });
    const { db, writes } = makeDb(okHandler(draft));
    let n = 0;
    const createPost = vi.fn(async () => {
      n += 1;
      if (n >= 2) throw new Error("index1 always fails");
      return { tweetId: "t-1", requestId: null, quantity: 1, dryRun: false };
    });
    const deletePost = vi.fn(async () => {
      throw new Error("delete failed");
    });

    await expect(
      executePostPublish(baseDeps(db, { createPost, deletePost, checkTweetExists: async () => true })),
    ).rejects.toMatchObject({ code: "post_create_failed" });

    // 削除失敗＋まだ存在 → remaining に残る・post_delete consume は作らない
    expect(writes.some((w) => DELETE_CONSUME(w))).toBe(false);
    const failed = writes.find((w) => FAILED.test(w.sql));
    const err = JSON.parse(failed?.params[1] as string);
    expect(err.deleted_tweet_ids).toEqual([]);
    expect(err.remaining_tweet_ids).toEqual(["t-1"]);
    expect(err.ambiguous_delete_tweet_ids).toEqual([]);
    expect(failed?.params[2]).toBe(true); // 残存あり→next_metrics設定
  });

  it("treats a delete-ambiguous tweet as deleted when re-fetch shows it is gone", async () => {
    const draft = draftRow({ thread: [post("p1", "本文1"), post("p2", "本文2")] });
    const { db, writes } = makeDb(okHandler(draft));
    let n = 0;
    const createPost = vi.fn(async () => {
      n += 1;
      if (n >= 2) throw new Error("index1 always fails");
      return { tweetId: "t-1", requestId: null, quantity: 1, dryRun: false };
    });
    const deletePost = vi.fn(async () => {
      throw new Error("delete ambiguous");
    });
    await expect(
      executePostPublish(baseDeps(db, { createPost, deletePost, checkTweetExists: async () => false })),
    ).rejects.toMatchObject({ code: "post_create_failed" });

    // 存在確認で消えている → 削除成功扱い（consume・deleted）
    expect(writes.some((w) => DELETE_CONSUME(w))).toBe(true);
    const err = JSON.parse(writes.find((w) => FAILED.test(w.sql))?.params[1] as string);
    expect(err.deleted_tweet_ids).toEqual(["t-1"]);
    expect(err.remaining_tweet_ids).toEqual([]);
  });

  it("records ambiguous_delete_tweet_ids when deletion result is undeterminable", async () => {
    const draft = draftRow({ thread: [post("p1", "本文1"), post("p2", "本文2")] });
    const { db, writes } = makeDb(okHandler(draft));
    let n = 0;
    const createPost = vi.fn(async () => {
      n += 1;
      if (n >= 2) throw new Error("index1 always fails");
      return { tweetId: "t-1", requestId: null, quantity: 1, dryRun: false };
    });
    const deletePost = vi.fn(async () => {
      throw new Error("delete ambiguous");
    });
    await expect(
      executePostPublish(baseDeps(db, { createPost, deletePost, checkTweetExists: async () => null })),
    ).rejects.toMatchObject({ code: "post_create_failed" });

    const err = JSON.parse(writes.find((w) => FAILED.test(w.sql))?.params[1] as string);
    expect(err.ambiguous_delete_tweet_ids).toEqual(["t-1"]);
    expect(err.deleted_tweet_ids).toEqual([]);
    expect(err.remaining_tweet_ids).toEqual([]);
  });
});

describe("executePostPublish create reconciliation (要件04 §10)", () => {
  const NOW = 1_700_000_000_000;
  const isoNow = new Date(NOW).toISOString();

  it("reconciles an ambiguous create to a single matching recent post and continues", async () => {
    const draft = draftRow({ thread: [post("p1", "本文1"), post("p2", "本文2")] });
    const { db, writes } = makeDb(okHandler(draft));
    let n = 0;
    const createPost = vi.fn(async () => {
      n += 1;
      if (n === 2) throw new XApiError(503, "ServiceUnavailable", "server"); // index1で成否不明
      return { tweetId: "t-1", requestId: null, quantity: 1, dryRun: false };
    });
    // index1（本文2・t-1へのreply）に一致する直近投稿が1件
    const getRecentPosts = vi.fn(async () => [
      { id: "reconciled-2", text: "本文2", createdAt: isoNow, inReplyToId: "t-1" },
    ]);
    const deletePost = vi.fn(async () => ({ deleted: true, requestId: null, quantity: 1, dryRun: false }));

    const res = await executePostPublish(
      baseDeps(db, { createPost, getRecentPosts, deletePost, now: () => NOW }),
    );

    expect(res.status).toBe("posted");
    expect(res.tweetIds).toEqual(["t-1", "reconciled-2"]);
    expect(deletePost).not.toHaveBeenCalled(); // 再送もrollbackもしない
    expect(writes.some((w) => POSTED.test(w.sql))).toBe(true);
  });

  it("fails with post_state_unknown when no matching recent post is found", async () => {
    const draft = draftRow({ thread: [post("p1", "本文1"), post("p2", "本文2")] });
    const { db, writes } = makeDb(okHandler(draft));
    let n = 0;
    const createPost = vi.fn(async () => {
      n += 1;
      if (n === 2) throw new XApiError(503, "ServiceUnavailable", "server");
      return { tweetId: "t-1", requestId: null, quantity: 1, dryRun: false };
    });
    const getRecentPosts = vi.fn(async () => []); // 候補なし
    const deletePost = vi.fn(async () => ({ deleted: true, requestId: null, quantity: 1, dryRun: false }));

    await expect(
      executePostPublish(baseDeps(db, { createPost, getRecentPosts, deletePost, now: () => NOW })),
    ).rejects.toMatchObject({ code: "post_state_unknown" });

    expect(deletePost).not.toHaveBeenCalled(); // rollbackしない
    const err = JSON.parse(writes.find((w) => FAILED.test(w.sql))?.params[1] as string);
    expect(err.code).toBe("post_state_unknown");
    expect(err.ambiguous_create_indices).toEqual([1]);
    expect(err.remaining_tweet_ids).toEqual(["t-1"]);
    expect(writes.some((w) => NOTIFY.test(w.sql))).toBe(true);
  });

  it("fails with post_state_unknown when multiple candidates match", async () => {
    const draft = draftRow({ thread: [post("p1", "本文1")] });
    const { db, writes } = makeDb(okHandler(draft));
    const createPost = vi.fn(async () => {
      throw new XApiError(500, "ServerError", "server");
    });
    const getRecentPosts = vi.fn(async () => [
      { id: "c1", text: "本文1", createdAt: isoNow, inReplyToId: null },
      { id: "c2", text: "本文1", createdAt: isoNow, inReplyToId: null },
    ]);

    await expect(
      executePostPublish(baseDeps(db, { createPost, getRecentPosts, now: () => NOW })),
    ).rejects.toMatchObject({ code: "post_state_unknown" });
    const err = JSON.parse(writes.find((w) => FAILED.test(w.sql))?.params[1] as string);
    expect(err.ambiguous_create_indices).toEqual([0]);
  });
});

describe("executePostPublish auto consent re-check (要件04 §10 step2, T-M4-03)", () => {
  const autoJob = { ...JOB, input: { mode: "auto" }, trigger: "schedule" };

  it("stops without any X call when consent is revoked or stale", async () => {
    const { db, writes } = makeDb((sql) => {
      if (LOAD_JOB.test(sql)) return [autoJob];
      if (LOAD_DRAFT.test(sql)) return [draftRow()];
      if (LOCK.test(sql)) return [{ id: "d1" }];
      if (DAILY.test(sql)) return [{ n: 0 }];
      if (CONSENT.test(sql)) return [{ ok: false }];
      return [];
    });
    const deps = baseDeps(db);
    await expect(executePostPublish(deps)).rejects.toMatchObject({
      code: "automation_consent_revoked",
    });
    expect(deps.createPost).not.toHaveBeenCalled();
    expect(deps.uploadMedia).not.toHaveBeenCalled();
    // draftは未投稿(draft)へ戻し、jobはcanceled
    expect(writes.some((w) => REVERT_DRAFT.test(w.sql))).toBe(true);
    expect(writes.some((w) => CANCEL_JOB.test(w.sql))).toBe(true);
  });

  it("posts normally for auto when consent is current", async () => {
    const { db } = makeDb((sql) => {
      if (LOAD_JOB.test(sql)) return [autoJob];
      if (LOAD_DRAFT.test(sql)) return [draftRow()];
      if (LOCK.test(sql)) return [{ id: "d1" }];
      if (DAILY.test(sql)) return [{ n: 0 }];
      if (CONSENT.test(sql)) return [{ ok: true }];
      return [];
    });
    const deps = baseDeps(db);
    const res = await executePostPublish(deps);
    expect(res.status).toBe("posted");
    expect(deps.createPost).toHaveBeenCalled();
  });

  it("does not re-check consent for manual posting", async () => {
    const { db, writes } = makeDb(okHandler());
    const deps = baseDeps(db); // JOB is mode=manual
    await executePostPublish(deps);
    expect(writes.some((w) => CONSENT.test(w.sql))).toBe(false);
  });
});

describe("requiredPostSlots ロールバック安全残量 (T-M6-07)", () => {
  it("5 posts with only the last carrying a URL require normal 8, url 1", () => {
    // 通常4件＋末尾URL1件。全件成功=通常4/URL1、最終失敗時のprefix(通常4)は作成+削除で各2消費=通常8。
    const finals = ["a", "b", "c", "d", "https://x.com/e"];
    expect(requiredPostSlots(finals)).toEqual({ normal: 8, url: 1 });
  });

  it("single post needs no rollback buffer (prefix is empty)", () => {
    expect(requiredPostSlots(["https://x.com/only"])).toEqual({ normal: 0, url: 1 });
    expect(requiredPostSlots(["plain"])).toEqual({ normal: 1, url: 0 });
  });

  it("all-URL prefix doubles the URL requirement", () => {
    // URL3件連投: 全件成功=URL3、最終失敗時prefix(URL2)作成+削除=URL4 → max(3,4)=4。
    const finals = ["https://a", "https://b", "https://c"];
    expect(requiredPostSlots(finals)).toEqual({ normal: 0, url: 4 });
  });
});

describe("executePostPublish premium rollback-safe remaining (T-M6-07)", () => {
  const PREMIUM_JOB = { ...JOB, plan: "premium" };
  const USAGE_READ = /coalesce\(normal_posts_count/;

  it("fails before any X call when remaining slots cannot cover the rollback worst case", async () => {
    // 2件通常投稿 → required normal = max(2, 2×1) = 2。使用済み199 + 2 > 200 で不足。
    const { db, writes } = makeDb((sql) => {
      if (LOAD_JOB.test(sql)) return [PREMIUM_JOB];
      if (LOAD_DRAFT.test(sql)) return [draftRow()];
      if (LOCK.test(sql)) return [{ id: "d1" }];
      if (DAILY.test(sql)) return [{ n: 0 }];
      if (USAGE_READ.test(sql)) return [{ normal_posts_count: 199, url_posts_count: 0 }];
      return [];
    });
    const deps = baseDeps(db, { postingLive: true });
    await expect(executePostPublish(deps)).rejects.toMatchObject({ code: "usage_limit_exceeded" });
    expect(deps.createPost).not.toHaveBeenCalled();
    expect(deps.uploadMedia).not.toHaveBeenCalled();
    expect(writes.some((w) => CONSUME.test(w.sql))).toBe(false); // 枠を消費しない
    expect(writes.some((w) => NOTIFY.test(w.sql))).toBe(true); // error通知
    expect(writes.some((w) => REVERT_DRAFT.test(w.sql))).toBe(true); // draftへ戻す
  });

  it("proceeds when remaining slots cover the rollback worst case", async () => {
    const { db } = makeDb((sql) => {
      if (LOAD_JOB.test(sql)) return [PREMIUM_JOB];
      if (LOAD_DRAFT.test(sql)) return [draftRow()];
      if (LOCK.test(sql)) return [{ id: "d1" }];
      if (DAILY.test(sql)) return [{ n: 0 }];
      if (USAGE_READ.test(sql)) return [{ normal_posts_count: 100, url_posts_count: 0 }];
      return [];
    });
    const deps = baseDeps(db, { postingLive: true });
    const res = await executePostPublish(deps);
    expect(res.status).toBe("posted");
    expect(deps.createPost).toHaveBeenCalled();
  });

  it("skips the premium check for BYOK plans (dry_run/standard)", async () => {
    // standard は月次counter対象外。postingLive:false でも usage_counters を読まない。
    const { db, writes } = makeDb(okHandler());
    const deps = baseDeps(db); // JOB.plan = standard, postingLive false
    await executePostPublish(deps);
    expect(writes.some((w) => USAGE_READ.test(w.sql))).toBe(false);
  });
});
