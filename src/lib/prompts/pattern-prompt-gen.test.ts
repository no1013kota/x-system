import { describe, expect, it } from "vitest";

import { createDeadline } from "@/lib/jobs/deadline";
import type { TextGen } from "@/lib/ai/types";

import { generatePatternFromExamples } from "./pattern-prompt-gen";

/** 応答列を順に返す偽TextGen。 */
function fakeTextGen(responses: string[]): TextGen {
  let i = 0;
  return {
    generate: async () => ({
      text: responses[Math.min(i++, responses.length - 1)],
      provider: "anthropic",
      usage: { input_tokens: 100, output_tokens: 100 },
    }),
  } as unknown as TextGen;
}

const deadline = createDeadline();

describe("generatePatternFromExamples (T-M8-397)", () => {
  const ok = JSON.stringify({
    name: "検証の型",
    description: "テスト用",
    prompt: "# 投稿内容\n{題材}について書く。\n\n# 語り口\n断定調。",
    error: null,
  });

  it("正常出力をそのまま返し、プレースホルダー込みのプロンプトが入る", async () => {
    const res = await generatePatternFromExamples(
      { textGen: fakeTextGen([ok]), model: "claude-sonnet-5" },
      { posts: ["参考投稿1"], hint: "", deadline },
    );
    expect(res.ok).toBe(true);
    expect(res.prompt).toContain("{題材}");
    expect(res.calls).toHaveLength(1);
  });

  it("読めない出力は1回だけ直させ、直れば成功する", async () => {
    const res = await generatePatternFromExamples(
      { textGen: fakeTextGen(["これはJSONではない", ok]), model: "m" },
      { posts: ["参考投稿1"], hint: "", deadline },
    );
    expect(res.ok).toBe(true);
    expect(res.calls).toHaveLength(2);
  });

  it("2回とも読めなければ失敗として理由を返す（黙って空にしない・原則1）", async () => {
    const res = await generatePatternFromExamples(
      { textGen: fakeTextGen(["x", "y"]), model: "m" },
      { posts: ["参考投稿1"], hint: "", deadline },
    );
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("読み取れません");
    expect(res.calls).toHaveLength(2);
  });

  it("AIがerrorを返したら理由をそのまま伝える", async () => {
    const err = JSON.stringify({ name: "", description: "", prompt: "", error: "投稿が短すぎて型を読み取れません" });
    const res = await generatePatternFromExamples(
      { textGen: fakeTextGen([err]), model: "m" },
      { posts: ["短い"], hint: "", deadline },
    );
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("投稿が短すぎて型を読み取れません");
  });

  it("プレースホルダーが10個を超えるプロンプトは受け取らない（T-M8-186の上限）", async () => {
    const holes = Array.from({ length: 11 }, (_, i) => `{項目${i + 1}}`).join(" ");
    const tooMany = JSON.stringify({ name: "n", description: "", prompt: `# 投稿内容\n${holes}`, error: null });
    const res = await generatePatternFromExamples(
      { textGen: fakeTextGen([tooMany]), model: "m" },
      { posts: ["参考"], hint: "", deadline },
    );
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("入力項目が多すぎ");
  });
});
