import { z } from "zod";

import { firstAuthoredIssueMessage, parseUserInput } from "@/lib/validation/user-input";

export const AI_KEY_PROVIDERS = ["anthropic", "openai", "google"] as const;
export type AiKeyProvider = (typeof AI_KEY_PROVIDERS)[number];
export type XClientType = "public" | "confidential";

/**
 * 画面とサーバー検証で同じ最小長を使う（T-M8-46）。以前は画面の `disabled` に `16` が
 * 直書きされていて、**16文字という条件が画面のどこにも書かれていなかった**（保存ボタンが
 * 薄いだけで、何を入れれば押せるのか分からない）。
 */
export const AI_SECRET_MIN_LENGTH = 16;
/** Client ID の最小長。同上。 */
export const X_CLIENT_ID_MIN_LENGTH = 5;
/** Client Secret の最小長。同上。 */
export const X_CLIENT_SECRET_MIN_LENGTH = 8;

/**
 * 上限と使える文字（T-M8-84）。**画面はこれを写経せず、同じスキーマを通して判定する**
 * （`xApiKeySaveBlocker`）。以前は画面が長さの下限しか見ておらず、`bad id` のような値や
 * 上限超えでも保存ボタンが押せて、サーバーに弾かれて初めて理由が分かった。
 */
export const AI_SECRET_MAX_LENGTH = 512;
export const X_CLIENT_ID_MAX_LENGTH = 200;
export const X_CLIENT_SECRET_MAX_LENGTH = 512;
export const X_CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/** 入力された値の長さ（zod v4 は trim 済みの値を渡す）。 */
const lengthOf = (input: unknown): number => String(input ?? "").length;

const secretValue = z
  .string()
  .trim()
  .min(AI_SECRET_MIN_LENGTH, {
    error: (iss) =>
      lengthOf(iss.input) === 0
        ? "APIキーを入力すると保存できます。"
        : `APIキーは${AI_SECRET_MIN_LENGTH}文字以上です（いま${lengthOf(iss.input)}文字）。`,
  })
  .max(AI_SECRET_MAX_LENGTH, {
    error: (iss) =>
      `APIキーが長すぎます（${AI_SECRET_MAX_LENGTH}文字以内・いま${lengthOf(iss.input)}文字）。`,
  })
  .regex(/^\S+$/, "空白を含まない値を入力してください。");

export const saveAiApiKeySchema = z.object({
  api_key: secretValue,
  provider: z.enum(AI_KEY_PROVIDERS),
});

export const saveXApiKeySchema = z
  .object({
    client_id: z
      .string()
      .trim()
      .min(X_CLIENT_ID_MIN_LENGTH, {
        error: (iss) =>
          lengthOf(iss.input) === 0
            ? "Client IDを入力すると保存できます。"
            : `Client IDは${X_CLIENT_ID_MIN_LENGTH}文字以上です（いま${lengthOf(iss.input)}文字）。`,
      })
      .max(X_CLIENT_ID_MAX_LENGTH, {
        error: (iss) =>
          `Client IDが長すぎます（${X_CLIENT_ID_MAX_LENGTH}文字以内・いま${lengthOf(iss.input)}文字）。`,
      })
      .regex(
        X_CLIENT_ID_PATTERN,
        "Client IDは英数字・ハイフン・アンダースコアで入力してください。",
      ),
    client_secret: z
      .string()
      .trim()
      .max(X_CLIENT_SECRET_MAX_LENGTH, {
        error: (iss) =>
          `Client Secretが長すぎます（${X_CLIENT_SECRET_MAX_LENGTH}文字以内・いま${lengthOf(iss.input)}文字）。`,
      })
      .nullable()
      .optional(),
    client_type: z.enum(["public", "confidential"]),
  })
  .superRefine((value, context) => {
    if (
      value.client_type === "confidential" &&
      (!value.client_secret || value.client_secret.length < X_CLIENT_SECRET_MIN_LENGTH)
    ) {
      context.addIssue({
        code: "custom",
        // 「Confidential client」は利用者が答えられない内部用語（要件06 §8・T-M8-62）。
        message: `Client Secretは${X_CLIENT_SECRET_MIN_LENGTH}文字以上です（いま${value.client_secret?.length ?? 0}文字）。`,
        path: ["client_secret"],
      });
    }
    if (value.client_type === "public" && value.client_secret) {
      context.addIssue({
        code: "custom",
        message: "Public clientではClient Secretを保存しません。",
        path: ["client_secret"],
      });
    }
  });

export type SaveAiApiKeyInput = z.infer<typeof saveAiApiKeySchema>;
export type SaveXApiKeyInput = z.infer<typeof saveXApiKeySchema>;

export interface XAppCredentials {
  clientId: string;
  clientSecret: string | null;
  clientType: XClientType;
}

const xAppCredentialsSchema = z.object({
  clientId: z.string(),
  clientSecret: z.string().nullable(),
  clientType: z.enum(["public", "confidential"]),
});

export function serializeXAppCredentials(input: SaveXApiKeyInput): string {
  return JSON.stringify({
    clientId: input.client_id,
    clientSecret: input.client_secret || null,
    clientType: input.client_type,
  } satisfies XAppCredentials);
}

export function parseXAppCredentials(serialized: string): XAppCredentials {
  return xAppCredentialsSchema.parse(JSON.parse(serialized));
}

export function lastFour(value: string): string {
  return value.slice(-4);
}

/**
 * 画面の「保存ボタンを押せるか」を**サーバー検証と同じスキーマ**で決める（T-M8-84）。
 *
 * 以前は画面が条件を写経しており（長さの下限だけ）、文字種と上限を見ていなかった。
 * そのため `bad id` のような値でもボタンが押せ、押してからサーバーに弾かれていた。
 * **写経をやめて同じスキーマを通す**ので、条件が増えても画面側の追従漏れが起きない。
 *
 * 戻り値は「押せない理由」（押せるなら null）。文言の正本はスキーマ側なので画面は二重に持たない。
 */
function blockerFor<T>(schema: z.ZodType<T>, payload: unknown): string | null {
  const parsed = parseUserInput(schema, payload);
  if (parsed.success) return null;
  return firstAuthoredIssueMessage(parsed.error) ?? "入力内容を確認してください。";
}

/**
 * 画面の入力からサーバーへ送る形を作る。
 * Secret が空なら public client として送る（種別は利用者に選ばせない・T-M8-62）。
 */
export function xApiKeySavePayload(fields: {
  clientId: string;
  clientSecret: string;
}): SaveXApiKeyInput {
  const secret = fields.clientSecret.trim();
  return {
    client_id: fields.clientId.trim(),
    client_secret: secret.length > 0 ? secret : null,
    client_type: secret.length > 0 ? "confidential" : "public",
  };
}

export function xApiKeySaveBlocker(fields: {
  clientId: string;
  clientSecret: string;
}): string | null {
  return blockerFor(saveXApiKeySchema, xApiKeySavePayload(fields));
}

export function aiApiKeySavePayload(fields: {
  provider: AiKeyProvider;
  apiKey: string;
}): SaveAiApiKeyInput {
  return { api_key: fields.apiKey.trim(), provider: fields.provider };
}

export function aiApiKeySaveBlocker(fields: {
  provider: AiKeyProvider;
  apiKey: string;
}): string | null {
  return blockerFor(saveAiApiKeySchema, aiApiKeySavePayload(fields));
}
