import { describe, expect, it } from "vitest";
import { fillPlaceholders } from "@/lib/post/pattern-spec";

describe("fillPlaceholders", () => {
  it("{名前} を入力で置き換える", () => {
    const out = fillPlaceholders("A {自分の考え} B {自分の考え} C", [{ name: "自分の考え" }], {
      自分の考え: " 私はこう思う ",
    });
    expect(out).toBe("A 私はこう思う B 私はこう思う C");
  });
  it("未入力は（未指定）にする。空文字で消して文を壊さない", () => {
    expect(fillPlaceholders("{対象読者} へ", [{ name: "対象読者" }], {})).toBe("（未指定） へ");
    expect(fillPlaceholders("{対象読者} へ", [{ name: "対象読者" }], { 対象読者: "  " })).toBe(
      "（未指定） へ",
    );
  });
  it("正規表現の特殊文字を含む名前でもそのまま扱える", () => {
    expect(fillPlaceholders("{a.b(c)} x", [{ name: "a.b(c)" }], { "a.b(c)": "値" })).toBe("値 x");
  });
  it("定義されていない {語} は触らない（プロンプトの記法を壊さない）", () => {
    expect(fillPlaceholders("{未定義} と {名前}", [{ name: "名前" }], { 名前: "値" })).toBe(
      "{未定義} と 値",
    );
  });
});
