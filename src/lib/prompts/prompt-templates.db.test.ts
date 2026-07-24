import { randomBytes, randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { encryptWithKey } from "../crypto/envelope";
import { closePool, getPool, withTransaction } from "../db/pool";
import { X_SCOPES } from "../x/oauth";
import { PT_P1, PT_P2, SYSTEM_DEFAULT_TEMPLATES } from "./gen-prompts";
import {
  applyResetPromptTemplate,
  applyUpdatePromptTemplate,
  listPromptTemplates,
  resolvePromptTemplate,
  seedSystemPromptTemplates,
} from "./prompt-templates";
import { AppError } from "../observability/errors";
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

  async function seedAccount(): Promise<{ uid: string; xid: string }> {
    return withTransaction(async (c: PoolClient) => {
      const uid = randomUUID();
      await c.query(
        `insert into auth.users (id, instance_id, aud, role, email)
         values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2)`,
        [uid, `${uid}@example.com`],
      );
      await c.query(`insert into profiles (id, email) values ($1,$2) on conflict (id) do nothing`, [
        uid,
        `${uid}@example.com`,
      ]);
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
      return { uid, xid };
    });
  }

  async function reject(p: Promise<unknown>): Promise<AppError> {
    try {
      await p;
    } catch (e) {
      return e as AppError;
    }
    throw new Error("expected rejection");
  }

  it("update creates an override (expectedUpdatedAt=null), then version-locks", async () => {
    await seedSystemPromptTemplates(db);
    const { uid, xid } = await seedAccount();
    try {
      const created = await applyUpdatePromptTemplate(db, {
        xAccountId: xid,
        kind: "p1",
        content: "OVR 1",
        expectedUpdatedAt: null,
        plan: "md",
        quotePostEnabled: true,
      });
      expect(created).toMatchObject({ kind: "p1", content: "OVR 1", isOverride: true });
      expect(created.updatedAt).not.toBeNull();

      // creating again with null must conflict (already exists)
      const dup = await reject(
        applyUpdatePromptTemplate(db, {
          xAccountId: xid,
          kind: "p1",
          content: "OVR X",
          expectedUpdatedAt: null,
          plan: "md",
          quotePostEnabled: true,
        }),
      );
      expect(dup.code).toBe("job_conflict");

      // stale timestamp conflicts
      const stale = await reject(
        applyUpdatePromptTemplate(db, {
          xAccountId: xid,
          kind: "p1",
          content: "OVR 2",
          expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
          plan: "md",
          quotePostEnabled: true,
        }),
      );
      expect(stale.code).toBe("job_conflict");
      expect(stale.details?.reason).toBe("prompt_template_changed");

      // correct timestamp succeeds
      const updated = await applyUpdatePromptTemplate(db, {
        xAccountId: xid,
        kind: "p1",
        content: "OVR 2",
        expectedUpdatedAt: created.updatedAt,
        plan: "premium",
        quotePostEnabled: true,
      });
      expect(updated.content).toBe("OVR 2");
      expect(await resolvePromptTemplate(db, { xAccountId: xid, kind: "p1" })).toBe("OVR 2");
    } finally {
      await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));
    }
  });

  it("reset removes the override and returns to system default", async () => {
    await seedSystemPromptTemplates(db);
    const { uid, xid } = await seedAccount();
    try {
      await applyUpdatePromptTemplate(db, {
        xAccountId: xid,
        kind: "p2",
        content: "OVR P2",
        expectedUpdatedAt: null,
        plan: "md",
        quotePostEnabled: true,
      });
      const reset = await applyResetPromptTemplate(db, {
        xAccountId: xid,
        kind: "p2",
        plan: "md",
        quotePostEnabled: true,
      });
      expect(reset).toMatchObject({ kind: "p2", isOverride: false, content: PT_P2, updatedAt: null });
      const views = await listPromptTemplates(db, xid);
      expect(views.find((v) => v.kind === "p2")?.isOverride).toBe(false);
    } finally {
      await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));
    }
  });

  it("standard plan is forbidden; p5 with quote-post off is feature_disabled", async () => {
    await seedSystemPromptTemplates(db);
    const { uid, xid } = await seedAccount();
    try {
      const forbidden = await reject(
        applyUpdatePromptTemplate(db, {
          xAccountId: xid,
          kind: "p1",
          content: "X",
          expectedUpdatedAt: null,
          plan: "standard",
          quotePostEnabled: true,
        }),
      );
      expect(forbidden.code).toBe("forbidden");

      const disabled = await reject(
        applyResetPromptTemplate(db, {
          xAccountId: xid,
          kind: "p5",
          plan: "md",
          quotePostEnabled: false,
        }),
      );
      expect(disabled.code).toBe("feature_disabled");
    } finally {
      await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));
    }
  });
});
