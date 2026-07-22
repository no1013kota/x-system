import "server-only";

import { decrypt } from "@/lib/crypto";
import { withTransaction } from "@/lib/db/pool";
import { parseXAppCredentials } from "@/lib/api-keys";
import { revokeOAuthToken, type FetchLike } from "@/lib/x/oauth";

import {
  deleteStoredApiKey,
  type DeletableApiKeyProvider,
} from "./api-key-deletion";
import {
  deleteApiKeyRecord,
  loadXApiKeyDeletionTarget,
} from "./api-key-deletion-store";

const xFetch: FetchLike = (url, init) => fetch(url, init);

export function deleteApiKeyForUser(input: {
  provider: DeletableApiKeyProvider;
  userId: string;
}) {
  return deleteStoredApiKey(input.provider, {
    decrypt,
    loadX: () =>
      withTransaction((client) =>
        loadXApiKeyDeletionTarget(client, input.userId),
      ),
    readXClientId: (ciphertext) =>
      parseXAppCredentials(decrypt(ciphertext)).clientId,
    remove: ({ expectedXCiphertext }) =>
      withTransaction((client) =>
        deleteApiKeyRecord(client, {
          expectedXCiphertext,
          provider: input.provider,
          userId: input.userId,
        }),
      ),
    revoke: ({ clientId, token }) =>
      revokeOAuthToken({ clientId }, { token }, { fetch: xFetch }),
  });
}
