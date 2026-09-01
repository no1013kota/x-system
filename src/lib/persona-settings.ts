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
  // 文末は自由入力（T-M8-395・運営者の指示 2026-09-01。旧 polite/assertive のenumは廃止し、
  // 既存値はmigrationで「です・ます調」「断定調」へ置換した）。
  sentence_style: "です・ます調",
  thread_numbering: true,
} as const;

/** スレッド量や文章量（アカウント.md §4）の既定。空は「指定なし＝投稿の型の設定に従う」。 */
export const DEFAULT_VOLUME_SETTINGS = { free_text: "" } as const;

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
    /*
      スレッド量や文章量（T-M8-395・運営者の指示 2026-09-01）。自由入力1欄。
      旧データにはキーが無いため default で受ける（migration不要の後方互換）。
    */
    volume: z
      .object({
        free_text: z
          .string()
          .trim()
          .max(500, "スレッド量や文章量は500字以内で入力してください。")
          .default(""),
      })
      .default({ free_text: "" }),
    tone: z
      .object({
        emoji_max_per_post: z.number().int().min(0),
        emoji_policy: z.enum(["none", "limited"]),
        first_person: requiredText,
        hashtags_max: z.number().int().min(0),
        sentence_style: requiredText.pipe(
          z.string().max(60, "文末の指定は60字以内で入力してください。"),
        ),
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

const BASE_MD_HEADING_PATTERN = /^## ([1-5])\.[^\n]*$/gm;
/**
 * アカウント.mdの見出し（T-M8-395・運営者の指示 2026-09-01で5項目へ再編。
 * 旧「参考にする型」は廃止——参考アカウント分析（設定＞アカウント設定）と
 * パターンごとの参考投稿（T-M8-397）がその役割を継いだ）。
 *
 * **5セクションすべて設定フォームから機械生成する。** 手書きセクションは無くなった。
 * 旧形式の保存済みmd（見出し名が違う）はそのまま有効で、次の保存時に新形式で作り直される。
 */
export const BASE_MD_SECTION_TITLES = [
  "ペルソナ",
  "テーマ",
  "トーン",
  "スレッド量や文章量",
  "NG設定",
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
  // 文末は自由入力の値をそのまま載せる（T-M8-395。旧enum値はmigrationで日本語へ置換済み）。
  const sentence = settings.tone.sentence_style;
  const ngLines = [
    ...settings.ng.topics.map((topic) => `- ${topic}には触れない`),
    ...(settings.ng.words.length > 0
      ? ["- 別管理のNGワードリストに一致する表現を使用しない"]
      : []),
    "- 特定銘柄・商品の売買や購入を推奨しない",
    "- 競合・他者への攻撃的な言及をしない",
    ...settings.ng.rules.map((rule) => `- ${rule}`),
  ];

  return `# 発信定義書（アカウント.md）
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
${settings.volume.free_text.trim() || "指定なし（投稿の型の設定に従う）"}

## 5. ${BASE_MD_SECTION_TITLES[4]}
${ngLines.join("\n")}`;
}



/** Enforces exactly one ordered `## 1.` through `## 5.` heading. */
export function validateBaseMdStructure(content: string): void {
  const numbers = [...content.matchAll(BASE_MD_HEADING_PATTERN)].map(
    (match) => match[1],
  );
  if (numbers.join(",") !== "1,2,3,4,5") {
    throw new Error(
      "アカウント.mdは## 1.〜## 5.の見出しを順番どおり各1回含める必要があります。",
    );
  }
}

/**
 * Extracts a single `## N.` section body (heading excluded) from a base_md
 * document. Returns "" when the section is absent. Used by GEN-IMG, which reads
 * only section 3 (トーン&マナー) for the image prompt (プロンプト設計書 §4.2).
 */
export function extractBaseMdSection(content: string, section: number): string {
  const start = new RegExp(`^## ${section}\\.[^\\n]*$`, "m").exec(content);
  if (start?.index === undefined) return "";
  const rest = content.slice(start.index + start[0].length);
  const next = /^## [1-5]\.[^\n]*$/m.exec(rest);
  const body = next?.index === undefined ? rest : rest.slice(0, next.index);
  return body.trim();
}

/**
 * 自由入力でアカウント.mdを新しく作るときの雛形（T-M8-350・運営者の指示 2026-08-28）。
 *
 * **6見出しの構造は必須**（生成が節ごとに読む）なので、白紙から書かせると
 * 「保存できない理由が見出しの形」という、書いてみるまで分からない失敗になる。
 * 見出しだけ用意して中身を空にする——何を書く場所かは見出しが言う。
 */
export const BLANK_BASE_MD_TEMPLATE = BASE_MD_SECTION_TITLES.map(
  (title, index) => `## ${index + 1}. ${title}\n`,
).join("\n");

/** 初版のアカウント.md（5セクションすべて設定から生成・T-M8-395）。 */
export function generateInitialBaseMd(input: unknown): string {
  const content = buildSettingsSections(input);
  validateBaseMdStructure(content);
  return content;
}

/**
 * 設定からアカウント.md全文を作り直す（T-M8-395で全セクション生成へ）。
 *
 * 旧形式（`## 5. 参考にする型` が手書き）の内容は**保存し直した時点で新形式に置き換わる**。
 * 旧「参考にする型」の役割は参考アカウント分析とパターン別の参考投稿が継いだため、
 * 引き継ぎはしない（2026-09-01時点で本番の該当データは期限切れアカウントの1件のみ）。
 */
export function rebuildSettingsSections(
  existingContent: string,
  input: unknown,
): string {
  validateBaseMdStructure(existingContent);
  const rebuilt = buildSettingsSections(input);
  validateBaseMdStructure(rebuilt);
  return rebuilt;
}

export function baseMdSettingsDiffer(
  existingContent: string,
  input: unknown,
): boolean {
  return rebuildSettingsSections(existingContent, input) !== existingContent;
}




