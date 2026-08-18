import { randomBytes, randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { encryptWithKey } from "../crypto/envelope";
import { closePool, getPool, withTransaction } from "../db/pool";
import { X_SCOPES } from "../x/oauth";
import { SYSTEM_DEFAULT_TEMPLATES } from "./gen-prompts";
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

  /**
   * 型プロンプト（p1〜p6）は `post_patterns` へ移したので、ここで seed するのは画像だけ
   * （T-M8-129 U2）。**型の行を作らない**ことがこのテストの主眼——行を残すと
   * 「コードを直したのに反映されない」経路が復活する（T-M7-37）。
   */
  it("system default は画像だけを冪等にseedする（型は post_patterns 側）", async () => {
    await seedSystemPromptTemplates(db);
    await seedSystemPromptTemplates(db); // idempotent re-run
    const { rows } = await db.query<{ kind: string; content: string }>(
      `select kind, content from prompt_templates where x_account_id is null order by kind`,
    );
    expect(rows.map((r) => r.kind), "型の行は作らない").toEqual(["image"]);
    expect(rows[0].content).toBe(SYSTEM_DEFAULT_TEMPLATES.image);
  });

  it("コード定数と同じなら更新せず0件を返す（updated_at を無駄に動かさない・T-M7-37）", async () => {
    await seedSystemPromptTemplates(db);
    const before = await db.query<{ updated_at: string }>(
      `select updated_at::text from prompt_templates where x_account_id is null and kind = 'image'`,
    );
    const applied = await seedSystemPromptTemplates(db);
    const after = await db.query<{ updated_at: string }>(
      `select updated_at::text from prompt_templates where x_account_id is null and kind = 'image'`,
    );
    expect(applied, "内容が同じなら0件").toBe(0);
    expect(after.rows[0].updated_at).toBe(before.rows[0].updated_at);
  });

  it("行が古いままでもコード定数へ追随させる（プロンプト修正が反映されない状態を残さない）", async () => {
    // 解決順は「account上書き → system default行 → コード定数」で、DB行があるとコード定数の
    // 変更が反映されない。2026-07-31、この関数がテストからしか呼ばれておらず、プロンプトを直しても
    // 古い行が使われ続ける状態だった（現在は scheduler_tick が毎回呼ぶ）。
    await seedSystemPromptTemplates(db);
    await db.query(
      `update prompt_templates set content = '古い内容' where x_account_id is null and kind = 'image'`,
    );
    const applied = await seedSystemPromptTemplates(db);
    expect(applied, "差分がある1件だけ更新").toBe(1);
    const { rows } = await db.query<{ content: string }>(
      `select content from prompt_templates where x_account_id is null and kind = 'image'`,
    );
    expect(rows[0].content).toBe(SYSTEM_DEFAULT_TEMPLATES.image);
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
        `insert into prompt_templates (x_account_id, kind, content) values ($1,'image','CUSTOM IMG')`,
        [xid],
      );
      // 型プロンプトの上書きは `post_patterns.prompt`（T-M8-129 U2）。
      await c.query(
        `update post_patterns set prompt = 'CUSTOM P1' where x_account_id = $1 and seed_key = 'p1'`,
        [xid],
      );
      return { uid, xid };
    });
    try {
      // 画像: 上書きがあれば custom、アカウント指定なしなら system default。
      expect(await resolvePromptTemplate(db, { xAccountId: xid, kind: "image" })).toBe("CUSTOM IMG");
      expect(await resolvePromptTemplate(db, { xAccountId: null, kind: "image" })).toBe(
        SYSTEM_DEFAULT_TEMPLATES.image,
      );

      /*
        **一覧は画像だけ**（T-M8-139）。型プロンプトの正本は `post_patterns` で、
        読み出しは `listPatternPrompts` が担う（ADR-0008・要件05 §8）。
        以前ここが p1〜p6 も返していたため、画像プロンプトの編集画面が
        「再読み込み」で p1 の編集画面に変わり、保存で投稿パターンを上書きしていた。
      */
      const views = await listPromptTemplates(db, xid);
      expect(views.map((v) => v.kind)).toEqual(["image"]);
      expect(views[0]).toMatchObject({ content: "CUSTOM IMG", isOverride: true });
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
        kind: "image",
        content: "OVR 1",
        expectedUpdatedAt: null,
        plan: "md",
        quotePostEnabled: true,
      });
      expect(created).toMatchObject({ kind: "image", content: "OVR 1", isOverride: true });
      expect(created.updatedAt).not.toBeNull();

      // creating again with null must conflict (already exists)
      const dup = await reject(
        applyUpdatePromptTemplate(db, {
          xAccountId: xid,
          kind: "image",
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
          kind: "image",
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
        kind: "image",
        content: "OVR 2",
        expectedUpdatedAt: created.updatedAt,
        plan: "premium",
        quotePostEnabled: true,
      });
      expect(updated.content).toBe("OVR 2");
      // 画像プロンプトの保存先は `prompt_templates`（型プロンプトは post_patterns 側・T-M8-139）。
      const saved = await db.query<{ content: string }>(
        `select content from prompt_templates where x_account_id = $1 and kind = 'image'`,
        [xid],
      );
      expect(saved.rows[0].content, "保存先が prompt_templates になっている").toBe("OVR 2");
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
        kind: "image",
        content: "OVR IMG",
        expectedUpdatedAt: null,
        plan: "md",
        quotePostEnabled: true,
      });
      const reset = await applyResetPromptTemplate(db, {
        xAccountId: xid,
        kind: "image",
        plan: "md",
        quotePostEnabled: true,
      });
      expect(reset).toMatchObject({
        kind: "image",
        isOverride: false,
        content: SYSTEM_DEFAULT_TEMPLATES.image,
        updatedAt: null,
      });
      const views = await listPromptTemplates(db, xid);
      expect(views.find((v) => v.kind === "image")?.isOverride).toBe(false);
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
