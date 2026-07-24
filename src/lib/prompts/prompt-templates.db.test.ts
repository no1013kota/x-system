import { randomBytes, randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { encryptWithKey } from "../crypto/envelope";
import { closePool, getPool, withTransaction } from "../db/pool";
import { X_SCOPES } from "../x/oauth";
import { PT_P1, PT_P2, SYSTEM_DEFAULT_TEMPLATES } from "./gen-prompts";
import {
  resolvePromptTemplate,
  seedSystemPromptTemplates,
} from "./prompt-templates";
import type { Queryable } from "../x/token-refresh";

/**
 * DB integration for prompt_templates seed + resolution (T-M3-02, 要件02 §3.5):
 * idempotent 7-row system default seed, and override → system default resolution.
 */
describe("prompt-templates (local DB)", () => {
  let available = false;
  const testKey = randomBytes(32);
  const encrypt = (p: string) => encryptWithKey(p, testKey);
  const db: Queryable = {
    query: <T = unknown>(sql: string, params?: unknown[]) =>
      getPool().query(sql, params) as unknown as Promise<{
        rows: T[];
        rowCount: number | null;
      }>,
  };

  beforeAll(async () => {
    try {
      const c = await getPool().connect();
      c.release();
      available = true;
    } catch {
      available = false;
    }
  });
  afterAll(async () => {
    await closePool();
  });
  beforeEach((ctx) => {
    if (!available) ctx.skip();
  });

  it("seeds 7 system defaults idempotently (kinds p1-p6, image)", async () => {
    await seedSystemPromptTemplates(db);
    await seedSystemPromptTemplates(db); // idempotent re-run
    const { rows } = await db.query<{ kind: string; content: string }>(
      `select kind, content from prompt_templates where x_account_id is null order by kind`,
    );
    const byKind = Object.fromEntries(rows.map((r) => [r.kind, r.content]));
    for (const kind of ["p1", "p2", "p3", "p4", "p5", "p6", "image"]) {
      expect(byKind[kind]).toBe(SYSTEM_DEFAULT_TEMPLATES[kind as keyof typeof SYSTEM_DEFAULT_TEMPLATES]);
    }
  });

  it("resolves account override first, else the system default", async () => {
    await seedSystemPromptTemplates(db);
    const { uid, xid } = await withTransaction(async (c: PoolClient) => {
      const uid = randomUUID();
      await c.query(
        `insert into auth.users (id, instance_id, aud, role, email)
         values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2)`,
        [uid, `${uid}@example.com`],
      );
      await c.query(
        `insert into profiles (id, email) values ($1,$2) on conflict (id) do nothing`,
        [uid, `${uid}@example.com`],
      );
      const xid = (
        await c.query<{ id: string }>(
          `insert into x_accounts
             (user_id, x_user_id, handle, name, auth_type, status,
              access_token_ciphertext, refresh_token_ciphertext, oauth_scopes, token_expires_at)
           values ($1,$2,'h','n','byok','active',$3,$3,$4, now() + interval '1 hour')
           returning id`,
          [uid, `x-${randomUUID()}`, encrypt("t"), X_SCOPES],
        )
      ).rows[0].id;
      await c.query(
        `insert into prompt_templates (x_account_id, kind, content) values ($1,'p1','CUSTOM P1')`,
        [xid],
      );
      return { uid, xid };
    });
    try {
      // p1 has an override → custom
      expect(await resolvePromptTemplate(db, { xAccountId: xid, kind: "p1" })).toBe("CUSTOM P1");
      // p2 has no override → system default
      expect(await resolvePromptTemplate(db, { xAccountId: xid, kind: "p2" })).toBe(PT_P2);
      // null account → system default
      expect(await resolvePromptTemplate(db, { xAccountId: null, kind: "p1" })).toBe(PT_P1);
    } finally {
      await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));
    }
  });
});
