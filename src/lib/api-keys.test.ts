import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parseUserInput } from "@/lib/validation/user-input";
import { describe, expect, it } from "vitest";

import {
  X_CLIENT_ID_MAX_LENGTH,
  X_CLIENT_SECRET_MAX_LENGTH,
  aiApiKeySaveBlocker,
  lastFour,
  parseXAppCredentials,
  saveAiApiKeySchema,
  saveXApiKeySchema,
  serializeXAppCredentials,
  xApiKeySaveBlocker,
  xApiKeySavePayload,
} from "./api-keys";

describe("API key input schemas", () => {
  it("accepts public and confidential X clients with the required fields", () => {
    expect(
      saveXApiKeySchema.parse({
        client_id: "public-client_123",
        client_type: "public",
      }),
    ).toMatchObject({ client_id: "public-client_123" });
    expect(
      saveXApiKeySchema.parse({
        client_id: "confidential-client_123",
        client_secret: "secret-value",
        client_type: "confidential",
      }),
    ).toMatchObject({ client_secret: "secret-value" });
  });

  it("rejects invalid client IDs and client type/secret mismatches", () => {
    expect(() =>
      saveXApiKeySchema.parse({ client_id: "bad id", client_type: "public" }),
    ).toThrow();
    expect(() =>
      saveXApiKeySchema.parse({
        client_id: "confidential-client",
        client_type: "confidential",
      }),
    ).toThrow(/Client Secret/);
    expect(() =>
      saveXApiKeySchema.parse({
        client_id: "public-client",
        client_secret: "must-not-store",
        client_type: "public",
      }),
    ).toThrow(/Public client/);
  });

  it.each(["anthropic", "openai", "google"])(
    "accepts a non-whitespace %s key",
    (provider) => {
      expect(
        saveAiApiKeySchema.parse({
          api_key: "secret-key-1234567890",
          provider,
        }),
      ).toMatchObject({ provider });
    },
  );

  it("rejects an unsupported provider, short key, and whitespace", () => {
    for (const input of [
      { api_key: "secret-key-1234567890", provider: "x" },
      { api_key: "short", provider: "openai" },
      { api_key: "secret key 1234567890", provider: "google" },
    ]) {
      expect(() => saveAiApiKeySchema.parse(input)).toThrow();
    }
  });
});

describe("X App credentials serialization", () => {
  it("round-trips the field names used inside ciphertext", () => {
    const serialized = serializeXAppCredentials({
      client_id: "client-123456",
      client_secret: "secret-123456",
      client_type: "confidential",
    });
    expect(parseXAppCredentials(serialized)).toEqual({
      clientId: "client-123456",
      clientSecret: "secret-123456",
      clientType: "confidential",
    });
  });

  it("returns only the final four characters for display", () => {
    expect(lastFour("secret-123456")).toBe("3456");
  });
});

/**
 * 画面の保存可否がサーバー検証と一致すること（T-M8-84）。
 *
 * 以前は画面が条件を写経しており、**文字種と上限を見ていなかった**ため
 * `bad id` や上限超えでも保存ボタンが押せ、押してからサーバーに弾かれていた。
 * 写経をやめて同じスキーマを通す形にしたので、その等価性をここで固定する。
 */
describe("保存可否は画面とサーバーで一致する", () => {
  const CLIENT_IDS = [
    "",
    "abc",
    "abcde",
    "bad id",
    "日本語テスト",
    "ab d",
    "a".repeat(X_CLIENT_ID_MAX_LENGTH),
    "a".repeat(X_CLIENT_ID_MAX_LENGTH + 1),
    "  abcde  ",
  ];
  const SECRETS = ["", "   ", "　　", "short", "a".repeat(17), "a".repeat(X_CLIENT_SECRET_MAX_LENGTH + 1)];

  it("Xキー: 押せる条件と、送る値がスキーマを通るかが常に一致する", () => {
    for (const clientId of CLIENT_IDS) {
      for (const clientSecret of SECRETS) {
        const blocker = xApiKeySaveBlocker({ clientId, clientSecret });
        const parsed = parseUserInput(saveXApiKeySchema, xApiKeySavePayload({ clientId, clientSecret }));
        expect(
          blocker === null,
          `不一致: clientId=${JSON.stringify(clientId)} secret=${JSON.stringify(clientSecret)}`,
        ).toBe(parsed.success);
        if (blocker !== null) {
          expect(blocker.length, "押せない理由が空だと画面に何も出ない").toBeGreaterThan(0);
          expect(blocker, "内部の目印が画面へ出ている").not.toContain("__zod");
        }
      }
    }
  });

  it("Xキー: 種別は Secret の有無から決まる（利用者に選ばせない・T-M8-62）", () => {
    expect(xApiKeySavePayload({ clientId: "abcdef", clientSecret: "" })).toEqual({
      client_id: "abcdef",
      client_secret: null,
      client_type: "public",
    });
    expect(xApiKeySavePayload({ clientId: " abcdef ", clientSecret: " secret-value-1234 " })).toEqual({
      client_id: "abcdef",
      client_secret: "secret-value-1234",
      client_type: "confidential",
    });
  });

  it("押せない理由が具体的である（文字種・上限）", () => {
    expect(xApiKeySaveBlocker({ clientId: "bad id", clientSecret: "" })).toBe(
      "Client IDは英数字・ハイフン・アンダースコアで入力してください。",
    );
    expect(xApiKeySaveBlocker({ clientId: "a".repeat(201), clientSecret: "" })).toBe(
      "Client IDが長すぎます（200文字以内・いま201文字）。",
    );
    expect(xApiKeySaveBlocker({ clientId: "", clientSecret: "" })).toBe(
      "Client IDを入力すると保存できます。",
    );
    expect(xApiKeySaveBlocker({ clientId: "abc", clientSecret: "" })).toBe(
      "Client IDは5文字以上です（いま3文字）。",
    );
    expect(xApiKeySaveBlocker({ clientId: "abcdef", clientSecret: "short" })).toBe(
      "Client Secretは8文字以上です（いま5文字）。",
    );
  });

  it("AIキー: 空白入りや上限超えも押せない（以前は長さしか見ていなかった）", () => {
    expect(aiApiKeySaveBlocker({ apiKey: "secret key 1234567890", provider: "anthropic" })).toBe(
      "空白を含まない値を入力してください。",
    );
    expect(aiApiKeySaveBlocker({ apiKey: "a".repeat(513), provider: "anthropic" })).toBe(
      "APIキーが長すぎます（512文字以内・いま513文字）。",
    );
    expect(aiApiKeySaveBlocker({ apiKey: "short", provider: "anthropic" })).toBe(
      "APIキーは16文字以上です（いま5文字）。",
    );
    expect(aiApiKeySaveBlocker({ apiKey: "a".repeat(20), provider: "anthropic" })).toBeNull();
  });
});

/**
 * 画面が条件を写経していないこと（T-M8-84）。
 * ここが空振りすると、次に条件が増えたとき画面だけ古いまま気付けない。
 */
describe("画面はキーの条件を写経しない", () => {
  const SCREEN = fileURLToPath(new URL("../app/app/settings/api-key-settings.tsx", import.meta.url));

  it("走査対象が実在する（検査が空振りしていない）", () => {
    expect(readFileSync(SCREEN, "utf8").length).toBeGreaterThan(1000);
  });

  it("共有の判定関数を使っている", () => {
    const source = readFileSync(SCREEN, "utf8");
    expect(source).toContain("xApiKeySaveBlocker");
    expect(source).toContain("aiApiKeySaveBlocker");
  });

  it("長さ比較や文字種の正規表現を画面に持たない", () => {
    const source = readFileSync(SCREEN, "utf8");
    expect(source, "長さ比較は共有関数へ寄せる").not.toMatch(/\.length\s*[<>]=?\s*[A-Z_]*(MIN|MAX)_LENGTH/);
    expect(source, "文字種の判定は共有関数へ寄せる").not.toContain("A-Za-z0-9_-");
  });
});
