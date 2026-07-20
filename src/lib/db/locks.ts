import type { PoolClient } from "pg";

/**
 * Advisory lock key derivation (要件04 §4, ADR-0002). Used to serialize
 * worker leases so write-skew cannot let two workers run conflicting jobs:
 * - per X account (all kinds serialized)
 * - per user for post_publish
 * - per cron job + time window
 *
 * Keys are the two-int form `pg_advisory_xact_lock(classid, objid)`: classid
 * namespaces the lock category, objid is a deterministic 32-bit hash of the id.
 * Kept free of DB/`server-only` imports so derivation is unit-testable.
 */

export const LOCK_CLASS = {
  xAccount: 1,
  postPublish: 2,
  cron: 3,
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

export function cronWindowLockKey(jobName: string, windowKey: string): LockKey {
  return [LOCK_CLASS.cron, hash32(`${jobName}:${windowKey}`)];
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

/**
 * Tries to acquire a SESSION-scoped advisory lock without blocking. Returns
 * true if granted. The lock is held on this connection until `advisoryUnlock`
 * or the connection is released — used to guard a whole cron handler run
 * against concurrent/duplicate starts for the same time window (要件04 §6).
 */
export async function tryAdvisoryLock(
  client: PoolClient,
  key: LockKey,
): Promise<boolean> {
  const res = await client.query<{ locked: boolean }>(
    "select pg_try_advisory_lock($1::int4, $2::int4) as locked",
    [key[0], key[1]],
  );
  return res.rows[0]?.locked === true;
}

/** Releases a session-scoped advisory lock acquired with `tryAdvisoryLock`. */
export async function advisoryUnlock(
  client: PoolClient,
  key: LockKey,
): Promise<void> {
  await client.query("select pg_advisory_unlock($1::int4, $2::int4)", [
    key[0],
    key[1],
  ]);
}
