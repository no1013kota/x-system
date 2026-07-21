import type { PoolClient } from "pg";

/**
 * Advisory lock key derivation (要件04 §4, ADR-0002). Used to serialize
 * worker leases so write-skew cannot let two workers run conflicting jobs:
 * - per X account (all kinds serialized)
 * - per user for post_publish
 *
 * These are transaction-scoped (`pg_advisory_xact_lock`), released automatically
 * at transaction end, so they are safe on the Supavisor transaction-mode pooler.
 * Cron time-window de-duplication does NOT use advisory locks — it needs to span
 * a whole handler run across multiple transactions, which session-scoped locks
 * cannot do on a transaction-mode pooler; it uses the `cron_runs` lease row
 * instead (要件01 §3.2/§6, ADR-0003, `src/lib/jobs/cron.ts`).
 *
 * Keys are the two-int form `pg_advisory_xact_lock(classid, objid)`: classid
 * namespaces the lock category, objid is a deterministic 32-bit hash of the id.
 * Kept free of DB/`server-only` imports so derivation is unit-testable.
 */

export const LOCK_CLASS = {
  xAccount: 1,
  postPublish: 2,
} as const;

export type LockKey = readonly [classid: number, objid: number];

/**
 * Deterministic 32-bit FNV-1a hash, returned as a signed int32 so it fits
 * Postgres `int4` (pg_advisory_xact_lock's objid).
 */
export function hash32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // FNV prime 16777619, kept in 32-bit range via Math.imul
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0; // to signed int32
}

export function xAccountLockKey(xAccountId: string): LockKey {
  return [LOCK_CLASS.xAccount, hash32(xAccountId)];
}

export function postPublishLockKey(userId: string): LockKey {
  return [LOCK_CLASS.postPublish, hash32(userId)];
}

/**
 * Acquires a transaction-scoped advisory lock. Blocks until granted and is
 * released automatically when the surrounding transaction ends (commit or
 * rollback). Must be called inside a transaction.
 */
export async function acquireXactLock(
  client: PoolClient,
  key: LockKey,
): Promise<void> {
  await client.query("select pg_advisory_xact_lock($1::int4, $2::int4)", [
    key[0],
    key[1],
  ]);
}
