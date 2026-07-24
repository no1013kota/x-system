import "server-only";

import { getPool } from "../db/pool";
import { xClientDeps } from "./client-server";
import type { XReadDeps } from "./read-client";
import type { Queryable } from "./token-refresh";
import type { XUsageContext } from "./usage";

/**
 * X 読取クライアントの server-only 配線（T-M5-01）。pool と env（xClientDeps）を束ね、対象アカウントの
 * access token（M2 の token 復号・refresh で取得）と原価台帳 ctx を受けて `XReadDeps` を組む。
 */

const pooledDb: Queryable = {
  query: <T = unknown>(sql: string, params?: unknown[]) =>
    getPool().query(sql, params) as unknown as Promise<{
      rows: T[];
      rowCount: number | null;
    }>,
};

export function buildXReadDeps(accessToken: string, ctx: XUsageContext): XReadDeps {
  return { db: pooledDb, x: xClientDeps(), accessToken, ctx };
}
