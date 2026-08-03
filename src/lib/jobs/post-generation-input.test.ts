import { describe, expect, it } from "vitest";

import { composeUserInput } from "./post-generation";

/**
 * `<input>` ブロックの組み立て（T-M8-28）。
 *
 * 分野（発信テーマ）を渡せるようにしたので、**入る順番と未指定時の扱い**を固定する。
 * 分野を先に置くのは、題材の選び方を最初に縛るため（SYS-GEN の「分野があればその分野に限定する」）。
 */
describe("composeUserInput", () => {
  it("分野を先頭に日本語ラベルで出す（idをそのまま渡さない）", () => {
    expect(composeUserInput({ theme: "business_ops" })).toBe("分野: 業務改善");
  });

  it("分野・参考URL・自分の考え・追加指示の順に並べる", () => {
    expect(
      composeUserInput({
        theme: "ai",
        source_url: "https://example.com/a",
        user_opinion: "私はこう思う",
        instructions: "短めに",
      }),
    ).toBe("分野: AI\n参考URL: https://example.com/a\n自分の考え: 私はこう思う\n追加指示: 短めに");
  });

  it("**分野が未指定なら行を出さない**（従来どおりAIが発信テーマから選ぶ）", () => {
    expect(composeUserInput({ source_url: "https://example.com/a" })).toBe(
      "参考URL: https://example.com/a",
    );
    expect(composeUserInput({ theme: null, instructions: "短めに" })).toBe("追加指示: 短めに");
  });

  it("何も無ければ空文字（「（未指定）」のような文字列を素材へ混ぜない）", () => {
    expect(composeUserInput({})).toBe("");
  });
});
