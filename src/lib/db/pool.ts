import { Pool, type PoolClient } from "pg";

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

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL ?? LOCAL_DB_URL,
      // small ceiling: serverless functions should hold few connections
      max: Number(process.env.DB_POOL_MAX ?? 10),
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
  const client = await getPool().connect();
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
 * Runs a caller-authored SELECT with `FOR UPDATE SKIP LOCKED` appended, for
 * lease-style claiming of queued rows (要件04 §4). `selectSql` must be a plain
 * SELECT (code-authored, no user input) ending before any locking clause; the
 * locking clause is appended after ORDER BY/LIMIT as Postgres requires.
 */
export async function claimForUpdateSkipLocked<T>(
  client: PoolClient,
  selectSql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const { rows } = await client.query(
    `${selectSql} for update skip locked`,
    params,
  );
  return rows as T[];
}
