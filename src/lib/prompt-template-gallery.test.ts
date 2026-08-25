import { describe, expect, it } from "vitest";

import { validateBaseMdStructure } from "./persona-settings";
import { galleryTemplates } from "./prompt-template-gallery";
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

  it("差し込み欄（placeholders）はseedと同じ定義を持つ（p2だけが{自分の考え}）", () => {
    for (const t of templates) {
      expect(t.placeholders).toEqual(t.id === "p2" ? ["自分の考え"] : []);
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
