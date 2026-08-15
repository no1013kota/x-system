import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closePool, getPool, withTransaction } from "../db/pool";
import { AppError } from "../observability/errors";
import type { Queryable } from "../x/token-refresh";
import { listSuggestions, refreshSuggestions } from "./suggestion-jobs";

/**
 * DB integration for refreshSuggestions / listSuggestions (SUGGEST, 要件05 §9, 要件04 §12, T-M5-18):
 * 冪等・active suggestion なし・同一JST日成功なし・新metrics・最新成功jobの提案取得を検証する。
 */
const pooledDb: Queryable = {
  query: <T = unknown>(sql: string, params?: unknown[]) =>
    getPool().query(sql, params) as unknown as Promise<{ rows: T[]; rowCount: number | null }>,
};

const runInTx = { runInTx: <T>(fn: (tx: Queryable) => Promise<T>) => withTransaction((c) => fn(c as unknown as Queryable)) };

describe("refreshSuggestions / listSuggestions (local DB)", () => {
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

  async function seed(): Promise<{ uid: string; xid: string }> {
    return withTransaction(async (c: PoolClient) => {
      const uid = randomUUID();
      await c.query(
        `insert into auth.users (id, instance_id, aud, role, email)
         values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2)`,
        [uid, `${uid}@example.com`],
      );
      await c.query(`insert into profiles (id, email) values ($1,$2) on conflict (id) do nothing`, [uid, `${uid}@example.com`]);
      const xid = (
        await c.query<{ id: string }>(
          `insert into x_accounts (user_id, x_user_id, handle, name, auth_type, status)
           values ($1,$2,'h','n','byok','active') returning id`,
          [uid, `x-${randomUUID()}`],
        )
      ).rows[0].id;
      await c.query(`update profiles set active_x_account_id = $1 where id = $2`, [xid, uid]);
      return { uid, xid };
    });
  }

  const cleanup = (uid: string) => withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));

  async function reject(p: Promise<unknown>): Promise<AppError> {
    try {
      await p;
    } catch (e) {
      return e as AppError;
    }
    throw new Error("expected rejection");
  }

  it("creates a suggestion job on first run and is request_key idempotent", async () => {
    const { uid, xid } = await seed();
    try {
      const first = await refreshSuggestions(uid, xid, { request_key: "k1" }, runInTx);
      expect(first.deduped).toBe(false);
      const again = await refreshSuggestions(uid, xid, { request_key: "k1" }, runInTx);
      expect(again).toMatchObject({ jobId: first.jobId, deduped: true });
      const n = (
        await pooledDb.query<{ n: string }>(
          `select count(*) as n from generation_jobs where x_account_id = $1 and kind = 'suggestion'`,
          [xid],
        )
      ).rows[0].n;
      expect(Number(n)).toBe(1); // idempotent, single job
    } finally {
      await cleanup(uid);
    }
  });

  it("rejects when an active suggestion job already exists", async () => {
    const { uid, xid } = await seed();
    try {
      await withTransaction((c) =>
        c.query(`insert into generation_jobs (x_account_id, kind, trigger, status) values ($1,'suggestion','manual','running')`, [xid]),
      );
      const e = await reject(refreshSuggestions(uid, xid, { request_key: "k1" }, runInTx));
      expect(e.code).toBe("job_conflict");
      expect(e.details?.reason).toBe("active_suggestion_exists");
    } finally {
      await cleanup(uid);
    }
  });

  it("rejects a second run on the same JST day (already succeeded today)", async () => {
    const { uid, xid } = await seed();
    try {
      await withTransaction((c) =>
        c.query(`insert into generation_jobs (x_account_id, kind, trigger, status) values ($1,'suggestion','manual','succeeded')`, [xid]),
      );
      const e = await reject(refreshSuggestions(uid, xid, { request_key: "k1" }, runInTx));
      expect(e.code).toBe("job_conflict");
      expect(e.details?.reason).toBe("already_today");
    } finally {
      await cleanup(uid);
    }
  });

  it("前日以前に実行済みでも当日は実行できる（no_new_metrics ゲートは廃止・T-M8-91）", async () => {
    // データ源がXタイムラインの直取得になったため、「保存済みmetricsの更新」を実行条件にしない。
    // 残すと、Exos経由の投稿が無いアカウント（外部投稿のみ）が永久に実行できない。
    const { uid, xid } = await seed();
    try {
      await withTransaction((c) =>
        c.query(
          `insert into generation_jobs (x_account_id, kind, trigger, status, created_at)
           values ($1,'suggestion','manual','succeeded', now() - interval '1 day')`,
          [xid],
        ),
      );
      const res = await refreshSuggestions(uid, xid, { request_key: "k1" }, runInTx);
      expect(res.deduped).toBe(false);
      expect(res.jobId).toBeTruthy();
    } finally {
      await cleanup(uid);
    }
  });

  it("listSuggestions returns only the latest succeeded job's suggestions", async () => {
    const { uid, xid } = await seed();
    try {
      const { oldJob, newJob } = await withTransaction(async (c: PoolClient) => {
        const oldJob = (
          await c.query<{ id: string }>(
            `insert into generation_jobs (x_account_id, kind, trigger, status, created_at, finished_at)
             values ($1,'suggestion','manual','succeeded', now() - interval '2 days', now() - interval '2 days') returning id`,
            [xid],
          )
        ).rows[0].id;
        const newJob = (
          await c.query<{ id: string }>(
            `insert into generation_jobs (x_account_id, kind, trigger, status, created_at, finished_at)
             values ($1,'suggestion','manual','succeeded', now() - interval '1 hour', now() - interval '1 hour') returning id`,
            [xid],
          )
        ).rows[0].id;
        await c.query(
          `insert into improvement_suggestions (x_account_id, source_job_id, content, evidence)
           values ($1,$2,'古い提案','{}'::jsonb)`,
          [xid, oldJob],
        );
        await c.query(
          `insert into improvement_suggestions (x_account_id, source_job_id, content, evidence)
           values ($1,$2,'新しい提案','{}'::jsonb)`,
          [xid, newJob],
        );
        return { oldJob, newJob };
      });
      const list = await listSuggestions(pooledDb, uid, xid);
      expect(list.map((s) => s.content)).toEqual(["新しい提案"]); // only latest job's
      expect(newJob).not.toBe(oldJob);
      // ownership: another user sees nothing
      expect(await listSuggestions(pooledDb, randomUUID(), xid)).toHaveLength(0);
    } finally {
      await cleanup(uid);
    }
  });
});
