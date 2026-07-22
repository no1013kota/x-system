import "server-only";

import { decrypt } from "@/lib/crypto";
import { withTransaction } from "@/lib/db/pool";

import type { VerifiableApiKeyProvider } from "./api-key-verification";
import { verifyStoredApiKey } from "./api-key-verification";
import {
  applyApiKeyVerification,
  loadApiKeyVerificationTarget,
} from "./api-key-verification-store";
import { verifyProviderApiKey } from "./api-key-verifiers-server";

export function verifyApiKeyForUser(input: {
  provider: VerifiableApiKeyProvider;
  userId: string;
}) {
  return verifyStoredApiKey({
    decrypt,
    load: () =>
      withTransaction((client) => loadApiKeyVerificationTarget(client, input)),
    persist: ({ ciphertext, status }) =>
      withTransaction((client) =>
        applyApiKeyVerification(client, {
          expectedCiphertext: ciphertext,
          now: new Date(),
          provider: input.provider as Exclude<VerifiableApiKeyProvider, "x">,
          status,
          userId: input.userId,
        }),
      ),
    verify: verifyProviderApiKey,
  });
}
