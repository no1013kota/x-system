import "server-only";

import type { Queryable } from "./db/queryable";


/** db注入版（App Shellの単一接続ロード用・T-M8-197）。 */
export async function getXApiKeyStatus(
  db: Queryable,
  userId: string,
): Promise<string | null> {
  const { rows } = await db.query<{ status: string }>(
    `select status from user_api_keys where user_id = $1 and provider = 'x'`,
    [userId],
  );
  return rows[0]?.status ?? null;
}
