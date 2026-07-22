import "server-only";

import { decrypt, encrypt } from "@/lib/crypto";
import { withTransaction } from "@/lib/db/pool";

import type { AiKeyProvider, SaveXApiKeyInput } from "./api-keys";
import {
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
