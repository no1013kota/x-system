import { describe, expect, it } from "vitest";

import {
  aggregateThread,
  buildDraftAnalytics,
  defaultCheckpoint,
  followerSeriesSummary,
  summarize,
  type AnalyticsDraftRow,
} from "./analytics";

const cp = (impressions: number | null, profile_clicks: number | null = 1) => ({
  impressions,
  likes: 2,
  reposts: 1,
  profile_clicks,
  collected_at: "2026-07-20T00:00:00.000Z",
});

const postedRow = (over: Partial<AnalyticsDraftRow> = {}): AnalyticsDraftRow => ({
  id: "d1",
  pattern: "p1",
  status: "posted",
  tweet_ids: ["a", "b"],
  last_post_error: null,
  posted_at: "2026-07-19T00:00:00.000Z",
  metrics_completed_at: null,
  tweet_metrics: {
    a: { checkpoints: { "1": cp(100), "7": cp(200) }, latest_checkpoint_days: 7, unavailable_at: null },
    b: { checkpoints: { "1": cp(50), "7": cp(80) }, latest_checkpoint_days: 7, unavailable_at: null },
  },
  ...over,
});

describe("buildDraftAnalytics", () => {
  it("posted → all tweet_ids as live rows", () => {
    const d = buildDraftAnalytics(postedRow());
    expect(d.tweets.map((t) => t.tweetId)).toEqual(["a", "b"]);
    expect(d.tweets.every((t) => !t.auditOnly)).toBe(true);
    expect(d.incomplete).toBe(false);
  });

  it("failed → remaining live + deleted audit-only, marked incomplete", () => {
    const d = buildDraftAnalytics(
      postedRow({
        status: "failed",
        tweet_ids: ["a", "b", "c"],
        last_post_error: { remaining_tweet_ids: ["a"], deleted_tweet_ids: ["c"] },
      }),
    );
    expect(d.incomplete).toBe(true);
    expect(d.tweets.find((t) => t.tweetId === "a")?.auditOnly).toBe(false);
    expect(d.tweets.find((t) => t.tweetId === "c")?.auditOnly).toBe(true);
    expect(d.tweets.find((t) => t.tweetId === "b")).toBeUndefined(); // not remaining, not deleted
  });

  it("marks unavailable tweets", () => {
    const d = buildDraftAnalytics(
      postedRow({
        tweet_metrics: {
          a: { checkpoints: {}, latest_checkpoint_days: null, unavailable_at: "2026-07-25T00:00:00Z" },
        },
      }),
    );
    expect(d.tweets.find((t) => t.tweetId === "a")?.unavailable).toBe(true);
  });
});

describe("defaultCheckpoint", () => {
  it("returns the longest collected checkpoint", () => {
    expect(defaultCheckpoint(buildDraftAnalytics(postedRow()))).toBe(7);
  });
  it("returns 1 when nothing collected", () => {
    const d = buildDraftAnalytics(postedRow({ tweet_metrics: { a: { checkpoints: {} }, b: { checkpoints: {} } } }));
    expect(defaultCheckpoint(d)).toBe(1);
  });
});

describe("aggregateThread", () => {
  it("sums present tweets at the checkpoint and counts missing", () => {
    const d = buildDraftAnalytics(
      postedRow({
        tweet_metrics: {
          a: { checkpoints: { "7": cp(200) } },
          b: { checkpoints: {} }, // missing 7d
        },
      }),
    );
    const agg = aggregateThread(d, 7);
    expect(agg).toMatchObject({ impressions: 200, present: 1, missing: 1 });
  });

  it("profile_clicks is null (--) when any present tweet lacks it", () => {
    const d = buildDraftAnalytics(
      postedRow({
        tweet_metrics: {
          a: { checkpoints: { "7": cp(100, 5) } },
          b: { checkpoints: { "7": cp(50, null) } }, // profile_clicks unavailable
        },
      }),
    );
    const agg = aggregateThread(d, 7);
    expect(agg.impressions).toBe(150); // public summed
    expect(agg.profile_clicks).toBeNull(); // -- because b's is null
  });

  it("excludes audit-only and unavailable tweets from aggregation", () => {
    const d = buildDraftAnalytics(
      postedRow({
        status: "failed",
        last_post_error: { remaining_tweet_ids: ["a"], deleted_tweet_ids: ["b"] },
        tweet_metrics: {
          a: { checkpoints: { "7": cp(100) } },
          b: { checkpoints: { "7": cp(999) } }, // deleted → audit only → excluded
        },
      }),
    );
    const agg = aggregateThread(d, 7);
    expect(agg.impressions).toBe(100); // b excluded
    expect(agg.present).toBe(1);
  });
});

describe("summarize", () => {
  it("aggregates per checkpoint across drafts, non-null only", () => {
    const s = summarize([buildDraftAnalytics(postedRow())], 30);
    expect(s.postCount).toBe(1);
    expect(s.checkpoints["1"]).toMatchObject({ tweets: 2, impressions: 150 }); // a:100 + b:50
    expect(s.checkpoints["7"]).toMatchObject({ tweets: 2, impressions: 280 }); // a:200 + b:80
    expect(s.checkpoints["30"]).toMatchObject({ tweets: 0, impressions: 0 });
  });
});

describe("followerSeriesSummary", () => {
  it("empty → all null", () => {
    expect(followerSeriesSummary([])).toEqual({ latest: null, delta: null, min: null, max: null, points: 0 });
  });
  it("single point → no delta", () => {
    expect(followerSeriesSummary([{ date: "2026-07-01", count: 100 }])).toMatchObject({
      latest: 100,
      delta: null,
      min: 100,
      max: 100,
      points: 1,
    });
  });
  it("multiple → latest, delta from first, min/max", () => {
    const s = followerSeriesSummary([
      { date: "2026-07-01", count: 100 },
      { date: "2026-07-03", count: 90 }, // dip
      { date: "2026-07-05", count: 130 },
    ]);
    expect(s).toMatchObject({ latest: 130, delta: 30, min: 90, max: 130, points: 3 });
  });
});
