import "server-only";

import { decrypt, encrypt } from "@/lib/crypto";
import { withTransaction } from "@/lib/db/pool";

import type {
  AiKeyProvider,
  SaveXApiKeyInput,
  XAppCredentials,
} from "./api-keys";
import {
  readXAppCredentialsRecord,
  saveAiApiKeyRecord,
  saveXApiKeyRecord,
  type MaskedApiKey,
} from "./api-key-store";

export function saveXApiKeyForUser(
  input: SaveXApiKeyInput & { userId: string },
): Promise<MaskedApiKey> {
  return withTransaction((client) =>
    saveXApiKeyRecord(client, input, { decrypt, encrypt }),
  );
}

export function saveAiApiKeyForUser(input: {
  apiKey: string;
  provider: AiKeyProvider;
  userId: string;
}): Promise<MaskedApiKey> {
  return withTransaction((client) =>
    saveAiApiKeyRecord(client, input, { encrypt }),
  );
}

/** BYOK X app OAuth credentials (client_id/secret/type) for the OAuth start route. */
export function getXAppCredentialsForUser(
  userId: string,
): Promise<XAppCredentials | null> {
  return withTransaction((client) =>
    readXAppCredentialsRecord(client, userId, { decrypt, encrypt }),
  );
}
