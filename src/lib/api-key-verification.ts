import type { AiKeyProvider } from "./api-keys";
import { recordUnexpectedError } from "./observability/sentry";

export type VerifiableApiKeyProvider = "x" | AiKeyProvider;

export interface ApiKeyVerificationTarget {
  ciphertext: string;
  provider: VerifiableApiKeyProvider;
}

export interface ApiKeyVerificationResult {
  code?: "provider_error";
  provider: VerifiableApiKeyProvider;
  status: "invalid" | "unchecked" | "valid";
}

export interface ApiKeyVerificationDependencies {
  decrypt(ciphertext: string): string;
  load(): Promise<ApiKeyVerificationTarget>;
  persist(input: {
    ciphertext: string;
    status: "invalid" | "valid";
  }): Promise<void>;
  verify(provider: AiKeyProvider, apiKey: string): Promise<void>;
}

/** Provider errors are deliberately collapsed and never returned to callers. */
export async function verifyStoredApiKey(
  dependencies: ApiKeyVerificationDependencies,
): Promise<ApiKeyVerificationResult> {
  const target = await dependencies.load();
  if (target.provider === "x") {
    return { provider: "x", status: "unchecked" };
  }
  const apiKey = dependencies.decrypt(target.ciphertext);
  let status: "invalid" | "valid" = "valid";
  try {
    await dependencies.verify(target.provider, apiKey);
  } catch (error) {
    // provider が「キーが無効」と答えた場合も、自コードのバグ・接続失敗もここへ来る。
    // 利用者へは「貼り直してください」と案内するため、区別できるよう原因を記録する。
    recordUnexpectedError(error, { at: "api-key-verification", provider: target.provider });
    status = "invalid";
  }
  await dependencies.persist({ ciphertext: target.ciphertext, status });
  return {
    ...(status === "invalid" ? { code: "provider_error" as const } : {}),
    provider: target.provider,
    status,
  };
}
