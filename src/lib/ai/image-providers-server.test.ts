import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/pool", () => ({ getPool: () => ({ query: async () => ({ rows: [] }) }) }));
/*
  **画像モデルのenvはわざと空にしてある**（T-M8-370）。既定はコード
  （`DEFAULT_IMAGE_MODELS`）が持つので、envが無くても provider は選べなければならない。
  ここに値を入れて検査すると、envを消した瞬間に画面から provider が消える不具合を
  見逃す（2026-08-29、Vercelから消えていて実際に起きた）。
*/
vi.mock("@/lib/env", () => ({
  env: {
    OPENAI_API_KEY: "sk-test",
    OPENAI_IMAGE_MODEL: undefined,
    GEMINI_API_KEY: "",
    GEMINI_IMAGE_MODEL: undefined,
  },
}));

const { imageProvidersFor } = await import("./image-providers-server");

/**
 * 画面が出す画像providerの一覧（T-M8-253で新設）。実行側の解決と判定基準を揃えるための
 * モジュールなのに、テストが1つも無かった（「画面では選べないのに実行はできる」食い違いを止める場所）。
 */
describe("imageProvidersFor", () => {
  it("BYOK（standard）は登録済みキーの provider をそのまま返す", () => {
    expect(imageProvidersFor("standard", [{ provider: "openai" }, { provider: "google" }])).toEqual([
      "openai",
      "google",
    ]);
    expect(imageProvidersFor("standard", []), "キーが無ければ選べない").toEqual([]);
  });

  it("運営キー系（premium/expert）はキー登録が無くても、運営キーのある provider を返す", () => {
    // env は openai の鍵だけ。**画像モデルは未設定でも選べる**（既定がコードにある）。
    expect(imageProvidersFor("premium", [])).toEqual(["openai"]);
    expect(imageProvidersFor("expert", [])).toEqual(["openai"]);
  });

  it("plan が未設定ならBYOK扱い（運営キーを勝手に使わせない）", () => {
    expect(imageProvidersFor(null, [])).toEqual([]);
  });
});
