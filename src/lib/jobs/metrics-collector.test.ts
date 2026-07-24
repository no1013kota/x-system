import { describe, expect, it } from "vitest";

import type { XTweetMetrics } from "../x/client";
import {
  applyCheckpoint,
  checkpointMetricsSchema,
  nextDueAfter,
  targetCheckpointDays,
  targetTweetIds,
  toCheckpointMetrics,
  type TweetMetricsMap,
} from "./metrics-collector";

const DAY = 86_400_000;
const POSTED = new Date("2026-07-01T00:00:00.000Z");

describe("targetTweetIds", () => {
  it("posted → all tweet_ids", () => {
    expect(targetTweetIds({ status: "posted", tweet_ids: ["a", "b"], last_post_error: null })).toEqual(["a", "b"]);
  });
  it("failed → remaining minus rollback-deleted, deduped", () => {
    expect(
      targetTweetIds({
        status: "failed",
        tweet_ids: ["a", "b", "c"],
        last_post_error: { remaining_tweet_ids: ["b", "c", "b"], deleted_tweet_ids: ["c"] },
      }),
    ).toEqual(["b"]);
  });
  it("failed ignores tweet_ids column (uses remaining only)", () => {
    expect(
      targetTweetIds({ status: "failed", tweet_ids: ["a", "b"], last_post_error: { remaining_tweet_ids: ["a"] } }),
    ).toEqual(["a"]);
  });
});

describe("targetCheckpointDays", () => {
  it("snaps next_metrics_at − posted_at to 1/7/30", () => {
    expect(targetCheckpointDays(POSTED, new Date(POSTED.getTime() + 1 * DAY))).toBe(1);
    expect(targetCheckpointDays(POSTED, new Date(POSTED.getTime() + 7 * DAY))).toBe(7);
    expect(targetCheckpointDays(POSTED, new Date(POSTED.getTime() + 30 * DAY))).toBe(30);
    expect(targetCheckpointDays(POSTED, new Date(POSTED.getTime() + 2 * DAY))).toBe(7); // between → up
  });
});

describe("nextDueAfter", () => {
  it("advances 1→+7d, 7→+30d, 30→null", () => {
    expect(nextDueAfter(1, POSTED)?.getTime()).toBe(POSTED.getTime() + 7 * DAY);
    expect(nextDueAfter(7, POSTED)?.getTime()).toBe(POSTED.getTime() + 30 * DAY);
    expect(nextDueAfter(30, POSTED)).toBeNull();
  });
});

describe("toCheckpointMetrics", () => {
  it("maps public/non-public fields; keeps 0, uses null for missing", () => {
    const tweet: XTweetMetrics = {
      id: "t1",
      text: null,
      publicMetrics: { impression_count: 100, like_count: 0, retweet_count: 5 },
      nonPublicMetrics: { user_profile_clicks: 0 },
    };
    expect(toCheckpointMetrics(tweet, "2026-07-02T00:00:00.000Z")).toEqual({
      impressions: 100,
      likes: 0, // 0 preserved, not null
      reposts: 5,
      profile_clicks: 0,
      collected_at: "2026-07-02T00:00:00.000Z",
    });
  });
  it("null metrics → all null (distinct from 0)", () => {
    const tweet: XTweetMetrics = { id: "t1", text: null, publicMetrics: null, nonPublicMetrics: null };
    const cp = toCheckpointMetrics(tweet, "x");
    expect(cp).toMatchObject({ impressions: null, likes: null, reposts: null, profile_clicks: null });
    expect(checkpointMetricsSchema.safeParse(cp).success).toBe(true);
  });
});

describe("applyCheckpoint", () => {
  it("adds a checkpoint and advances latest_checkpoint_days", () => {
    const cp = toCheckpointMetrics({ id: "t1", text: null, publicMetrics: { like_count: 3 }, nonPublicMetrics: null }, "c1");
    const map = applyCheckpoint({}, "t1", 1, cp);
    expect(map.t1.checkpoints["1"]?.likes).toBe(3);
    expect(map.t1.latest_checkpoint_days).toBe(1);
  });
  it("re-collecting the same checkpoint overwrites value+collected_at, keeps others, no regress of latest", () => {
    let map: TweetMetricsMap = {};
    map = applyCheckpoint(map, "t1", 1, { impressions: 10, likes: 1, reposts: 0, profile_clicks: null, collected_at: "a" });
    map = applyCheckpoint(map, "t1", 7, { impressions: 20, likes: 2, reposts: 0, profile_clicks: null, collected_at: "b" });
    // re-collect day 1 (later fetch)
    map = applyCheckpoint(map, "t1", 1, { impressions: 15, likes: 5, reposts: 1, profile_clicks: null, collected_at: "c" });
    expect(map.t1.checkpoints["1"]).toMatchObject({ impressions: 15, likes: 5, collected_at: "c" });
    expect(map.t1.checkpoints["7"]).toMatchObject({ impressions: 20, collected_at: "b" }); // untouched
    expect(map.t1.latest_checkpoint_days).toBe(7); // not regressed to 1
  });
});
