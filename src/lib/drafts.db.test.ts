import { randomBytes, randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { encryptWithKey } from "./crypto/envelope";
import { closePool, getPool, withTransaction } from "./db/pool";
import { discardDraft, listDraftsForAccount, updateDraft } from "./drafts";
import { X_SCOPES } from "./x/oauth";
import type { Queryable } from "./x/token-refresh";

/**
 * DB integration for draft actions (T-M3-10, 要件05 §5・要件06 §4.3):
 * optimistic-locked edit (status=draft, pattern max), discard(draft/failed, unresolved reject,
 * status=discarded), and list filters. Skips without the local Supabase stack.
 */
describe("drafts (local DB)", () => {
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
  const noopDeleteImages = { deleteImages: async () => {} };

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

  async function makeAccount(c: PoolClient): Promise<{ uid: string; xid: string }> {
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
            access_token_ciphertext, refresh_token_ciphertext, oauth_scopes, token_expires_at, settings)
         values ($1,$2,'h','n','byok','active',$3,$3,$4, now()+interval '1 hour', '{"ng":{"words":["禁止語"]}}'::jsonb)
         returning id`,
        [uid, `x-${randomUUID()}`, encrypt("t"), X_SCOPES],
      )
    ).rows[0].id;
    return { uid, xid };
  }

  async function makeDraft(
    c: PoolClient,
    xid: string,
    opts: { status?: string; pattern?: string; tweetIds?: string[] } = {},
  ): Promise<{ id: string; updatedAt: string }> {
    const thread = JSON.stringify([
      { local_id: "p1", text: "元の本文", weighted_length: 5, sources: [], warnings: [] },
    ]);
    const row = (
      await c.query<{ id: string; updated_at: string }>(
        `insert into drafts (x_account_id, pattern, thread, initial_thread, status, tweet_ids)
         values ($1,$2,$3::jsonb,$3::jsonb,$4,$5::jsonb)
         returning id, updated_at::text as updated_at`,
        [xid, opts.pattern ?? "p1", thread, opts.status ?? "draft", JSON.stringify(opts.tweetIds ?? [])],
      )
    ).rows[0];
    return { id: row.id, updatedAt: row.updated_at };
  }

  const cleanup = (uid: string) =>
    withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));

  it("updateDraft: optimistic lock, status=draft, recompute warnings; initial_thread unchanged", async () => {
    const { uid, draft } = await withTransaction(async (c) => {
      const acc = await makeAccount(c);
      const draft = await makeDraft(c, acc.xid);
      return { ...acc, draft };
    });
    try {
      // stale expected_updated_at → job_conflict
      await expect(
        updateDraft(db, {
          userId: uid,
          draftId: draft.id,
          expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
          posts: [{ text: "編集後" }],
        }),
      ).rejects.toMatchObject({ code: "job_conflict" });

      // correct expected → updates thread + recomputes NG warning; initial_thread untouched
      const res = await updateDraft(db, {
        userId: uid,
        draftId: draft.id,
        expectedUpdatedAt: draft.updatedAt,
        posts: [{ text: "禁止語を含む本文" }],
      });
      expect(res.updatedAt).not.toBe(draft.updatedAt);

      const row = (
        await db.query<{
          thread: Array<{ text: string; warnings: string[] }>;
          initial_thread: Array<{ text: string }>;
        }>(`select thread, initial_thread from drafts where id = $1`, [draft.id])
      ).rows[0];
      expect(row.thread[0].text).toBe("禁止語を含む本文");
      expect(row.thread[0].warnings).toContain("ng_word");
      expect(row.initial_thread[0].text).toBe("元の本文"); // unchanged
    } finally {
      await cleanup(uid);
    }
  });

  it("updateDraft rejects exceeding the P-1 max of 6 posts", async () => {
    const { uid, draft } = await withTransaction(async (c) => {
      const acc = await makeAccount(c);
      const draft = await makeDraft(c, acc.xid, { pattern: "p1" });
      return { uid: acc.uid, draft };
    });
    try {
      await expect(
        updateDraft(db, {
          userId: uid,
          draftId: draft.id,
          expectedUpdatedAt: draft.updatedAt,
          posts: Array.from({ length: 7 }, (_, i) => ({ text: `p${i}` })),
        }),
      ).rejects.toMatchObject({ code: "validation_error" });
    } finally {
      await cleanup(uid);
    }
  });

  it("discardDraft: draft → discarded; failed with tweet_ids rejected; posted rejected", async () => {
    const { uid, xid, d1, dFailed, dPosted } = await withTransaction(async (c) => {
      const acc = await makeAccount(c);
      const d1 = await makeDraft(c, acc.xid, { status: "draft" });
      const dFailed = await makeDraft(c, acc.xid, { status: "failed", tweetIds: ["999"] });
      const dPosted = await makeDraft(c, acc.xid, { status: "posted" });
      return { ...acc, d1, dFailed, dPosted };
    });
    try {
      const res = await discardDraft(
        db,
        { userId: uid, draftId: d1.id, expectedUpdatedAt: d1.updatedAt },
        noopDeleteImages,
      );
      expect(res.status).toBe("discarded");
      const status = (
        await db.query<{ status: string }>(`select status from drafts where id = $1`, [d1.id])
      ).rows[0].status;
      expect(status).toBe("discarded"); // not physically deleted

      await expect(
        discardDraft(
          db,
          { userId: uid, draftId: dFailed.id, expectedUpdatedAt: dFailed.updatedAt },
          noopDeleteImages,
        ),
      ).rejects.toMatchObject({ code: "job_conflict" });

      await expect(
        discardDraft(
          db,
          { userId: uid, draftId: dPosted.id, expectedUpdatedAt: dPosted.updatedAt },
          noopDeleteImages,
        ),
      ).rejects.toMatchObject({ code: "job_conflict" });
      void xid;
    } finally {
      await cleanup(uid);
    }
  });

  it("listDraftsForAccount filters by tab (drafts=draft/failed, history=posted)", async () => {
    const { uid, xid } = await withTransaction(async (c) => {
      const acc = await makeAccount(c);
      await makeDraft(c, acc.xid, { status: "draft" });
      await makeDraft(c, acc.xid, { status: "failed" });
      await makeDraft(c, acc.xid, { status: "posted" });
      await makeDraft(c, acc.xid, { status: "discarded" });
      return acc;
    });
    try {
      const drafts = await listDraftsForAccount(db, xid, "drafts");
      expect(drafts.map((d) => d.status).sort()).toEqual(["draft", "failed"]);
      const history = await listDraftsForAccount(db, xid, "history");
      expect(history.map((d) => d.status)).toEqual(["posted"]);
    } finally {
      await cleanup(uid);
    }
  });
});
