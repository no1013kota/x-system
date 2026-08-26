import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createGenerationJobSchema } from "@/lib/jobs/generation-jobs";

/**
 * **画面が送るキーが、受け側のスキーマと合っていること**（T-M8-330）。
 *
 * Server Action は `unknown` を受けて zod で検証するため、**画面側のキー名が間違っていても
 * typecheck は通る**。実際 T-M8-129 U5 で `pattern` → `pattern_id` へ改めたとき
 * スケジュール側だけが追随し、**投稿作成画面はずっと生成できない状態**だった
 * （画面には「入力内容に誤りがあります」とだけ出て、赤くなる項目も無い）。
 *
 * ソースから送信キーを拾い、スキーマの必須キーが揃っているかを突き合わせる。
 */
const FORM = fileURLToPath(new URL("./create-post-form.tsx", import.meta.url));

/** `createGenerationJobAction({ ... })` に渡しているオブジェクトのキー名を拾う。 */
function submittedKeys(): string[] {
  const src = readFileSync(FORM, "utf8");
  const start = src.indexOf("createGenerationJobAction({");
  expect(start, "createGenerationJobAction の呼び出しが見つからない（検出器が死んでいる）").toBeGreaterThan(-1);
  let depth = 0;
  let i = src.indexOf("{", start);
  const from = i;
  for (; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  const body = src.slice(from + 1, i);
  // `key: value` と shorthand `key,` の両方を拾う（インデント直後のものだけ＝ネストを除く）
  return [...body.matchAll(/^\s{8}([a-z_]+)\s*[:,]/gm)].map((m) => m[1]);
}

describe("投稿作成フォームの送信キー（T-M8-330）", () => {
  const keys = submittedKeys();

  it("キーを1つ以上拾えている（走査が空振りしていない）", () => {
    expect(keys.length).toBeGreaterThan(5);
  });

  it("スキーマの必須キーをすべて送っている", () => {
    const required = Object.entries(createGenerationJobSchema.shape)
      .filter(([, def]) => !def.safeParse(undefined).success)
      .map(([name]) => name);
    expect(required.length, "必須キーが取れていない").toBeGreaterThan(0);
    const missing = required.filter((name) => !keys.includes(name));
    expect(missing, "画面が送っていない必須キーがある（生成が毎回検証で落ちる）").toEqual([]);
  });

  it("スキーマに無いキーを送っていない（綴り違いを落とす）", () => {
    const known = Object.keys(createGenerationJobSchema.shape);
    const unknownKeys = keys.filter((name) => !known.includes(name));
    expect(unknownKeys, "スキーマに無いキーを送っている").toEqual([]);
  });
});
