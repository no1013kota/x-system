import "server-only";

import { getPool } from "./db/pool";
import {
  listLearningSources,
  ownPostsReimportEligibility,
  type LearningSourceView,
} from "./learning-sources";
import type { Queryable } from "./x/token-refresh";

/** 学習ソース閲覧の server-only 配線（SC-10, T-M5-07）。pool を束ねて純粋層を実値で使う。 */

const pooledDb: Queryable = {
  query: <T = unknown>(sql: string, params?: unknown[]) =>
    getPool().query(sql, params) as unknown as Promise<{ rows: T[]; rowCount: number | null }>,
};

export function listLearningSourcesForUser(
  userId: string,
  xAccountId: string,
): Promise<LearningSourceView[]> {
  return listLearningSources(pooledDb, userId, xAccountId);
}

export function ownPostsReimportEligibilityForAccount(
  xAccountId: string,
): Promise<{ nextEligibleAt: string | null }> {
  return ownPostsReimportEligibility(pooledDb, xAccountId);
}
