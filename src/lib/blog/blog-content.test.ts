import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  formatBlogDate,
  isBlogArticleFile,
  localImagePaths,
  markdownImages,
  parseBlogPost,
  publishedPosts,
  slugFromFileName,
  type BlogPost,
} from "./blog-content";

const VALID = `---
title: Xの投稿プロンプトの作り方
description: 型から作ると続く。最初の1本をどう書くか。
date: 2026-08-21
tags: [プロンプト, X運用]
---

## はじめに

本文。
`;

function errorsOf(source: string, slug = "valid-slug"): string[] {
  const result = parseBlogPost(source, slug);
  return result.ok ? [] : result.errors;
}

describe("parseBlogPost", () => {
  it("title/description/date/tags と本文を取り出す（draft は既定で false）", () => {
    const result = parseBlogPost(VALID, "x-prompt-basics");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.post).toMatchObject({
      slug: "x-prompt-basics",
      title: "Xの投稿プロンプトの作り方",
      description: "型から作ると続く。最初の1本をどう書くか。",
      date: "2026-08-21",
      draft: false,
      tags: ["プロンプト", "X運用"],
    });
    expect(result.post.body.trim()).toBe("## はじめに\n\n本文。");
    expect(result.post.updated).toBeUndefined();
  });

  it("draft: true は下書き、updated は任意", () => {
    const result = parseBlogPost(
      VALID.replace("date: 2026-08-21", "date: 2026-08-21\nupdated: 2026-08-22\ndraft: true"),
      "slug",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.post.draft).toBe(true);
    expect(result.post.updated).toBe("2026-08-22");
  });

  it("引用符付きの値・カンマ区切りのtags・CRLF・BOM を受け付ける", () => {
    const source =
      '﻿---\r\ntitle: "引用符: あり"\r\ndescription: \'要約\'\r\ndate: 2026-01-05\r\ntags: a, b, a\r\n---\r\n\r\n本文\r\n';
    const result = parseBlogPost(source, "quoted");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.post.title).toBe("引用符: あり");
    expect(result.post.description).toBe("要約");
    expect(result.post.tags).toEqual(["a", "b"]);
  });

  it("必須項目の欠落は**すべて**列挙する（1つずつ直させない）", () => {
    const errors = errorsOf("---\ndraft: false\n---\n本文\n");
    expect(errors.some((e) => e.includes("title"))).toBe(true);
    expect(errors.some((e) => e.includes("description"))).toBe(true);
    expect(errors.some((e) => e.includes("date"))).toBe(true);
    expect(errors).toHaveLength(3);
  });

  it("空の front matter は閉じ不足ではなく必須項目の欠落として報告する", () => {
    const errors = errorsOf("---\n---\n本文\n");
    expect(errors).toHaveLength(3);
    expect(errors.join()).not.toContain("閉じ");
  });

  it("front matter が無い／閉じていない／本文が無い", () => {
    expect(errorsOf("# 見出しだけ\n")).toEqual([
      expect.stringContaining("front matter"),
    ]);
    expect(errorsOf("---\ntitle: a\n")).toEqual([expect.stringContaining("閉じ")]);
    expect(errorsOf("---\ntitle: a\ndescription: b\ndate: 2026-08-21\n---\n")).toEqual([
      expect.stringContaining("本文"),
    ]);
  });

  it("知らないキー・重複キー・形式外の行を誤記として止める", () => {
    const errors = errorsOf(
      "---\ntitle: a\ntitle: b\ndescription: c\ndate: 2026-08-21\nauthor: me\nこれは行\n---\n本文\n",
    );
    expect(errors).toEqual([
      expect.stringContaining("「title」が2回"),
      expect.stringContaining("「author」は使えません"),
      expect.stringContaining("key: value の形ではありません"),
    ]);
  });

  it("date は実在する YYYY-MM-DD、updated は date 以降、draft は true/false", () => {
    expect(errorsOf(VALID.replace("2026-08-21", "2026-02-30"))).toEqual([
      expect.stringContaining("実在する日付"),
    ]);
    expect(errorsOf(VALID.replace("2026-08-21", "21/08/2026"))).toEqual([
      expect.stringContaining("YYYY-MM-DD"),
    ]);
    expect(errorsOf(VALID.replace("date: 2026-08-21", "date: 2026-08-21\nupdated: 2026-08-01"))).toEqual([
      expect.stringContaining("より前"),
    ]);
    expect(errorsOf(VALID.replace("date: 2026-08-21", "date: 2026-08-21\ndraft: yes"))).toEqual([
      expect.stringContaining("true か false"),
    ]);
  });

  it("slug は小文字英数字とハイフンだけ（URLで読める形）", () => {
    expect(errorsOf(VALID, "日本語")).toEqual([expect.stringContaining("URLに使えません")]);
    expect(errorsOf(VALID, "Has_Upper")).toEqual([expect.stringContaining("URLに使えません")]);
    expect(errorsOf(VALID, "-leading")).toEqual([expect.stringContaining("URLに使えません")]);
    expect(errorsOf(VALID, "a".repeat(81))).toEqual([expect.stringContaining("長すぎます")]);
    expect(errorsOf(VALID, "ok-slug-2")).toEqual([]);
  });

  it("title / description の長さ上限", () => {
    expect(errorsOf(VALID.replace("Xの投稿プロンプトの作り方", "あ".repeat(81)))).toEqual([
      expect.stringContaining("title が長すぎます"),
    ]);
    expect(
      errorsOf(VALID.replace("型から作ると続く。最初の1本をどう書くか。", "い".repeat(201))),
    ).toEqual([expect.stringContaining("description が長すぎます")]);
  });

  it("閉じは行全体が --- の行だけ（---- や --- x は閉じにしない）", () => {
    expect(errorsOf("---\ntitle: a\ndescription: b\ndate: 2026-08-21\n----\n本文\n")).toEqual([
      expect.stringContaining("閉じ"),
    ]);
    const result = parseBlogPost(
      "--- \ntitle: a\ndescription: b\ndate: 2026-08-21\n  ---  \n本文\n",
      "spaced",
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.post.body).toBe("本文\n");
  });

  it("tags 全体を引用符で囲んでも引用符がタグに残らない。文字数は絵文字を1文字と数える", () => {
    const result = parseBlogPost(VALID.replace("tags: [プロンプト, X運用]", 'tags: "[a, b]"'), "q");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.post.tags).toEqual(["a", "b"]);
    // 絵文字40個＝UTF-16では80単位だが40文字。上限80字に収まる。
    expect(errorsOf(VALID.replace("Xの投稿プロンプトの作り方", "😀".repeat(40) + "あ".repeat(40)))).toEqual([]);
    expect(errorsOf(VALID.replace("Xの投稿プロンプトの作り方", "😀".repeat(81)))).toEqual([
      expect.stringContaining("81文字"),
    ]);
  });

  it("画像には代替テキストが要る（コードブロック内は見ない）", () => {
    expect(errorsOf(VALID + "\n![](/blog-images/a.png)\n")).toEqual([
      expect.stringContaining("代替テキスト"),
    ]);
    expect(errorsOf(VALID + "\n![図](/blog-images/a.png)\n\n```md\n![](/x.png)\n```\n")).toEqual([]);
  });

  it("front matter の直後に --- を含む本文（区切り線）を壊さない", () => {
    const result = parseBlogPost(
      "---\ntitle: a\ndescription: b\ndate: 2026-08-21\n---\n段落1\n\n---\n\n段落2\n",
      "hr",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.post.body).toBe("段落1\n\n---\n\n段落2\n");
  });
});

describe("ファイルの扱い", () => {
  it("README と _ 始まりは記事にしない", () => {
    expect(isBlogArticleFile("hello.md")).toBe(true);
    expect(isBlogArticleFile("README.md")).toBe(false);
    expect(isBlogArticleFile("_template.md")).toBe(false);
    expect(isBlogArticleFile("notes.txt")).toBe(false);
    expect(slugFromFileName("x-prompt.md")).toBe("x-prompt");
  });
});

describe("publishedPosts", () => {
  const post = (slug: string, date: string, draft = false): BlogPost => ({
    slug,
    title: slug,
    description: "d",
    date,
    draft,
    tags: [],
    body: "b",
  });

  it("下書きを除き、新しい順（同日は slug 昇順）に並べる", () => {
    const sorted = publishedPosts([
      post("b", "2026-08-01"),
      post("draft", "2026-09-01", true),
      post("a", "2026-08-01"),
      post("new", "2026-08-20"),
    ]);
    expect(sorted.map((p) => p.slug)).toEqual(["new", "a", "b"]);
  });
});

describe("formatBlogDate", () => {
  it("YYYY-MM-DD を日本語表記にする", () => {
    expect(formatBlogDate("2026-08-05")).toBe("2026年8月5日");
  });
});

describe("画像の参照", () => {
  it("Markdown 画像を拾い、サイト内パスだけを localImagePaths が返す", () => {
    const body =
      '![a](/blog-images/a.png) ![b](https://example.com/b.png "title") ![c](//cdn.example/c.png)\n\n`![x](/inline.png)`\n\n![a](/blog-images/a.png)';
    expect(markdownImages(body).map((i) => i.src)).toEqual([
      "/blog-images/a.png",
      "https://example.com/b.png",
      "//cdn.example/c.png",
      "/blog-images/a.png",
    ]);
    expect(localImagePaths(body)).toEqual(["/blog-images/a.png"]);
  });
});

describe("判定モジュールの前提", () => {
  it("blog-content.ts は import を持たない（scripts/blog-check.mjs が Node から直接読むため）", () => {
    const source = readFileSync(fileURLToPath(new URL("./blog-content.ts", import.meta.url)), "utf8");
    expect(source).not.toMatch(/^import\s/m);
    expect(source).not.toMatch(/\brequire\(/);
  });
});
