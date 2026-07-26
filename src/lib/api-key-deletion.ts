import type { AiKeyProvider } from "./api-keys";
import { recordUnexpectedError } from "./observability/sentry";

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
    } catch (error) {
      // 復号できなくてもキー削除は進める。ただし clientId が無いと revoke が打てないため記録する。
      recordUnexpectedError(error, { at: "api-key-deletion:client-id" });
      clientId = null;
    }
  }

  if (clientId) {
    const tokens = new Set<string>();
    for (const ciphertext of target.tokenCiphertexts) {
      try {
        tokens.add(deps.decrypt(ciphertext));
      } catch (error) {
        // A broken stored token must not block deleting the leaked App key.
        // ただし復号失敗は revoke のスキップを意味するため記録する。
        recordUnexpectedError(error, { at: "api-key-deletion:decrypt-token" });
      }
    }
    for (const token of tokens) {
      try {
        await deps.revoke({ clientId, token });
      } catch (error) {
        // X revoke is intentionally best effort; local deletion remains authoritative.
        // X 側にtokenが残るため、失敗の事実だけは残す。
        recordUnexpectedError(error, { at: "api-key-deletion:revoke" });
      }
    }
  }

  await deps.remove({ expectedXCiphertext: target.credentialsCiphertext });
  return { deleted: true, provider };
}
