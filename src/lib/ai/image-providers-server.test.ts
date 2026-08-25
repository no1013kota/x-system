import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/pool", () => ({ getPool: () => ({ query: async () => ({ rows: [] }) }) }));
vi.mock("@/lib/env", () => ({
  env: {
    OPENAI_API_KEY: "sk-test",
    OPENAI_IMAGE_MODEL: "gpt-image-1",
    GEMINI_API_KEY: "",
    GEMINI_IMAGE_MODEL: "",
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

  it("運営キー系（premium/expert）はキー登録が無くても、鍵とモデルが揃った provider を返す", () => {
    // env は openai だけ揃えてある（google はモデル未設定）。
    expect(imageProvidersFor("premium", [])).toEqual(["openai"]);
    expect(imageProvidersFor("expert", [])).toEqual(["openai"]);
  });

  it("plan が未設定ならBYOK扱い（運営キーを勝手に使わせない）", () => {
    expect(imageProvidersFor(null, [])).toEqual([]);
  });
});
