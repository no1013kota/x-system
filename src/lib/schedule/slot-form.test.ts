import { describe, expect, it } from "vitest";

import { validateSlotForm } from "./slot-form";

/**
 * 保存前チェック（R38）。
 *
 * サーバー側の正本（`schedule-slots.ts`）を `.tsx` が手で写しており、壊しても
 * E2Eで踏んだ経路以外は緑のまま通った。T-M8-37 の「どの項目が悪いか分からないエラーを
 * 出さない」という要求が、ここまで機械検査に載っていなかった。
 */

const base = { weekdays: [1], theme: "ai", mode: "draft", pattern_id: "p-1" };

describe("validateSlotForm", () => {
  it("曜日が0件なら止める", () => {
    expect(validateSlotForm({ ...base, weekdays: [] }, { consented: true })).toEqual({
      error: "曜日を1つ以上選択してください。",
      needsConsent: false,
    });
  });

  it("パターン未選択（追加中）なら止める（T-M8-203）", () => {
    expect(validateSlotForm({ ...base, pattern_id: "" }, { consented: true }).error).toMatch(
      /パターンを選択してください/,
    );
  });

  it("テーマ未選択なら止める（どの項目が悪いか分かる文言で）", () => {
    expect(validateSlotForm({ ...base, theme: null }, { consented: true })).toEqual({
      error: "テーマを選択してください。",
      needsConsent: false,
    });
  });

  it("auto かつ未同意なら同意を求める（エラーにはしない）", () => {
    expect(validateSlotForm({ ...base, mode: "auto" }, { consented: false })).toEqual({
      error: null,
      needsConsent: true,
    });
  });

  it("auto でも同意済みならそのまま保存できる", () => {
    expect(validateSlotForm({ ...base, mode: "auto" }, { consented: true })).toEqual({
      error: null,
      needsConsent: false,
    });
  });

  it("下書きのみなら同意は要らない", () => {
    expect(validateSlotForm(base, { consented: false })).toEqual({
      error: null,
      needsConsent: false,
    });
  });

  /**
   * **順序を変えない。** 曜日→テーマ→同意の順に見ることで、利用者は上から順に埋めれば
   * 必ず保存できる。同意を先に出すと、直した後にまた別のエラーが出る。
   */
  it("複数の不足があれば曜日を先に伝える", () => {
    const verdict = validateSlotForm(
      { weekdays: [], theme: null, mode: "auto", pattern_id: "" },
      { consented: false },
    );
    expect(verdict.error).toBe("曜日を1つ以上選択してください。");
    expect(verdict.needsConsent).toBe(false);
  });
});
