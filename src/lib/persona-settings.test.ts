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
    volume: { free_text: "" },
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
      // 文末は自由入力（T-M8-395）。既定は従来の丁寧文体に相当する日本語。
      sentence_style: "です・ます調",
      thread_numbering: true,
    });
  });

  it("文末は自由入力を受け、volumeはキーが無くても既定で埋まる（旧データ互換・T-M8-395）", () => {
    const legacy = {
      ...validSettings(),
      tone: { ...DEFAULT_TONE_SETTINGS, sentence_style: "言い切りと体言止め中心" },
    } as Record<string, unknown>;
    delete legacy.volume;
    const parsed = personaSettingsSchema.parse(legacy);
    expect(parsed.tone.sentence_style).toBe("言い切りと体言止め中心");
    expect(parsed.volume).toEqual({ free_text: "" });
  });
});

describe("base md generation", () => {
  it("creates the five headings exactly once in order", () => {
    const content = generateInitialBaseMd(validSettings());
    const headings = [...content.matchAll(/^## ([1-9])\./gm)].map(
      (match) => match[1],
    );
    expect(headings).toEqual(["1", "2", "3", "4", "5"]);
    expect(() => validateBaseMdStructure(content)).not.toThrow();
  });

  it("5項目（ペルソナ・テーマ・トーン・スレッド量や文章量・NG設定）を設定から生成する（T-M8-395）", () => {
    const content = generateInitialBaseMd(validSettings());
    expect(content).toContain("- 発信者: 中小企業向け業務改善コンサルタント");
    expect(content).toContain("- 主テーマ: 業務改善");
    expect(content).toContain("- 扱う範囲: AI、個人事業主向け");
    expect(content).toContain("- 文末: です・ます調");
    expect(content).toContain("## 4. スレッド量や文章量\n指定なし（投稿の型の設定に従う）");
    expect(content).toContain("## 5. NG設定");
  });

  it("スレッド量や文章量の入力はそのまま4章へ入る", () => {
    const input = validSettings();
    input.volume.free_text = "1ポストは3〜5行。スレッドは4ポストまで。";
    const content = generateInitialBaseMd(input);
    expect(content).toContain("## 4. スレッド量や文章量\n1ポストは3〜5行。スレッドは4ポストまで。");
  });

  it("rebuildは全5セクションを設定から作り直す（旧・手書き5章は引き継がない・T-M8-395）", () => {
    const current = generateInitialBaseMd(validSettings());
    const changed = validSettings();
    changed.persona.speaker = "更新後の発信者";
    const rebuilt = rebuildSettingsSections(current, changed);
    expect(rebuilt).toContain("- 発信者: 更新後の発信者");
    expect(rebuilt).toBe(generateInitialBaseMd(changed));
  });

  it("detects manual differences from the generated document", () => {
    const generated = generateInitialBaseMd(validSettings());
    expect(baseMdSettingsDiffer(generated, validSettings())).toBe(false);
    const manuallyEdited = generated.replace(
      "- 発信者: 中小企業向け業務改善コンサルタント",
      "- 発信者: 手動編集した内容",
    );
    expect(baseMdSettingsDiffer(manuallyEdited, validSettings())).toBe(true);
  });

  it.each([
    "## 1. a\n## 2. b\n## 3. c\n## 4. d",
    "## 1. a\n## 2. b\n## 2. duplicate\n## 3. c\n## 4. d\n## 5. e",
    "## 1. a\n## 3. c\n## 2. b\n## 4. d\n## 5. e",
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
