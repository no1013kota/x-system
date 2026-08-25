import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  findPublishedPost,
  listPublishedPosts,
  missingLocalImages,
  readBlogCollection,
} from "./blog-files";

const article = (title: string, date: string, extra = "") =>
  `---\ntitle: ${title}\ndescription: 要約\ndate: ${date}\n${extra}---\n\n## 本文\n\n${title}\n`;

describe("readBlogCollection", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "blog-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("記事・下書き・不備・除外ファイルを分けて返す（不備は理由つき）", () => {
    writeFileSync(join(dir, "first.md"), article("最初", "2026-08-01"));
    writeFileSync(join(dir, "second.md"), article("2本目", "2026-08-10"));
    writeFileSync(join(dir, "wip.md"), article("下書き", "2026-08-20", "draft: true\n"));
    writeFileSync(join(dir, "broken.md"), "---\ntitle: 壊れ\n---\n本文\n");
    writeFileSync(join(dir, "README.md"), "# 書き方\n");
    writeFileSync(join(dir, "_template.md"), "---\ntitle: x\n---\n");
    writeFileSync(join(dir, "image.png"), "");

    const collection = readBlogCollection(dir);
    expect(collection.directoryExists).toBe(true);
    expect(collection.posts.map((p) => p.slug).sort()).toEqual(["first", "second", "wip"]);
    expect(collection.invalid).toEqual([
      {
        file: "broken.md",
        errors: [expect.stringContaining("description"), expect.stringContaining("date")],
      },
    ]);

    expect(listPublishedPosts(dir).map((p) => p.slug)).toEqual(["second", "first"]);
    expect(findPublishedPost("second", dir)?.title).toBe("2本目");
    // 下書き・不備・存在しないものは同じく null（404）。
    expect(findPublishedPost("wip", dir)).toBeNull();
    expect(findPublishedPost("broken", dir)).toBeNull();
    expect(findPublishedPost("nope", dir)).toBeNull();
  });

  it("本文が参照するサイト内画像が public に無ければ不備として公開しない", () => {
    const publicDir = join(dir, "public");
    mkdirSync(join(publicDir, "blog-images"), { recursive: true });
    writeFileSync(join(publicDir, "blog-images", "ok.png"), "");
    writeFileSync(
      join(dir, "with-images.md"),
      article("画像あり", "2026-08-01") + "\n![ある](/blog-images/ok.png)\n![ない](/blog-images/missing.png)\n![外部](https://example.com/x.png)\n",
    );
    const collection = readBlogCollection(dir, publicDir);
    expect(collection.posts).toEqual([]);
    expect(collection.invalid).toEqual([
      { file: "with-images.md", errors: [expect.stringContaining("/blog-images/missing.png")] },
    ]);
    expect(missingLocalImages("![a](/blog-images/ok.png)", publicDir)).toEqual([]);
    expect(findPublishedPost("with-images", dir, publicDir)).toBeNull();
  });

  it("ディレクトリが無いときは「記事0件」と区別できる", () => {
    const missing = join(dir, "missing");
    expect(readBlogCollection(missing)).toEqual({ posts: [], invalid: [], directoryExists: false });
    mkdirSync(missing);
    expect(readBlogCollection(missing)).toEqual({ posts: [], invalid: [], directoryExists: true });
  });
});
