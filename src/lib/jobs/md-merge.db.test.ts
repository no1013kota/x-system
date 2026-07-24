import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closePool, getPool, withTransaction } from "../db/pool";
import { emptyUsage, type TextGen } from "../ai/types";
import type { Queryable } from "../x/token-refresh";
import { executeMdMerge } from "./md-merge";

const pooledDb: Queryable = {
  query: <T = unknown>(sql: string, params?: unknown[]) =>
    getPool().query(sql, params) as unknown as Promise<{ rows: T[]; rowCount: number | null }>,
};

const BASE_MD = `# 発信定義書

## 1. ペルソナ
- 発信者: A

## 2. 発信テーマ
- 主テーマ: AI

## 3. トーン&マナー
- 文末: です・ます調

## 4. やらないこと
- 煽らない

## 5. 文体・自分らしさ
旧5

## 6. 参考にする型
旧6
`;

function gen(body: string): TextGen {
  return {
    generate: async () => ({ provider: "anthropic", requestId: "r", text: body, citations: [], usage: emptyUsage(), stopReason: "end_turn" }),
  };
}

function deps(jobId: string, body: string) {
  return {
    db: pooledDb,
    jobId,
    runInTx: <T>(fn: (tx: Queryable) => Promise<T>) => withTransaction((c) => fn(c as unknown as Queryable)),
    resolveProvider: async () => ({ textGen: gen(body), provider: "anthropic" as const, model: "m" }),
    recordStage: async () => {},
    makeDeadline: () => ({ remainingMs: () => 90_000, canStartCall: () => true, callTimeoutMs: () => 90_000 }),
  };
}

/**
 * DB integration tests for MD-MERGE (T-M5-04, 要件04 §12, 要件05 §9, 要件02 §3.4). Skips without local DB.
 */
describe("executeMdMerge (db)", () => {
  let available = false;
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

  async function seed(c: PoolClient): Promise<{ uid: string; xid: string; jobId: string; sourceId: string }> {
    const uid = randomUUID();
    await c.query(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2)`,
      [uid, `${uid}@example.com`],
    );
    await c.query(`insert into profiles (id, email) values ($1,$2) on conflict (id) do nothing`, [uid, `${uid}@example.com`]);
    const xid = (
      await c.query<{ id: string }>(
        `insert into x_accounts (user_id, x_user_id, handle, name, auth_type, base_md, base_md_version)
         values ($1,$2,'h','n','byok',$3,2) returning id`,
        [uid, `x-${randomUUID()}`, BASE_MD],
      )
    ).rows[0].id;
    const sourceId = (
      await c.query<{ id: string }>(
        `insert into learning_sources (x_account_id, type, url, status, analysis_summary)
         values ($1,'own_posts',null,'pending',$2::jsonb) returning id`,
        [xid, JSON.stringify({ type: "own_posts", tone: "casual" })],
      )
    ).rows[0].id;
    const jobId = (
      await c.query<{ id: string }>(
        `insert into generation_jobs (x_account_id, kind, trigger, learning_source_id, status)
         values ($1,'learning_analysis','manual',$2,'running') returning id`,
        [xid, sourceId],
      )
    ).rows[0].id;
    return { uid, xid, jobId, sourceId };
  }

  it("writes a new base_md version (learning), history row, and confirms source analyzed atomically; keeps 1-4", async () => {
    const s = await withTransaction((c) => seed(c));
    try {
      const res = await executeMdMerge(deps(s.jobId, "統合された新セクション"), { confirmSourceId: s.sourceId });
      expect(res.version).toBe(3); // 2 -> 3

      const acct = (
        await withTransaction((c) =>
          c.query<{ base_md: string; base_md_version: number }>(
            `select base_md, base_md_version from x_accounts where id = $1`,
            [s.xid],
          ),
        )
      ).rows[0];
      expect(acct.base_md_version).toBe(3);
      expect(acct.base_md).toContain("## 1. ペルソナ"); // sections 1-4 unchanged
      expect(acct.base_md).toContain("## 5. 文体・自分らしさ\n統合された新セクション"); // own_posts → target §5
      expect(acct.base_md).not.toContain("旧5");
      expect(acct.base_md).toContain("## 6. 参考にする型\n旧6"); // NON-target §6 preserved

      const ver = (
        await withTransaction((c) =>
          c.query<{ change_source: string }>(
            `select change_source from base_md_versions where x_account_id = $1 and version = 3`,
            [s.xid],
          ),
        )
      ).rows;
      expect(ver[0]?.change_source).toBe("learning");

      const src = (
        await withTransaction((c) =>
          c.query<{ status: string }>(`select status::text as status from learning_sources where id = $1`, [s.sourceId]),
        )
      ).rows[0];
      expect(src.status).toBe("analyzed");
    } finally {
      // base_md_versions は x_accounts への FK が cascade でないため先に消す。
      await withTransaction((c) => c.query(`delete from base_md_versions where x_account_id = $1`, [s.xid]));
      await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [s.uid]));
    }
  });
});
