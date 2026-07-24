import { describe, expect, it } from "vitest";

import { genOutputSchema, postsToThread } from "./gen-output";

describe("genOutputSchema", () => {
  it("accepts the SYS-GEN success/failure shapes", () => {
    expect(
      genOutputSchema.safeParse({ posts: ["a", "b"], sources: ["https://x"], error: null }).success,
    ).toBe(true);
    expect(
      genOutputSchema.safeParse({ posts: [], sources: [], error: "理由" }).success,
    ).toBe(true);
  });

  it("rejects wrong shapes (objects instead of strings, missing fields)", () => {
    expect(genOutputSchema.safeParse({ posts: [{ text: "a" }], sources: [], error: null }).success).toBe(
      false,
    );
    expect(genOutputSchema.safeParse({ posts: ["a"], error: null }).success).toBe(false);
  });
});

describe("postsToThread", () => {
  it("maps posts to thread items with weighted_length and sources on the last post", () => {
    const thread = postsToThread(["こんにちは", "詳しくはこちら"], ["https://src"]);
    expect(thread).toHaveLength(2);
    expect(thread[0]).toMatchObject({ local_id: "p1", text: "こんにちは", sources: [], warnings: [] });
    expect(thread[0].weighted_length).toBe(10); // 5 CJK * 2
    expect(thread[1].local_id).toBe("p2");
    expect(thread[1].sources).toEqual(["https://src"]); // sources on final post
  });

  it("handles a single post", () => {
    const thread = postsToThread(["only"], ["https://s"]);
    expect(thread).toHaveLength(1);
    expect(thread[0].sources).toEqual(["https://s"]);
    expect(thread[0].weighted_length).toBe(4);
  });
});
