import { z } from "zod";

export const AI_KEY_PROVIDERS = ["anthropic", "openai", "google"] as const;
export type AiKeyProvider = (typeof AI_KEY_PROVIDERS)[number];
export type XClientType = "public" | "confidential";

const secretValue = z
  .string()
  .trim()
  .min(16, "APIキーを確認してください。")
  .max(512)
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
      .min(5, "Client IDを確認してください。")
      .max(200)
      .regex(
        /^[A-Za-z0-9_-]+$/,
        "Client IDは英数字・ハイフン・アンダースコアで入力してください。",
      ),
    client_secret: z.string().trim().max(512).nullable().optional(),
    client_type: z.enum(["public", "confidential"]),
  })
  .superRefine((value, context) => {
    if (
      value.client_type === "confidential" &&
      (!value.client_secret || value.client_secret.length < 8)
    ) {
      context.addIssue({
        code: "custom",
        message: "Confidential clientではClient Secretが必要です。",
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
