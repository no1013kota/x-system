import { describe, expect, it } from "vitest";

import {
  buildSuggestionInput,
  chooseCheckpoint,
  type SuggestionInputDraft,
} from "./suggestion-input";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 6, 20, 6, 0, 0); // 2026-07-20T06:00:00Z

function draft(over: Partial<SuggestionInputDraft> = {}): SuggestionInputDraft {
  return {
    pattern: "p1",
    postedAt: "2026-07-18T03:00:00.000Z", // JST 12:00 → bucket "12-15"
    thread: [{ text: "body" }],
    tweet_ids: ["t1"],
    status: "posted",
    last_post_error: null,
    tweet_metrics: { t1: { checkpoints: { "1": { impressions: 50 }, "7": { impressions: 100 } } } },
    ...over,
  };
}

// unique tweet ids across drafts
function mk(id: string, over: Partial<SuggestionInputDraft> = {}): SuggestionInputDraft {
  return draft({
    tweet_ids: [id],
    tweet_metrics: { [id]: { checkpoints: { "1": { impressions: 50 }, "7": { impressions: 100 } } } },
    ...over,
  });
}

describe("chooseCheckpoint", () => {
  it("uses 7d when ≥3 posts have the 7d checkpoint", () => {
    expect(chooseCheckpoint([mk("a"), mk("b"), mk("c")], NOW)).toBe(7);
  });
  it("falls back to 1d when <3 posts have the 7d checkpoint", () => {
    // only 1d collected → 0 qualify at 7d → fallback 1
    const only1d = (id: string) => mk(id, { tweet_metrics: { [id]: { checkpoints: { "1": { impressions: 50 } } } } });
    expect(chooseCheckpoint([only1d("a"), only1d("b"), only1d("c")], NOW)).toBe(1);
  });
});

describe("buildSuggestionInput", () => {
  it("selects one checkpoint (7d) and never mixes checkpoints in posts", () => {
    const out = buildSuggestionInput([mk("a"), mk("b"), mk("c")], NOW);
    expect(out.checkpoint_days).toBe(7);
    expect(out.posts).toHaveLength(3);
    expect(out.posts.every((p) => p.impressions === 100)).toBe(true); // all 7d values, not mixed with 1d(50)
  });

  it("falls back to 1d values when 7d group is too small", () => {
    const only1d = (id: string) => mk(id, { tweet_metrics: { [id]: { checkpoints: { "1": { impressions: 50 } } } } });
    const out = buildSuggestionInput([only1d("a"), only1d("b")], NOW);
    expect(out.checkpoint_days).toBe(1);
    expect(out.posts.every((p) => p.impressions === 50)).toBe(true);
  });

  it("builds <posts> with 100-char body, pattern, JST time, impressions", () => {
    const long = "x".repeat(150);
    const out = buildSuggestionInput(
      [mk("a", { thread: [{ text: long }], pattern: "p3" }), mk("b"), mk("c")],
      NOW,
    );
    const a = out.posts.find((p) => p.tweet_id === "a")!;
    expect(a.body).toHaveLength(100);
    expect(a.pattern).toBe("p3");
    expect(a.posted_at_jst).toBe("12:00");
  });

  it("builds <stats> cells with count and average impressions per pattern×time-bucket", () => {
    const out = buildSuggestionInput(
      [
        mk("a", { tweet_metrics: { a: { checkpoints: { "7": { impressions: 100 } } } } }),
        mk("b", { tweet_metrics: { b: { checkpoints: { "7": { impressions: 300 } } } } }),
        mk("c", { tweet_metrics: { c: { checkpoints: { "7": { impressions: 200 } } } } }),
      ],
      NOW,
    );
    const cell = out.stats.find((s) => s.pattern === "p1" && s.time_bucket === "12-15")!;
    expect(cell.count).toBe(3);
    expect(cell.avg_impressions).toBe(200); // (100+300+200)/3
  });

  it("excludes posts older than 30 days", () => {
    const old = mk("a", { postedAt: new Date(NOW - 40 * DAY).toISOString() });
    const out = buildSuggestionInput([old, mk("b"), mk("c"), mk("d")], NOW);
    expect(out.posts.some((p) => p.tweet_id === "a")).toBe(false);
    expect(out.posts).toHaveLength(3); // b,c,d
  });

  it("excludes rollback-deleted and unavailable tweet_ids", () => {
    const failed = draft({
      status: "failed",
      tweet_ids: ["live", "deleted"],
      thread: [{ text: "a" }, { text: "b" }],
      last_post_error: { remaining_tweet_ids: ["live"], deleted_tweet_ids: ["deleted"] },
      tweet_metrics: {
        live: { checkpoints: { "7": { impressions: 100 } } },
        deleted: { checkpoints: { "7": { impressions: 999 } } },
      },
    });
    const unavail = mk("u", {
      tweet_metrics: { u: { checkpoints: { "7": { impressions: 100 } }, unavailable_at: "2026-07-25T00:00:00Z" } },
    });
    const out = buildSuggestionInput([failed, unavail, mk("b"), mk("c")], NOW);
    const ids = out.posts.map((p) => p.tweet_id);
    expect(ids).toContain("live");
    expect(ids).not.toContain("deleted"); // rollback-deleted
    expect(ids).not.toContain("u"); // unavailable
  });

  it("caps <posts> at 50", () => {
    const many = Array.from({ length: 60 }, (_, i) => mk(`t${i}`));
    const out = buildSuggestionInput(many, NOW);
    expect(out.posts).toHaveLength(50);
  });
});
