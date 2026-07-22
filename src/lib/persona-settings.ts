import { z } from "zod";

import { THEME_IDS, themeLabel } from "./themes";

const requiredText = z.string().trim().min(1, "入力してください。");
const optionalText = z.string().trim();
const stringList = z.array(z.string().trim().min(1)).default([]);
const themeIdSchema = z.enum(THEME_IDS);

export const DEFAULT_TONE_SETTINGS = {
  emoji_max_per_post: 1,
  emoji_policy: "limited",
  first_person: "私",
  hashtags_max: 0,
  sentence_style: "polite",
  thread_numbering: true,
} as const;

export const personaSettingsSchema = z
  .object({
    ng: z.object({
      rules: stringList,
      topics: stringList,
      words: stringList,
    }),
    persona: z.object({
      audience: requiredText,
      speaker: requiredText,
      value: requiredText,
    }),
    themes: z
      .object({
        free_text: optionalText.default(""),
        primary: z
          .array(themeIdSchema)
          .min(1, "主テーマを1件以上選択してください。"),
        secondary: z.array(themeIdSchema).default([]),
      })
      .superRefine((themes, context) => {
        const selected = [...themes.primary, ...themes.secondary];
        if (new Set(selected).size !== selected.length) {
          context.addIssue({
            code: "custom",
            message: "同じテーマを重複して選択できません。",
            path: ["secondary"],
          });
        }
      }),
    tone: z
      .object({
        emoji_max_per_post: z.number().int().min(0),
        emoji_policy: z.enum(["none", "limited"]),
        first_person: requiredText,
        hashtags_max: z.number().int().min(0),
        sentence_style: z.enum(["polite", "assertive"]),
        thread_numbering: z.boolean(),
      })
      .superRefine((tone, context) => {
        if (tone.emoji_policy === "none" && tone.emoji_max_per_post !== 0) {
          context.addIssue({
            code: "custom",
            message: "絵文字を使わない場合の上限は0にしてください。",
            path: ["emoji_max_per_post"],
          });
        }
      }),
  })
  .strict();

export type PersonaSettings = z.infer<typeof personaSettingsSchema>;

const BASE_MD_HEADING_PATTERN = /^## ([1-6])\.[^\n]*$/gm;
const BASE_MD_SECTION_TITLES = [
  "ペルソナ",
  "発信テーマ",
  "トーン&マナー",
  "やらないこと",
  "文体・自分らしさ",
  "参考にする型",
] as const;

function listOrFallback(values: string[], fallback = "指定なし"): string {
  return values.length > 0 ? values.join("、") : fallback;
}

function buildSettingsSections(input: unknown): string {
  const settings = personaSettingsSchema.parse(input);
  const primary = settings.themes.primary.map(themeLabel);
  const scope = [
    ...settings.themes.secondary.map(themeLabel),
    settings.themes.free_text,
  ].filter(Boolean);
  const emoji =
    settings.tone.emoji_policy === "none"
      ? "使わない"
      : `1投稿${settings.tone.emoji_max_per_post}個まで`;
  const hashtags =
    settings.tone.hashtags_max === 0
      ? "付けない"
      : `最大${settings.tone.hashtags_max}個`;
  const thread = settings.tone.thread_numbering
    ? "付ける（例 1/5）"
    : "付けない";
  const sentence =
    settings.tone.sentence_style === "polite" ? "です・ます調" : "断定調";
  const ngLines = [
    ...settings.ng.topics.map((topic) => `- ${topic}には触れない`),
    ...(settings.ng.words.length > 0
      ? ["- 別管理のNGワードリストに一致する表現を使用しない"]
      : []),
    "- 特定銘柄・商品の売買や購入を推奨しない",
    "- 競合・他者への攻撃的な言及をしない",
    ...settings.ng.rules.map((rule) => `- ${rule}`),
  ];

  return `# 発信定義書（ベースmd）
<!-- このファイルはAIへの指示書。宣言文で書き、形容詞より
     「検証できるルール」と「実例」で指定する -->

## 1. ${BASE_MD_SECTION_TITLES[0]}
- 発信者: ${settings.persona.speaker}
- 読者: ${settings.persona.audience}
- 読者が得るもの: ${settings.persona.value}

## 2. ${BASE_MD_SECTION_TITLES[1]}
- 主テーマ: ${primary.join("、")}
- 扱う範囲: ${listOrFallback(scope)}
- 扱わない範囲: ${listOrFallback(settings.ng.topics)}

## 3. ${BASE_MD_SECTION_TITLES[2]}
- 文末: ${sentence}
- 一人称: ${settings.tone.first_person}
- 絵文字: ${emoji}
- ハッシュタグ: ${hashtags}
- スレッド番号表記: ${thread}

## 4. ${BASE_MD_SECTION_TITLES[3]}
${ngLines.join("\n")}`;
}

/** Enforces exactly one ordered `## 1.` through `## 6.` heading. */
export function validateBaseMdStructure(content: string): void {
  const numbers = [...content.matchAll(BASE_MD_HEADING_PATTERN)].map(
    (match) => match[1],
  );
  if (numbers.join(",") !== "1,2,3,4,5,6") {
    throw new Error(
      "ベースmdは## 1.〜## 6.の見出しを順番どおり各1回含める必要があります。",
    );
  }
}

/** Creates version 1 without learned content in sections 5 and 6. */
export function generateInitialBaseMd(input: unknown): string {
  const content = `${buildSettingsSections(input)}

## 5. ${BASE_MD_SECTION_TITLES[4]}

## 6. ${BASE_MD_SECTION_TITLES[5]}
`;
  validateBaseMdStructure(content);
  return content;
}

/** Rebuilds sections 1-4 while preserving the existing 5-6 byte-for-byte. */
export function rebuildSettingsSections(
  existingContent: string,
  input: unknown,
): string {
  validateBaseMdStructure(existingContent);
  const sectionFive = /^## 5\.[^\n]*$/m.exec(existingContent);
  if (sectionFive?.index === undefined) {
    throw new Error("ベースmdのセクション5を特定できません。");
  }
  const rebuilt = `${buildSettingsSections(input)}\n\n${existingContent.slice(
    sectionFive.index,
  )}`;
  validateBaseMdStructure(rebuilt);
  return rebuilt;
}

export function baseMdSettingsDiffer(
  existingContent: string,
  input: unknown,
): boolean {
  return rebuildSettingsSections(existingContent, input) !== existingContent;
}
