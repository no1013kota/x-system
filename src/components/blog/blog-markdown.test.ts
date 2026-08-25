import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import { BlogMarkdown } from "./blog-markdown";

/**
 * Markdown 描画の契約（T-M8-184）。ブラウザでの見た目は e2e/blog.spec.ts が見るので、
 * ここでは「どの記法がどの要素になるか」と「生HTMLが出ないこと」を固定する。
 */
function render(source: string): string {
  return renderToStaticMarkup(createElement(BlogMarkdown, { source }));
}

describe("BlogMarkdown", () => {
  it("見出し・太字・斜体・箇条書き・番号付き・引用・区切り線を描画する", () => {
    const html = render(
      "## 見出し2\n\n### 見出し3\n\n**太字**と*斜体*。\n\n- 項目A\n- 項目B\n\n1. 一\n2. 二\n\n> 引用\n\n---\n",
    );
    expect(html).toContain("<h2");
    expect(html).toContain(">見出し2</h2>");
    expect(html).toContain(">見出し3</h3>");
    expect(html).toContain("<strong");
    expect(html).toContain(">太字</strong>");
    expect(html).toContain("<em>斜体</em>");
    expect(html).toMatch(/<ul[^>]*>[\s\S]*<li[^>]*>項目A<\/li>/);
    expect(html).toMatch(/<ol[^>]*>[\s\S]*<li[^>]*>一<\/li>/);
    expect(html).toContain("<blockquote");
    expect(html).toContain("<hr");
  });

  it("本文の # 見出しは h2 に落とす（ページの h1 は記事タイトル）", () => {
    const html = render("# 本文の大見出し\n\n段落");
    expect(html).not.toContain("<h1");
    expect(html).toContain(">本文の大見出し</h2>");
  });

  it("GFM: 表・打ち消し線・タスクリスト・自動リンク", () => {
    const html = render(
      "| 列A | 列B |\n|---|---|\n| 1 | 2 |\n\n~~消す~~\n\n- [x] 済み\n- [ ] 未了\n\nhttps://example.com/auto\n",
    );
    expect(html).toContain("<table");
    expect(html).toContain(">列A</th>");
    expect(html).toContain(">2</td>");
    // 表は横スクロールの枠で包み、キーボードで送れる（tabindex）。
    expect(html).toMatch(/<div[^>]*class="[^"]*overflow-x-auto[^"]*"[^>]*tabindex="0"[^>]*><table/);
    expect(html).toContain("<del>消す</del>");
    // タスクリスト: チェックボックスは装飾（aria-hidden）、状態は読み上げ用の文字で伝える。
    expect(html).toMatch(/<span class="sr-only">完了: <\/span><input[^>]*aria-hidden="true"[^>]*checked/);
    expect(html).toContain('<span class="sr-only">未完了: </span>');
    expect(html).toMatch(/<a[^>]*href="https:\/\/example\.com\/auto"/);
  });

  it("外部リンクは新しいタブ＋noopener、サイト内リンクは同じタブ", () => {
    const html = render("[外](https://example.com) と [内](/prompt-templates)");
    expect(html).toMatch(
      /<a[^>]*href="https:\/\/example\.com"[^>]*rel="noopener noreferrer"[^>]*target="_blank"/,
    );
    const internal = /<a[^>]*href="\/prompt-templates"[^>]*>/.exec(html)?.[0] ?? "";
    expect(internal).not.toContain("target=");
  });

  it("コードブロックとインラインコード（ブロックはキーボードで横スクロールできる）", () => {
    const html = render("文中の `code` と\n\n```ts\nconst a = 1;\n```\n");
    expect(html).toMatch(/<p[^>]*>文中の <code[^>]*>code<\/code>/);
    expect(html).toMatch(/<pre[^>]*tabindex="0"[^>]*><code[^>]*>const a = 1;\n<\/code><\/pre>/);
  });

  it("危険なURLのリンクは文字だけ、プロトコル相対リンクは外部扱い", () => {
    const html = render("[悪](javascript:alert(1)) と [相対](//cdn.example/x)");
    expect(html).not.toMatch(/<a[^>]*href=""/);
    expect(html).not.toContain("javascript:");
    expect(html).toContain("<span>悪</span>");
    expect(html).toMatch(/<a[^>]*href="\/\/cdn\.example\/x"[^>]*rel="noopener noreferrer"[^>]*target="_blank"/);
  });

  it("画像は遅延読み込み・alt を保持する", () => {
    const html = render("![説明文](/blog-images/x.png)");
    expect(html).toMatch(/<img[^>]*alt="説明文"[^>]*loading="lazy"/);
  });

  it("生のHTMLは描画しない（script も iframe も出ない）", () => {
    const html = render(
      '前\n\n<script>alert(1)</script>\n\n<iframe src="https://evil.example"></iframe>\n\n<b>太字タグ</b> 後\n',
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("<b>");
    expect(html).toContain("前");
    expect(html).toContain("後");
  });
});

describe("BlogMarkdown: DOM に余計な属性を出さない", () => {
  it("react-markdown の node prop を DOM 属性へ漏らさない", () => {
    const html = render("## h\n\n段落 **太** `c`\n\n- a\n\n| x |\n|---|\n| 1 |\n\n![i](/blog-images/a.png)\n");
    expect(html).not.toContain("node=");
  });
});
