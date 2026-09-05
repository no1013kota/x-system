import { describe, expect, it } from "vitest";

import { SYS_GEN } from "@/lib/prompts/gen-prompts";

import {
  buildGenSystem,
  buildGenUser,
  formatRecentPosts,
  UNSPECIFIED,
  type NewsDigestItem,
} from "./gen-context";

describe("buildGenSystem", () => {
  it("is SYS-GEN followed by a wrapped base_md (fixed prefix)", () => {
    const sys = buildGenSystem("私のペルソナ");
    expect(sys).toHaveLength(2);
    expect(sys[0]).toBe(SYS_GEN);
    expect(sys[1]).toBe("<base_md>\n私のペルソナ\n</base_md>");
  });
});

describe("formatRecentPosts", () => {
  it("truncates each body to 80 chars, max 10 items, collapsing whitespace", () => {
    const out = formatRecentPosts([`${"あ".repeat(100)}`, "a\n\nb"]);
    const lines = out.split("\n");
    expect(lines).toHaveLength(2);
    expect([...lines[0].replace(/^- /, "")]).toHaveLength(80);
    expect(lines[1]).toBe("- a b");
  });

  it("caps at 10 items", () => {
    const out = formatRecentPosts(Array.from({ length: 15 }, (_, i) => `post ${i}`));
    expect(out.split("\n")).toHaveLength(10);
  });
});

describe("buildGenUser", () => {
  const base = { pattern: "PT-P1", recentPosts: ["最初の投稿"] };

  it("assembles pattern/input/recent_posts and uses （未指定） for empty input", () => {
    const user = buildGenUser({ ...base, input: "" });
    expect(user).toContain("<pattern>\nPT-P1\n</pattern>");
    expect(user).toContain(`<user_input>\n${UNSPECIFIED}\n</user_input>`);
    expect(user).toContain("<recent_posts>\n- 最初の投稿\n</recent_posts>");
  });

  it("uses （未指定） when there are no recent posts", () => {
    const user = buildGenUser({ pattern: "PT-P2", input: "考え", recentPosts: [] });
    expect(user).toContain(`<recent_posts>\n${UNSPECIFIED}\n</recent_posts>`);
  });

  it("omits <news_digest> when newsDigest is undefined (non-P6)", () => {
    expect(buildGenUser(base)).not.toContain("<news_digest>");
  });

  it("emits an empty [] digest for P-6 with no matching items", () => {
    const user = buildGenUser({ ...base, newsDigest: [] });
    expect(user).toContain("<news_digest>\n[]\n</news_digest>");
  });

  it("emits the news digest JSON array for P-6", () => {
    const items: NewsDigestItem[] = [
      { title: "t", summary: "s", source_url: "https://x", impact: "high" },
    ];
    const user = buildGenUser({ ...base, newsDigest: items });
    expect(user).toContain(`<news_digest>\n${JSON.stringify(items)}\n</news_digest>`);
  });

  it("includes <quote_post> only when provided (P-5 reserved)", () => {
    expect(buildGenUser(base)).not.toContain("<quote_post>");
    expect(buildGenUser({ ...base, quotePost: "元ポスト" })).toContain(
      "<quote_post>\n元ポスト\n</quote_post>",
    );
  });
});

describe("buildGenSystem × 書き方のチェックポイント（T-M8-447）", () => {
  it("選んだ条項が <base_md> の末尾に「## 書き方のチェックポイント」として入り、未選択なら本文だけ", async () => {
    const { WRITING_CHECKPOINTS, WRITING_CHECKPOINTS_GUARD } = await import("@/lib/prompts/writing-checkpoints");
    const id = WRITING_CHECKPOINTS[0]!.id;
    const withCp = buildGenSystem("# 発信定義\n本文", [id]);
    expect(withCp).toHaveLength(2);
    expect(withCp[1]).toContain("<base_md>\n# 発信定義\n本文\n\n## 書き方のチェックポイント\n");
    expect(withCp[1]).toContain(WRITING_CHECKPOINTS_GUARD);
    expect(withCp[1]).toContain(WRITING_CHECKPOINTS[0]!.instruction);
    expect(buildGenSystem("# 発信定義\n本文", [])[1]).toBe("<base_md>\n# 発信定義\n本文\n</base_md>");
    // 本文が空でも条項だけの封筒を渡す（条項を選んだ意思を落とさない）
    expect(buildGenSystem("", [id])).toHaveLength(2);
  });
});
