import { describe, expect, it, vi } from "vitest";

import { classifyReferenceEntry, resolveReferencePosts } from "./pattern-reference-posts";

/**
 * 参考投稿の材料をURLから本文へ揃える（T-M8-399）。
 * 運営者がURLを貼って「本文内容を取得できず」で失敗した事象の再現と、読めなかったURLを
 * 黙って落とさないことを守る。
 */
describe("classifyReferenceEntry", () => {
  it("X投稿のURLは表記ゆれ（twitter.com・mobile・scheme無し・クエリ付き）を同じtweet_idへ揃える", () => {
    for (const raw of [
      "https://x.com/ExosAI/status/1234567890",
      "https://twitter.com/ExosAI/status/1234567890?s=20",
      "https://mobile.x.com/ExosAI/status/1234567890",
      "x.com/ExosAI/status/1234567890",
    ]) {
      const entry = classifyReferenceEntry(raw);
      expect(entry.kind, raw).toBe("url");
      if (entry.kind === "url") {
        expect(entry.tweetId).toBe("1234567890");
        expect(entry.url).toBe("https://x.com/exosai/status/1234567890");
      }
    }
  });

  it("Xのアカウント URL や X 以外の URL だけの行は「読めないURL」になる", () => {
    expect(classifyReferenceEntry("https://x.com/ExosAI").kind).toBe("invalid_url");
    expect(classifyReferenceEntry("https://example.com/blog/1").kind).toBe("invalid_url");
  });

  it("本文（リンクが混ざっていても）は本文として扱う", () => {
    const entry = classifyReferenceEntry("【悲報】〇〇が終了 https://x.com/a/status/1 詳細はこちら");
    expect(entry.kind).toBe("text");
  });
});

describe("resolveReferencePosts", () => {
  it("URLは本文へ引き直し、本文はそのまま、記入順を保つ。同じ投稿は1回だけ読む", async () => {
    const fetchTweets = vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, `本文${id}`])));
    const res = await resolveReferencePosts(
      ["https://x.com/a/status/111", "貼り付けた本文", "https://x.com/a/status/111", "x.com/b/status/222"],
      fetchTweets,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.posts).toEqual(["本文111", "貼り付けた本文", "本文111", "本文222"]);
      expect(res.tweetIds).toEqual(["111", "222"]);
    }
    expect(fetchTweets).toHaveBeenCalledTimes(1);
    expect(fetchTweets).toHaveBeenCalledWith(["111", "222"]);
  });

  it("本文だけならXを読まない", async () => {
    const fetchTweets = vi.fn();
    const res = await resolveReferencePosts(["本文A", "本文B"], fetchTweets);
    expect(res).toEqual({ ok: true, posts: ["本文A", "本文B"], tweetIds: [] });
    expect(fetchTweets).not.toHaveBeenCalled();
  });

  it("読めなかったURL（返らない・空本文）は理由に列挙し、読めた分だけで進めない（原則1）", async () => {
    const res = await resolveReferencePosts(
      ["https://x.com/a/status/111", "https://x.com/a/status/222", "本文"],
      async () => new Map([["111", "本文111"], ["222", ""]]),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toContain("https://x.com/a/status/222");
      expect(res.reason).not.toContain("status/111");
      expect(res.reason).toContain("読み取れませんでした");
    }
  });

  it("X投稿以外のURLだけの行は、Xを読む前にどの行が読めないかを返す", async () => {
    const fetchTweets = vi.fn();
    const res = await resolveReferencePosts(
      ["https://example.com/post", "https://x.com/a/status/111"],
      fetchTweets,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("https://example.com/post");
    expect(fetchTweets).not.toHaveBeenCalled();
  });
});
