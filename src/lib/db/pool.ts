import "server-only";

import { Pool, type PoolClient } from "pg";

import type { Queryable } from "./queryable";
import { LOCAL_DB_URL } from "./test-utils";

/**
 * Server-side Postgres access for workers/cron via the Supavisor transaction-
 * mode pooler (DATABASE_URL, 要件01 §3.2/§6, ADR-0002). Only ever imported by
 * server code (Server Actions / API routes / cron handlers) — never a Client
 * Component.
 *
 * Transaction-mode pooling does not keep session state between checkouts, so we
 * avoid named prepared statements (node-postgres unnamed parameterized queries
 * are fine). Complex multi-statement transactions run here, NOT via
 * supabase-js/PostgREST.
 */

let pool: Pool | null = null;

/**
 * 1インスタンスが持つ最大接続数（要決定D-43・T-M8-303）。
 *
 * Supabase Free の pooler はクライアント上限200で、これを「Vercelのインスタンス数 × ここの値」が
 * 食い潰す。既定を10のままにすると**環境変数を設定し忘れた環境だけが上限を食い潰す**——
 * しかも症状は「たまに遅い」なので気付きにくい（原則3: 忘れたら壊れる手順にしない）。
 * 既定を3にして、**設定を忘れても安全側**に倒す。増やしたい環境だけが `DB_POOL_MAX` を持つ。
 */
export const DEFAULT_DB_POOL_MAX = 3;

export function poolMax(): number {
  const raw = Number(process.env.DB_POOL_MAX);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_DB_POOL_MAX;
}

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL ?? LOCAL_DB_URL,
      // small ceiling: serverless functions should hold few connections
      max: poolMax(),
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10_000,
    });
  }
  return pool;
}

export interface PoolStats {
  total: number;
  idle: number;
  waiting: number;
}

export function poolStats(): PoolStats {
  const p = getPool();
  return { total: p.totalCount, idle: p.idleCount, waiting: p.waitingCount };
}

/**
 * 接続の取得が待たされたときだけ1行記録する（T-M8-198・要件01 §9）。
 *
 * `poolStats()` は実装済みだったが**どこからも読まれておらず**、移行条件
 * 「pooler接続の枯渇・待ち行列が観測された」を判断する材料が無かった（原則1・原則4）。
 * 正常時は0行で、待たされたときだけ入る。doctorが直近24時間を見て運営者へ知らせる。
 *
 * **記録自体で状況を悪化させない**: 閾値未満は書かない／同一プロセスで1分に1回まで／
 * 失敗は握り潰す（記録できないことより本処理を優先する）。
 */
const POOL_WAIT_THRESHOLD_MS = 200;
const POOL_EVENT_MIN_INTERVAL_MS = 60_000;
let lastPoolEventAt = 0;

async function recordPoolWait(waitedMs: number, source: string): Promise<void> {
  if (waitedMs < POOL_WAIT_THRESHOLD_MS) return;
  const now = Date.now();
  if (now - lastPoolEventAt < POOL_EVENT_MIN_INTERVAL_MS) return;
  lastPoolEventAt = now;
  const stats = poolStats();
  try {
    await getPool().query(
      `insert into db_pool_events (waited_ms, total_count, idle_count, waiting_count, source)
       values ($1, $2, $3, $4, $5)`,
      [Math.round(waitedMs), stats.total, stats.idle, stats.waiting, source],
    );
    // eslint-disable-next-line no-restricted-syntax -- 観測の記録が失敗しても本処理は止めない（原則1の趣旨に沿う側）。
  } catch {
    lastPoolEventAt = 0; // 次の機会に再挑戦できるようにする
  }
}

/** 接続を取得し、待たされていたら記録する（記録の待ちは本処理へ足さない）。 */
async function connectWithWaitProbe(source: string): Promise<PoolClient> {
  const startedAt = Date.now();
  const client = await getPool().connect();
  const waitedMs = Date.now() - startedAt;
  if (waitedMs >= POOL_WAIT_THRESHOLD_MS) void recordPoolWait(waitedMs, source);
  return client;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Runs `fn` inside a transaction on a pooled connection, committing on success
 * and rolling back on any throw. The connection is always released back to the
 * pool (acquired per unit of work, not held across calls).
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await connectWithWaitProbe("transaction");
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * A `Queryable` backed by the shared pool: each `query` acquires a connection,
 * runs, and releases it. Replaces the per-file `const pooledDb: Queryable = {…}`
 * boilerplate (and its `as unknown as` cast) that was duplicated across ~30
 * server modules.
 */
export function pooledQueryable(): Queryable {
  return {
    query: async <T = unknown>(sql: string, params?: unknown[]) => {
      // 待ち行列を観測する（T-M8-198）。`pool.query` は内部で接続を取るため、
      // ここでは実行前後の時間から待ちを推定せず、待ち行列の長さが立っているときだけ記録する。
      const waiting = getPool().waitingCount;
      const startedAt = waiting > 0 ? Date.now() : 0;
      const result = (await getPool().query(sql, params)) as unknown as {
        rows: T[];
        rowCount: number | null;
      };
      if (startedAt) void recordPoolWait(Date.now() - startedAt, "query");
      return result;
    },
  };
}

/** Runs `fn` in a transaction, exposing the tx client as a `Queryable`. */
export function runInPooledTx<T>(
  fn: (tx: Queryable) => Promise<T>,
): Promise<T> {
  return withTransaction((client) => fn(client as unknown as Queryable));
}
