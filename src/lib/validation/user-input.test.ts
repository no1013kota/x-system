import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  authoredFieldErrors,
  firstAuthoredIssueMessage,
  parseUserInput,
} from "./user-input";

/**
 * 利用者へ出す入力エラーの文言（F8・F9）。
 *
 * zod の既定文言は英語かつスキーマの説明（`Too big: expected string to have <=512 characters`）で、
 * そのまま出すと要件06 §8「内部用語を画面に使わない」に反する。一方「入力内容を確認してください。」
 * だけでは何を直せばよいか分からない（T-M8-37 と同型）。**作者が書いた文言だけを出す**。
 */

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

describe("parseUserInput / firstAuthoredIssueMessage", () => {
  it("作者が書いた文言はそのまま出せる", () => {
    const schema = z.object({ theme: z.array(z.string()).min(1, "テーマを1件以上選択してください。") });
    const parsed = parseUserInput(schema, { theme: [] });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(firstAuthoredIssueMessage(parsed.error)).toBe("テーマを1件以上選択してください。");
  });

  it("zodの既定文言は出さない（英語・内部語が画面へ漏れない）", () => {
    for (const [schema, value] of [
      [z.object({ a: z.string().max(3) }), { a: "toolong" }],
      [z.object({ b: z.enum(["x", "y"]) }), { b: "z" }],
      [z.object({ c: z.string() }).strict(), { c: "ok", unknown_key: 1 }],
      [z.object({ d: z.string() }), { d: 123 }],
      [z.object({ e: z.string().uuid() }), { e: "not-a-uuid" }],
    ] as const) {
      const parsed = parseUserInput(schema as z.ZodType, value);
      expect(parsed.success).toBe(false);
      if (parsed.success) continue;
      expect(
        firstAuthoredIssueMessage(parsed.error),
        `既定文言が画面へ出る: ${JSON.stringify(value)}`,
      ).toBeUndefined();
    }
  });

  /**
   * `issues[0]` ではなく**最初の非sentinel**を探す理由。
   * `.url()` と作者 refine が並ぶと、実測で作者文言は先頭に来ない。
   */
  it("作者文言が先頭でなくても拾える（.url() と refine が並ぶ場合）", () => {
    const schema = z.object({
      u: z
        .string()
        .url()
        .refine((v) => v.startsWith("https://"), "httpsのURLを指定してください。"),
    });
    const parsed = parseUserInput(schema, { u: "notaurl" });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.length).toBeGreaterThan(1);
    expect(firstAuthoredIssueMessage(parsed.error)).toBe("httpsのURLを指定してください。");
  });
});

describe("authoredFieldErrors", () => {
  it("項目ごとに作者文言だけを束ねる", () => {
    const schema = z.object({
      email: z.string().email("メールアドレスの形式で入力してください。"),
      // 作者文言を持たない（既定文言）→ キーごと出さない
      token: z.string().max(4),
    });
    const parsed = parseUserInput(schema, { email: "bad", token: "toolong" });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const fields = authoredFieldErrors(parsed.error);
    expect(fields.email).toEqual(["メールアドレスの形式で入力してください。"]);
    expect(fields.token, "既定文言しか無い項目はキーを出さない").toBeUndefined();
  });
});

/**
 * **素の `safeParse` を残さない**（F9）。
 *
 * 素のままだと既定文言と作者文言を区別できず、英語がそのまま画面へ出る経路が復活する。
 * 検出器が空振りしていないこと（1件以上走査できていること）も併せて見る。
 */
describe("利用者入力の検証は parseUserInput を通す", () => {
  const targets = [
    ...readdirSync(join(ROOT, "src", "app", "actions"))
      .filter((f) => f.endsWith(".ts") && !f.includes(".test."))
      .map((f) => join("src", "app", "actions", f)),
    join("src", "lib", "auth", "signin.ts"),
    join("src", "lib", "auth", "signup.ts"),
    join("src", "lib", "auth", "recovery.ts"),
  ];

  it("走査対象が見つかる（検査が空振りしていない）", () => {
    expect(targets.length).toBeGreaterThan(10);
  });

  it.each(targets)("%s に素の safeParse が無い", (rel) => {
    const source = readFileSync(join(ROOT, rel), "utf8");
    expect(
      source.includes(".safeParse("),
      `${rel} は parseUserInput（sentinel付き）を使ってください。素の safeParse では zod の英語の既定文言が画面へ出ます`,
    ).toBe(false);
  });
});

/**
 * 画面から到達する検証に**日本語の理由がある**こと（F10）。
 *
 * 作者文言が無いと汎用文（「入力内容を確認してください。」）に落ちる。それ自体は安全だが、
 * 利用者は何を直せばよいか分からない（T-M8-46 で「16文字という条件が画面のどこにも
 * 書かれていなかった」を直したのと同じ問題）。ここに行を足せば、その規則に文言が
 * 要ることを機械が言ってくれる。
 */
describe("画面から到達する検証の文言カバレッジ", () => {
  const XID = "11111111-1111-1111-1111-111111111111";
  const cases: [string, () => Promise<{ schema: z.ZodType; value: unknown }>][] = [
    [
      "ニュース表示件数が範囲外",
      async () => ({
        schema: (await import("@/lib/settings")).newsConfigSchema,
        value: { max_items: 999, categories: ["ai"] },
      }),
    ],
    [
      "AI APIキーが長すぎる",
      async () => ({
        schema: (await import("@/lib/api-keys")).saveAiApiKeySchema,
        value: { provider: "anthropic", api_key: "a".repeat(600) },
      }),
    ],
    [
      "Client IDが長すぎる",
      async () => ({
        schema: (await import("@/lib/api-keys")).saveXApiKeySchema,
        value: { client_id: "a".repeat(300), client_secret: "", client_type: "public" },
      }),
    ],
    [
      "曜日が0件",
      async () => ({
        schema: (await import("@/lib/schedule-slots")).createScheduleSlotSchema,
        value: {
          request_key: "k",
          x_account_id: XID,
          pattern: "p1",
          weekdays: [],
          time_jst: "09:00",
          mode: "draft",
          image_enabled: false,
          theme: "ai",
        },
      }),
    ],
    [
      "出典URLの形が不正",
      async () => ({
        schema: (await import("@/lib/jobs/generation-jobs")).createGenerationJobSchema,
        value: { request_key: "k", x_account_id: XID, pattern: "p1", theme: "ai", source_url: "notaurl" },
      }),
    ],
  ];

  it.each(cases.map(([name]) => name))("%s は理由が日本語で出る", async (name) => {
    const load = cases.find(([n]) => n === name)![1];
    const { schema, value } = await load();
    const parsed = parseUserInput(schema, value);
    expect(parsed.success, `${name} が検証を通ってしまう`).toBe(false);
    if (parsed.success) return;
    const message = firstAuthoredIssueMessage(parsed.error);
    expect(message, `${name} に作者文言が無い（汎用文へ落ちる）`).toBeDefined();
    // 英語の既定文言が紛れ込んでいないことを近似で見る（実装側は sentinel で厳密に排除している）。
    expect(message, `${name} の文言が日本語でない`).toMatch(/[ぁ-んァ-ヶ一-龠]/);
  });
});
