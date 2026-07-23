import "server-only";

import { getPool } from "./db/pool";

/**
 * BYOK必須プランのX APIキーstatusを返す（常設バナー算出用, T-M2-21）。未登録は null。
 * `user_api_keys` は (user_id, provider) unique なので高々1行。
 */
export async function getXApiKeyStatusForUser(
  userId: string,
): Promise<string | null> {
  const { rows } = await getPool().query<{ status: string }>(
    `select status from user_api_keys where user_id = $1 and provider = 'x'`,
    [userId],
  );
  return rows[0]?.status ?? null;
}
