import { describe, expect, it } from "vitest";

import {
  POST_PATTERN_OPTIONS,
  QUOTE_PATTERN_OPTION,
} from "./post-patterns";
import { GENERATION_MAX_POSTS } from "./thread-limits";

/**
 * 画面のパターン説明が**実際に作られるポスト数と一致している**ことを固定する（T-M8-33）。
 *
 * 2026-08-03、画面は P-1「4〜6ポスト」と説明していたが、生成時の上限は4だった。
 * 説明は「押す前に何が作られるか分かる」ためにあるので、実際と違えば逆に害になる。
 * 上限を変えたらこのテストが落ちるので、説明の直し忘れに気付ける。
 */
describe("パターン説明のポスト数", () => {
  const all = [...POST_PATTERN_OPTIONS, QUOTE_PATTERN_OPTION];

  it("すべてのパターンにポスト数の目安が書かれている", () => {
    for (const option of all) {
      expect(option.description, option.id).toMatch(/ポスト）/);
    }
  });

  it("説明に書かれた上端が `GENERATION_MAX_POSTS` と一致する", () => {
    for (const option of all) {
      const match = /(?:(\d+)〜)?(\d+)ポスト）/.exec(option.description);
      expect(match, `${option.id} の説明からポスト数を読み取れる`).not.toBeNull();
      const upper = Number((match as RegExpExecArray)[2]);
      expect(upper, `${option.id} の上端`).toBe(GENERATION_MAX_POSTS[option.id]);
    }
  });

  it("下端は1以上かつ上端以下", () => {
    for (const option of all) {
      const match = /(?:(\d+)〜)?(\d+)ポスト）/.exec(option.description) as RegExpExecArray;
      const lower = match[1] ? Number(match[1]) : Number(match[2]);
      expect(lower, `${option.id} の下端`).toBeGreaterThanOrEqual(1);
      expect(lower).toBeLessThanOrEqual(Number(match[2]));
    }
  });
});
