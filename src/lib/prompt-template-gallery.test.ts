import { describe, expect, it } from "vitest";

import { validateBaseMdStructure } from "./persona-settings";
import { galleryTemplates } from "./prompt-template-gallery";
import { extractPlaceholderNames } from "./post/pattern-spec";
import { SYSTEM_DEFAULT_TEMPLATES } from "./prompts/gen-prompts";

/**
 * 公開プロンプト集（T-M8-173）。**正本から引いていること**を固定する——
 * ページへ書き写すとプロンプト改定のたびに公開ページだけ古くなる。
 */
describe("galleryTemplates", () => {
  const templates = galleryTemplates();

  it("アカウント.md・投稿6種・画像の8件がそろう", () => {
    expect(templates.map((t) => t.id)).toEqual([
      "account-md",
      "p1",
      "p2",
      "p3",
      "p4",
      "p5",
      "p6",
      "image",
    ]);
  });

  it("投稿・画像の本文はSYSTEM_DEFAULT_TEMPLATES（正本）と同一", () => {
    for (const t of templates) {
      if (t.group === "account-md") continue;
      expect(t.content).toBe(SYSTEM_DEFAULT_TEMPLATES[t.id as keyof typeof SYSTEM_DEFAULT_TEMPLATES]);
    }
  });

  it("サンプルのアカウント.mdは実物と同じ構造検証を通る", () => {
    const md = templates.find((t) => t.id === "account-md")!.content;
    expect(() => validateBaseMdStructure(md)).not.toThrow();
    expect(md).toContain("# 発信定義書");
  });

  /**
   * **本文が正本**（T-M8-317）。以前ここは「p2だけが `{自分の考え}`」と**手で並べた値の側**を
   * 固定していたため、PT-P1 へ `{ニュース}` が入っても緑のままで、ズレを検出できなかった。
   * 検査対象を本文からの導出に変える。
   */
  it("差し込み欄（placeholders）は本文の {名前} と一致する", () => {
    for (const t of templates) {
      expect(t.placeholders, `${t.id} が本文とズレている`).toEqual(
        extractPlaceholderNames(t.content),
      );
    }
  });

  it("全件に名前・説明・本文がある", () => {
    for (const t of templates) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.content.length).toBeGreaterThan(100);
    }
  });
});

/**
 * プロンプト集のプレースホルダーは**本文から導出**する（T-M8-317）。
 * 手で並べていた頃は PT-P1 へ `{ニュース}` を足しても表が追随せず、
 * ニュース解説だけ差し込み欄が出ないまま公開されていた。
 */
describe("既定パターンのプレースホルダー（本文が正本・T-M8-317）", () => {
  const byId = (id: string) => galleryTemplates().find((t) => t.id === id)!;

  it("ニュース解説に「ニュース」が出る", () => {
    expect(byId("p1").placeholders).toContain("ニュース");
  });

  it("自分の考え・意見に「自分の考え」が出る", () => {
    expect(byId("p2").placeholders).toContain("自分の考え");
  });

  it("本文の {名前} と完全に一致する（手で並べた値とズレない）", () => {
    for (const kind of ["p1", "p2", "p3", "p4", "p5", "p6"] as const) {
      const t = byId(kind);
      expect(t.placeholders, `${kind} が本文とズレている`).toEqual(
        extractPlaceholderNames(t.content),
      );
    }
  });
});
