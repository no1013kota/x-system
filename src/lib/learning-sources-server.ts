import "server-only";

import { pooledQueryable } from "./db/pool";
import {
  listLearningSources,
  type LearningSourceView,
} from "./learning-sources";

/** 学習ソース閲覧の server-only 配線（SC-10, T-M5-07）。pool を束ねて純粋層を実値で使う。 */

const pooledDb = pooledQueryable();

export function listLearningSourcesForUser(
  userId: string,
  xAccountId: string,
): Promise<LearningSourceView[]> {
  return listLearningSources(pooledDb, userId, xAccountId);
}

