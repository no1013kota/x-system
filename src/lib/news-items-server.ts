import "server-only";

import { pooledQueryable } from "./db/pool";
import {
  listCreatedNewsItemIds,
  listNewsItems,
  listTopHighImpactNews,
  type NewsItemView,
  type NewsItemsPage,
} from "./news-items";

/** SC-06 ニュース一覧の server-only 配線（要件05 §6）。pool を束ねて純粋層を実値で使う。 */

const pooledDb = pooledQueryable();

export function listNewsItemsForUser(input: unknown): Promise<NewsItemsPage> {
  return listNewsItems(pooledDb, input);
}

export function listCreatedNewsItemIdsForAccount(
  xAccountId: string,
  newsItemIds: string[],
): Promise<string[]> {
  return listCreatedNewsItemIds(pooledDb, xAccountId, newsItemIds);
}

export function listTopHighImpactNewsForUser(input: {
  categories: string[];
  limit: number;
}): Promise<NewsItemView[]> {
  return listTopHighImpactNews(pooledDb, input);
}
