import { Client } from "pg";

/**
 * Local Supabase Postgres connection for DB-backed integration tests.
 * Override with SUPABASE_DB_URL when the local stack uses a non-default port.
 */
export const LOCAL_DB_URL =
  process.env.SUPABASE_DB_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

/**
 * Connects to the local DB, or returns null when it is unreachable so
 * integration tests can skip instead of failing on machines/CI without the
 * Supabase stack running (`supabase start`).
 */
export async function connectLocalDb(): Promise<Client | null> {
  const client = new Client({
    connectionString: LOCAL_DB_URL,
    connectionTimeoutMillis: 2000,
  });
  try {
    await client.connect();
    return client;
  } catch {
    await client.end().catch(() => {});
    return null;
  }
}
