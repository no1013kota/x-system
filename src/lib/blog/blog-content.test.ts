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
  unrenderableBoldMarkers,
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

  it("image は /blog-images/ 配下のサイト内パスだけを受け付ける（任意）", () => {
    const withImage = VALID.replace(
      "tags: [プロンプト, X運用]",
      "tags: [プロンプト, X運用]\nimage: /blog-images/eyecatch/x-prompt-basics.png",
    );
    const result = parseBlogPost(withImage, "x-prompt-basics");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.post.image).toBe("/blog-images/eyecatch/x-prompt-basics.png");
    // 無ければ undefined（既存記事の見た目を変えない）。
    const plain = parseBlogPost(VALID, "x-prompt-basics");
    if (plain.ok) expect(plain.post.image).toBeUndefined();
    // 外部URL・public 直下・拡張子違い・親ディレクトリ参照は形式外。
    for (const bad of [
      "https://example.com/a.png",
      "/a.png",
      "/blog-images/a.gif",
      "/blog-images/../secret.png",
      "blog-images/a.png",
      "/blog-images/dir with space/a.png",
    ]) {
      expect(errorsOf(VALID.replace("date: 2026-08-21", `date: 2026-08-21\nimage: ${bad}`))).toEqual([
        expect.stringContaining("image「"),
      ]);
    }
    // 引用符で囲んでもよい。
    expect(errorsOf(VALID.replace("date: 2026-08-21", 'date: 2026-08-21\nimage: "/blog-images/a.webp"'))).toEqual([]);
  });

  it("太字にならない ** は行番号つきで不備にする（コードブロック内は見ない）", () => {
    const withBold = (line: string) => VALID + `\n${line}\n`;
    // VALID は front matter（--- 込みで6行）＋空行＋見出し＋空行＋本文＋空行 → 追加行はファイルの12行目。
    const errors = errorsOf(withBold("これは**「配る」**へ向かう"));
    expect(errors).toEqual([expect.stringContaining("12行目の ** が太字にならず")]);
    expect(errors[0]).toContain("直前「は」直後「「」");
    expect(errors[0]).toContain("直前「」」直後「へ」");
    expect(errorsOf(withBold("（**一次資料**）と **太字** です。**「配る」競争へ**（行頭）"))).toEqual([]);
    expect(errorsOf(withBold("```md\nは**「配る」**へ\n```"))).toEqual([]);
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

  it("front matter の image（アイキャッチ）も localImagePaths に含める（置き忘れを実在確認で拾う）", () => {
    expect(localImagePaths("![a](/blog-images/a.png)", "/blog-images/eyecatch/x.png")).toEqual([
      "/blog-images/eyecatch/x.png",
      "/blog-images/a.png",
    ]);
    expect(localImagePaths("本文だけ", "/blog-images/a.png")).toEqual(["/blog-images/a.png"]);
    expect(localImagePaths("本文だけ")).toEqual([]);
  });
});

/**
 * `**` が太字にならない条件は CommonMark の flanking 規則で決まり、実際に描画してみないと分からない。
 * ここでの期待値は micromark（react-markdown の中身）で描画して確かめた結果（2026-09-05）。
 */
describe("unrenderableBoldMarkers", () => {
  const lines = (body: string) => unrenderableBoldMarkers(body).map((m) => m.line);

  it("約物の内側に太字を置くと開始・終了になれない（実記事で起きた4パターン）", () => {
    expect(unrenderableBoldMarkers("は**「配る」**へ")).toEqual([
      { line: 1, before: "は", after: "「", snippet: "は**「配る」**へ" },
      { line: 1, before: "」", after: "へ", snippet: "は**「配る」**へ" },
    ]);
    // 終了の直前が「）」で直後が文字。
    expect(lines("違反には**最大1,500万ユーロ（いずれか高い方）**の制裁金")).toEqual([1, 1]);
    // 開始の直前が「、」で直後が「「」は開始になれるが、終了側（」の直後が文字）が対にならない。
    expect(lines("先送りされており、**「基盤モデルには早く」**という優先順位")).toEqual([1, 1]);
    // 全角の「＝」は記号（\p{S}）なので約物扱い。
    expect(lines("記号列＝**「意味ID」**に要約")).toEqual([1, 1]);
    expect(lines("先に。**git（ギット）**は仕組み")).toEqual([1, 1]);
  });

  it("正しく太字になる書き方は返さない", () => {
    for (const ok of [
      "**太字** です",
      "**「配る」競争へ**（行頭）",
      "（**一次資料**）",
      "**重み**（設定パラメータ）",
      "日本語**太字**日本語",
      "**強調**、次。**8月6日**: 次",
      "「**何が起きたか**（事実）→ **深掘り**（解釈）」",
      "- **項目**: 説明\n- **次**（補足）",
      "| 列 | **太字**（注） |\n|---|---|\n| **a** | b |",
      "## **見出し**の太字",
      "> 引用の**太字**。",
      "*斜体*と***両方***。**`code`** です",
      "エスケープ \\*\\* はそのまま",
    ]) {
      expect(unrenderableBoldMarkers(ok), ok).toEqual([]);
    }
  });

  it("行番号は本文の行、コードブロック・インラインコードの中は見ない", () => {
    const body = "段落\n\n```\nは**「x」**へ\n```\n\n`は**「x」**へ` は無視\n\n本文の**「x」**で失敗";
    expect(lines(body)).toEqual([9, 9]);
  });

  it("段落・箇条書きの項目・表のセルをまたいで対にしない", () => {
    // 別の項目の ** 同士が対に見えてしまうと見逃す。
    expect(lines("- 太字**「開始」\n- 終了」**へ")).toEqual([1, 2]);
    expect(lines("| a**「 | 」**b |\n|---|---|\n| c | d |")).toEqual([1, 1]);
    // 同じ段落の中なら行をまたいで対になる。
    expect(lines("**太字の\n続き**")).toEqual([]);
  });
});

describe("判定モジュールの前提", () => {
  it("blog-content.ts は import を持たない（scripts/blog-check.mjs が Node から直接読むため）", () => {
    const source = readFileSync(fileURLToPath(new URL("./blog-content.ts", import.meta.url)), "utf8");
    expect(source).not.toMatch(/^import\s/m);
    expect(source).not.toMatch(/\brequire\(/);
  });
});
