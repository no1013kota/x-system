import type { AiKeyProvider } from "./api-keys";

export type DeletableApiKeyProvider = "x" | AiKeyProvider;

export interface XApiKeyDeletionTarget {
  credentialsCiphertext: string | null;
  tokenCiphertexts: string[];
}

export interface ApiKeyDeletionDependencies {
  decrypt(ciphertext: string): string;
  loadX(): Promise<XApiKeyDeletionTarget>;
  readXClientId(credentialsCiphertext: string): string;
  remove(input: { expectedXCiphertext?: string | null }): Promise<void>;
  revoke(input: { clientId: string; token: string }): Promise<void>;
}

/**
 * APIキーの即時削除を調停する純粋層。Xの復号・revokeはbest effortで、どのtokenが
 * 失敗してもDB削除を止めない。DB更新側は読み出したX資格情報のciphertextを再確認する。
 */
export async function deleteStoredApiKey(
  provider: DeletableApiKeyProvider,
  deps: ApiKeyDeletionDependencies,
): Promise<{ deleted: true; provider: DeletableApiKeyProvider }> {
  if (provider !== "x") {
    await deps.remove({});
    return { deleted: true, provider };
  }

  const target = await deps.loadX();
  let clientId: string | null = null;
  if (target.credentialsCiphertext) {
    try {
      clientId = deps.readXClientId(target.credentialsCiphertext);
    } catch {
      clientId = null;
    }
  }

  if (clientId) {
    const tokens = new Set<string>();
    for (const ciphertext of target.tokenCiphertexts) {
      try {
        tokens.add(deps.decrypt(ciphertext));
      } catch {
        // A broken stored token must not block deleting the leaked App key.
      }
    }
    for (const token of tokens) {
      try {
        await deps.revoke({ clientId, token });
      } catch {
        // X revoke is intentionally best effort; local deletion remains authoritative.
      }
    }
  }

  await deps.remove({ expectedXCiphertext: target.credentialsCiphertext });
  return { deleted: true, provider };
}
