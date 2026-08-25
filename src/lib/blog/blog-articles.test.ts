import { describe, expect, it } from "vitest";

import { BLOG_DRAFTS_DIR, readBlogCollection } from "./blog-files";

/**
 * **実際の記事**（`blog/published/*.md`・`blog/drafts/*.md`）がすべて解析できること（T-M8-184）。
 *
 * front matter の不備は公開側に出ないだけで例外にはならない（黙って1件減る）ので、
 * ここで CI を止める。同じ判定を `npm run blog:check` が運営者向けに出す。
 */
describe("blog/ の実記事", () => {
  it("公開記事（published/）に front matter の不備が無い", () => {
    const { invalid, directoryExists } = readBlogCollection();
    expect(directoryExists, "blog/published/ ディレクトリが無い").toBe(true);
    expect(
      invalid.map(({ file, errors }) => `${file}: ${errors.join(" / ")}`),
      "npm run blog:check で同じ内容を確認できます",
    ).toEqual([]);
  });

  it("下書き（drafts/）も解析でき、公開記事が紛れ込んでいない", () => {
    // ディレクトリ自体は .gitkeep で常に存在する（無ければフォルダ分割が壊れている）。
    const { posts, invalid, directoryExists } = readBlogCollection(BLOG_DRAFTS_DIR);
    expect(directoryExists, "blog/drafts/ ディレクトリが無い").toBe(true);
    expect(invalid.map(({ file, errors }) => `${file}: ${errors.join(" / ")}`)).toEqual([]);
    // drafts に draft: true の無い記事があると、公開したつもりで永久に出ない（原則1）。
    expect(posts.filter((p) => !p.draft).map((p) => p.slug)).toEqual([]);
  });
});
