import { describe, expect, it } from "vitest";

import { AppError } from "@/lib/observability/errors";

import { readSingleRow } from "./single-row";

/**
 * 「行が無い」と「読めなかった」が別の結果になることを固定する（T-M8-158）。
 * ここが同じ値へ潰れると、App Shellは全バナーが消えた画面を、設定画面は
 * 「Xアカウントを選択してください」の空状態を、どちらも黙って出す。
 */
describe("readSingleRow", () => {
  it("returns the row when the read succeeded", () => {
    expect(readSingleRow({ data: { id: "a" }, error: null }, "test")).toEqual({
      id: "a",
    });
  });

  it("returns null when the read succeeded but no row matched (a normal empty)", () => {
    expect(readSingleRow({ data: null, error: null }, "test")).toBeNull();
  });

  it("throws when the read failed, instead of collapsing it into the empty case", () => {
    const error = { code: "PGRST301", message: "JWT expired" };

    expect(() => readSingleRow({ data: null, error }, "settings x_account")).toThrow(
      AppError,
    );
  });

  it("keeps the original PostgREST error as cause so it stays traceable", () => {
    // PostgrestError は Error インスタンスではない素のオブジェクト。そのまま throw すると
    // stack が無く記録先で追えないため、AppError で包んで cause に残す。
    const error = { code: "57014", message: "canceling statement due to timeout" };

    try {
      readSingleRow({ data: null, error }, "app-shell profile");
      expect.unreachable("readSingleRow should have thrown");
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(AppError);
      expect((thrown as AppError).code).toBe("internal_error");
      expect((thrown as AppError).cause).toBe(error);
      expect((thrown as AppError).message).toContain("app-shell profile");
    }
  });
});
