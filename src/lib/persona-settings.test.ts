import { describe, expect, it } from "vitest";

import {
  DEFAULT_TONE_SETTINGS,
  baseMdSettingsDiffer,
  extractBaseMdSection,
  generateInitialBaseMd,
  personaSettingsSchema,
  rebuildSettingsSections,
  validateBaseMdStructure,
} from "./persona-settings";

function validSettings() {
  return {
    ng: { rules: [], topics: [], words: [] },
    persona: {
      audience: "従業員30名以下の経営者",
      speaker: "中小企業向け業務改善コンサルタント",
      value: "明日の実務で使える効率化",
    },
    themes: {
      free_text: "個人事業主向け",
      primary: ["business_ops"],
      secondary: ["ai"],
    },
    tone: { ...DEFAULT_TONE_SETTINGS },
  };
}

describe("personaSettingsSchema", () => {
  it("accepts all required settings while allowing empty NG lists", () => {
    expect(personaSettingsSchema.parse(validSettings()).ng).toEqual({
      rules: [],
      topics: [],
      words: [],
    });
  });

  it.each(["speaker", "audience", "value"])(
    "rejects a missing persona.%s",
    (field) => {
      const input = validSettings();
      input.persona[field as keyof typeof input.persona] = "";
      expect(() => personaSettingsSchema.parse(input)).toThrow();
    },
  );

  it("requires at least one primary theme", () => {
    const input = validSettings();
    input.themes.primary = [];
    expect(() => personaSettingsSchema.parse(input)).toThrow();
  });

  it("rejects unknown and duplicate theme selections", () => {
    const unknown = validSettings();
    unknown.themes.primary = ["unknown"];
    expect(() => personaSettingsSchema.parse(unknown)).toThrow();

    const duplicate = validSettings();
    duplicate.themes.secondary = ["business_ops"];
    expect(() => personaSettingsSchema.parse(duplicate)).toThrow();
  });

  it("keeps the required tone defaults", () => {
    expect(DEFAULT_TONE_SETTINGS).toEqual({
      emoji_max_per_post: 1,
      emoji_policy: "limited",
      first_person: "私",
      hashtags_max: 0,
      sentence_style: "polite",
      thread_numbering: true,
    });
  });
});

describe("base md generation", () => {
  it("creates the six headings exactly once in order", () => {
    const content = generateInitialBaseMd(validSettings());
    const headings = [...content.matchAll(/^## ([1-6])\./gm)].map(
      (match) => match[1],
    );
    expect(headings).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(() => validateBaseMdStructure(content)).not.toThrow();
  });

  it("writes settings into sections 1-4 and leaves 5-6 empty", () => {
    const content = generateInitialBaseMd(validSettings());
    expect(content).toContain("- 発信者: 中小企業向け業務改善コンサルタント");
    expect(content).toContain("- 主テーマ: 業務改善");
    expect(content).toContain("- 扱う範囲: AI、個人事業主向け");
    expect(content).toContain("- 文末: です・ます調");
    expect(content).toMatch(/## 5\. 文体・自分らしさ\n\n## 6\. 参考にする型\n$/);
  });

  it("rebuilds only sections 1-4 and preserves learned sections 5-6", () => {
    const current = generateInitialBaseMd(validSettings()).replace(
      "## 5. 文体・自分らしさ\n\n## 6. 参考にする型",
      "## 5. 文体・自分らしさ\n- 学習済みの文体\n\n## 6. 参考にする型\n- @example: 構成",
    );
    const sectionFive = current.slice(current.indexOf("## 5."));
    const changed = validSettings();
    changed.persona.speaker = "更新後の発信者";

    const rebuilt = rebuildSettingsSections(current, changed);
    expect(rebuilt).toContain("- 発信者: 更新後の発信者");
    expect(rebuilt.slice(rebuilt.indexOf("## 5."))).toBe(sectionFive);
  });

  it("detects manual differences in sections 1-4 but ignores learned content", () => {
    const generated = generateInitialBaseMd(validSettings());
    expect(baseMdSettingsDiffer(generated, validSettings())).toBe(false);
    const learned = generated.replace(
      "## 5. 文体・自分らしさ",
      "## 5. 文体・自分らしさ\n- 学習済み",
    );
    expect(baseMdSettingsDiffer(learned, validSettings())).toBe(false);
    const manuallyEdited = generated.replace(
      "- 発信者: 中小企業向け業務改善コンサルタント",
      "- 発信者: 手動編集した内容",
    );
    expect(baseMdSettingsDiffer(manuallyEdited, validSettings())).toBe(true);
  });

  it.each([
    "## 1. a\n## 2. b\n## 3. c\n## 4. d\n## 5. e",
    "## 1. a\n## 2. b\n## 2. duplicate\n## 3. c\n## 4. d\n## 5. e\n## 6. f",
    "## 1. a\n## 3. c\n## 2. b\n## 4. d\n## 5. e\n## 6. f",
  ])("rejects a missing, duplicate, or out-of-order structure", (content) => {
    expect(() => validateBaseMdStructure(content)).toThrow(/順番どおり各1回/);
  });
});

describe("extractBaseMdSection", () => {
  const md = `## 1. ペルソナ
- 発信者: X
## 2. 発信テーマ
- 主テーマ: Y
## 3. トーン&マナー
- 文末: 断定調
- 一人称: 私
## 4. やらないこと
- Z`;

  it("returns a section body without its heading", () => {
    expect(extractBaseMdSection(md, 3)).toBe("- 文末: 断定調\n- 一人称: 私");
  });

  it("returns the last section up to end of content", () => {
    expect(extractBaseMdSection(md, 4)).toBe("- Z");
  });

  it("returns empty string for an absent section", () => {
    expect(extractBaseMdSection(md, 6)).toBe("");
  });
});
