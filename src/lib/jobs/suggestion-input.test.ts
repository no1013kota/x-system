import { describe, expect, it } from "vitest";

import {
  buildSuggestionInput,
  chooseCheckpoint,
  hasUrl,
  lengthBucket,
  lineBlockBucket,
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

describe("分析軸の集計（T-M7-38）", () => {
  // 型×時間帯だけでは「短くした」「改行を入れた」「画像を付けた」「URLを外した」が
  // 効いたかを実績で確かめられない。軸ごとに独立集計する。
  const shaped = (
    id: string,
    text: string,
    impressions: number,
    over: Partial<SuggestionInputDraft> = {},
  ): SuggestionInputDraft =>
    mk(id, {
      thread: [{ text }],
      // 1日/7日の両方を入れる（3件未満だとcheckpointが1日へ落ちるため）。
      tweet_metrics: { [id]: { checkpoints: { "1": { impressions }, "7": { impressions } } } },
      ...over,
    });

  it("加重文字数の帯ごとに平均を出す（境界は生成目標の240に合わせる）", () => {
    expect(lengthBucket(160)).toBe("短(〜160)");
    expect(lengthBucket(161)).toBe("中(161〜240)");
    expect(lengthBucket(240)).toBe("中(161〜240)");
    expect(lengthBucket(241)).toBe("長(241〜)");

    const out = buildSuggestionInput(
      [
        shaped("a", "あ".repeat(50), 300), // 加重100 → 短
        shaped("b", "あ".repeat(50), 500), // 短
        shaped("c", "あ".repeat(140), 100), // 加重280 → 長
      ],
      NOW,
    );
    const byLength = Object.fromEntries(out.axes.length.map((c) => [c.value, c]));
    expect(byLength["短(〜160)"].count).toBe(2);
    expect(byLength["短(〜160)"].avg_impressions).toBe(400);
    expect(byLength["長(241〜)"].avg_impressions).toBe(100);
  });

  it("改行の塊数を数える（空行区切り）", () => {
    expect(lineBlockBucket("1行だけ")).toBe("1");
    expect(lineBlockBucket("塊1\n\n塊2")).toBe("2");
    expect(lineBlockBucket("塊1\n\n塊2\n\n塊3")).toBe("3+");
    // 単なる改行（空行なし）は塊を分けない
    expect(lineBlockBucket("行1\n行2")).toBe("1");

    const out = buildSuggestionInput(
      [shaped("a", "塊1\n\n塊2", 400), shaped("b", "1行だけ", 200)],
      NOW,
    );
    const byBlocks = Object.fromEntries(out.axes.line_blocks.map((c) => [c.value, c]));
    expect(byBlocks["2"].avg_impressions).toBe(400);
    expect(byBlocks["1"].avg_impressions).toBe(200);
  });

  it("画像の有無で分ける（画像は下書き単位なので全ポストへ及ぶ）", () => {
    const out = buildSuggestionInput(
      [shaped("a", "本文", 500, { imageCount: 1 }), shaped("b", "本文", 100, { imageCount: 0 })],
      NOW,
    );
    const byImage = Object.fromEntries(out.axes.image.map((c) => [c.value, c]));
    expect(byImage["あり"].avg_impressions).toBe(500);
    expect(byImage["なし"].avg_impressions).toBe(100);
  });

  it("本文のURL有無で分ける（外部リンクは露出が落ちるため）", () => {
    expect(hasUrl("出典 https://example.com/a")).toBe(true);
    expect(hasUrl("URLなしの本文")).toBe(false);

    const out = buildSuggestionInput(
      [shaped("a", "https://example.com/a を見て", 100), shaped("b", "URLなし", 600)],
      NOW,
    );
    const byUrl = Object.fromEntries(out.axes.url.map((c) => [c.value, c]));
    expect(byUrl["あり"].avg_impressions).toBe(100);
    expect(byUrl["なし"].avg_impressions).toBe(600);
  });

  it("形の計測は本文全体で行う（表示用の100字切り詰めに影響されない）", () => {
    // 100字を超える位置に空行を置く。body は切られるが塊数は全文で数える。
    const text = `${"あ".repeat(120)}\n\n続き`;
    const out = buildSuggestionInput([shaped("a", text, 100)], NOW);
    expect(out.posts[0].body.length, "表示は100字で切る").toBe(100);
    expect(out.axes.line_blocks[0].value, "計測は全文").toBe("2");
  });

  it("従来の型×時間帯の集計は変わらない", () => {
    const out = buildSuggestionInput([mk("a"), mk("b")], NOW);
    expect(out.stats[0].pattern).toBe("p1");
    expect(out.stats[0].time_bucket).toBe("12-15");
    expect(out.stats[0].count).toBe(2);
  });
});
