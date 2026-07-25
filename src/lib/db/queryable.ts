/**
 * pg.Pool（および PoolClient）が満たす最小の問い合わせIF。`query` は接続を都度取得・
 * 即解放する。純粋層（例: `x/token-refresh.ts`）の関数シグネチャで使うため server-only
 * にしない型専用モジュール。実体の生成は `pooledQueryable()`（server-only, `pool.ts`）。
 */
export interface Queryable {
  query<T = unknown>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}
