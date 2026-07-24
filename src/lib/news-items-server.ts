import "server-only";

import { getPool } from "./db/pool";
import { listNewsItems, type NewsItemsPage } from "./news-items";
import type { Queryable } from "./x/token-refresh";

/** SC-06 ニュース一覧の server-only 配線（要件05 §6）。pool を束ねて純粋層を実値で使う。 */

const pooledDb: Queryable = {
  query: <T = unknown>(sql: string, params?: unknown[]) =>
    getPool().query(sql, params) as unknown as Promise<{
      rows: T[];
      rowCount: number | null;
    }>,
};

export function listNewsItemsForUser(input: unknown): Promise<NewsItemsPage> {
  return listNewsItems(pooledDb, input);
}
