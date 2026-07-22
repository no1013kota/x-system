import "server-only";

import { withTransaction } from "@/lib/db/pool";

import type {
  ApiKeyViewProvider,
  ApiKeyViewState,
} from "./api-key-view";

export function listApiKeyViewsForUser(userId: string): Promise<ApiKeyViewState[]> {
  return withTransaction(async (client) => {
    const result = await client.query<{
      display_hint: unknown;
      provider: ApiKeyViewProvider;
      status: ApiKeyViewState["status"];
      verified_at: Date | string | null;
    }>(
      `select provider::text as provider, display_hint, status::text as status,
              verified_at
         from user_api_keys
        where user_id = $1
        order by provider`,
      [userId],
    );
    return result.rows.map((key) => ({
      displayHint:
        key.display_hint &&
        typeof key.display_hint === "object" &&
        !Array.isArray(key.display_hint)
          ? (key.display_hint as Record<string, boolean | string>)
          : {},
      provider: key.provider,
      status: key.status,
      verifiedAt: key.verified_at
        ? new Date(key.verified_at).toISOString()
        : null,
    }));
  });
}
