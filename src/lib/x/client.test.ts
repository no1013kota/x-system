import { describe, expect, it, vi } from "vitest";

import {
  createPost,
  deletePost,
  getMe,
  getTweetMetrics,
  isXAuthError,
  uploadMedia,
  XApiError,
  type XClientDeps,
  type XHttp,
  type XHttpResponse,
} from "./client";

function ok(body: unknown, requestId: string | null = "req-1"): XHttpResponse {
  return { ok: true, status: 200, text: async () => JSON.stringify(body), requestId };
}
function fail(status: number, body: unknown = {}): XHttpResponse {
  return { ok: false, status, text: async () => JSON.stringify(body), requestId: null };
}

/** Serves the queued responses (Error → thrown as a network failure); records requests. */
function mockHttp(queue: Array<XHttpResponse | Error>) {
  const requests: Parameters<XHttp>[0][] = [];
  let i = 0;
  const http: XHttp = async (req) => {
    requests.push(req);
    const r = queue[Math.min(i, queue.length - 1)];
    i += 1;
    if (r instanceof Error) throw r;
    return r;
  };
  return { http, requests, calls: () => i };
}

function liveDeps(http: XHttp, sleep = vi.fn(async () => {})): XClientDeps {
  return { http, mode: "live", sleep, rng: () => 0, newId: () => "id1" };
}
function dryRunDeps(http: XHttp): XClientDeps {
  return { http, mode: "dry_run", newId: () => "id1" };
}

describe("X client — dry_run gates writes", () => {
  it("createPost makes no HTTP call and returns a pseudo tweet id", async () => {
    const m = mockHttp([]);
    const res = await createPost("tok", { text: "hi" }, dryRunDeps(m.http));
    expect(m.calls()).toBe(0);
    expect(res).toEqual({ tweetId: "dryrun-tweet-id1", requestId: null, quantity: 1, dryRun: true });
  });

  it("deletePost makes no HTTP call in dry_run", async () => {
    const m = mockHttp([]);
    const res = await deletePost("tok", "t-1", dryRunDeps(m.http));
    expect(m.calls()).toBe(0);
    expect(res.deleted).toBe(true);
    expect(res.dryRun).toBe(true);
  });

  it("uploadMedia returns a pseudo media id in dry_run and throws in live", async () => {
    const m = mockHttp([]);
    const res = await uploadMedia("tok", { data: Buffer.from("x"), mimeType: "image/png" }, dryRunDeps(m.http));
    expect(res.mediaId).toBe("dryrun-media-id1");
    expect(m.calls()).toBe(0);
    await expect(
      uploadMedia("tok", { data: Buffer.from("x"), mimeType: "image/png" }, liveDeps(m.http)),
    ).rejects.toThrow(/posting-execution milestone/);
  });
});

describe("X client — request construction & normalization (live)", () => {
  it("createPost builds text/reply/media/quote and parses data.id + requestId", async () => {
    const m = mockHttp([ok({ data: { id: "tweet-9" } }, "rq-9")]);
    const res = await createPost(
      "tok",
      { text: "body", inReplyToTweetId: "prev-1", mediaIds: ["m1", "m2"], quoteTweetId: "q-1" },
      liveDeps(m.http),
    );
    expect(res).toEqual({ tweetId: "tweet-9", requestId: "rq-9", quantity: 1, dryRun: false });
    const req = m.requests[0];
    expect(req.method).toBe("POST");
    expect(req.url).toBe("https://api.x.com/2/tweets");
    expect(req.headers.authorization).toBe("Bearer tok");
    expect(req.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(req.body!)).toEqual({
      text: "body",
      reply: { in_reply_to_tweet_id: "prev-1" },
      media: { media_ids: ["m1", "m2"] },
      quote_tweet_id: "q-1",
    });
  });

  it("createPost omits reply/media/quote when not provided", async () => {
    const m = mockHttp([ok({ data: { id: "t" } })]);
    await createPost("tok", { text: "only" }, liveDeps(m.http));
    expect(JSON.parse(m.requests[0].body!)).toEqual({ text: "only" });
  });

  it("deletePost DELETEs /2/tweets/:id and parses deleted", async () => {
    const m = mockHttp([ok({ data: { deleted: true } })]);
    const res = await deletePost("tok", "t 1/x", liveDeps(m.http));
    expect(m.requests[0].method).toBe("DELETE");
    expect(m.requests[0].url).toBe("https://api.x.com/2/tweets/t%201%2Fx");
    expect(res.deleted).toBe(true);
  });

  it("getMe parses the user and camelCases profile_image_url", async () => {
    const m = mockHttp([
      ok({ data: { id: "u1", username: "acme", name: "Acme", profile_image_url: "https://img" } }),
    ]);
    const res = await getMe("tok", liveDeps(m.http));
    expect(res.user).toEqual({ id: "u1", username: "acme", name: "Acme", profileImageUrl: "https://img" });
    expect(m.requests[0].url).toContain("/users/me?user.fields=profile_image_url");
  });

  it("getTweetMetrics requests ids + metric fields and returns public/non-public metrics", async () => {
    const m = mockHttp([
      ok({
        data: [
          { id: "a", public_metrics: { like_count: 3 }, non_public_metrics: { impression_count: 9 } },
          { id: "b", public_metrics: { like_count: 0 } },
        ],
      }),
    ]);
    const res = await getTweetMetrics("tok", ["a", "b"], liveDeps(m.http));
    expect(m.requests[0].url).toBe(
      "https://api.x.com/2/tweets?ids=a%2Cb&tweet.fields=public_metrics,non_public_metrics",
    );
    expect(res.quantity).toBe(2);
    expect(res.tweets[0]).toEqual({
      id: "a",
      publicMetrics: { like_count: 3 },
      nonPublicMetrics: { impression_count: 9 },
    });
    expect(res.tweets[1].nonPublicMetrics).toBeNull();
  });
});

describe("X client — retry policy (要件04 §5)", () => {
  it("retries 5xx with backoff and succeeds within 3 attempts", async () => {
    const sleep = vi.fn(async () => {});
    const m = mockHttp([fail(500), fail(503), ok({ data: { id: "t-ok" } })]);
    const res = await createPost("tok", { text: "x" }, liveDeps(m.http, sleep));
    expect(res.tweetId).toBe("t-ok");
    expect(m.calls()).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2); // 2 retries
  });

  it("retries a network throw", async () => {
    const m = mockHttp([new Error("ECONNRESET"), ok({ data: { id: "t-net" } })]);
    const res = await createPost("tok", { text: "x" }, liveDeps(m.http));
    expect(res.tweetId).toBe("t-net");
    expect(m.calls()).toBe(2);
  });

  it("fails after max retries on persistent 429", async () => {
    const m = mockHttp([fail(429, { title: "Too Many Requests" })]);
    await expect(createPost("tok", { text: "x" }, liveDeps(m.http))).rejects.toBeInstanceOf(
      XApiError,
    );
    expect(m.calls()).toBe(3); // initial + 2 retries
  });

  it("does not retry 401/403 and normalizes to an auth (expiry) error", async () => {
    const m = mockHttp([fail(401, { title: "Unauthorized" })]);
    const err = await createPost("tok", { text: "x" }, liveDeps(m.http)).catch((e) => e);
    expect(isXAuthError(err)).toBe(true);
    expect((err as XApiError).kind).toBe("auth");
    expect(m.calls()).toBe(1); // no retry
  });
});
