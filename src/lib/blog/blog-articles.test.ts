import { describe, expect, it } from "vitest";

import { readBlogCollection } from "./blog-files";

/**
 * **実際の記事**（リポジトリ直下 `blog/*.md`）がすべて解析できること（T-M8-184）。
 *
 * front matter の不備は公開側に出ないだけで例外にはならない（黙って1件減る）ので、
 * ここで CI を止める。同じ判定を `npm run blog:check` が運営者向けに出す。
 */
describe("blog/ の実記事", () => {
  it("front matter の不備が無い", () => {
    const { invalid, directoryExists } = readBlogCollection();
    expect(directoryExists, "blog/ ディレクトリが無い").toBe(true);
    expect(
      invalid.map(({ file, errors }) => `${file}: ${errors.join(" / ")}`),
      "npm run blog:check で同じ内容を確認できます",
    ).toEqual([]);
  });
});
