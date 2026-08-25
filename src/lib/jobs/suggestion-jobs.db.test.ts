import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closePool, getPool, withTransaction } from "../db/pool";
import type { Queryable } from "../x/token-refresh";
import { createManualSuggestionJob, listSuggestions } from "./suggestion-jobs";

/**
 * DB integration for createManualSuggestionJob / listSuggestions
 * (SUGGEST, 要件05 §9, 要件04 §12, T-M8-94→T-M8-255):
 * 「分析を開始」ボタンの手動起票——所有・active・契約・BYOKキーのゲート、
 * request_key による1日1回の冪等（already_running / already_done_today の言い分け）、
 * 最新成功jobの提案取得を検証する。
 */
const pooledDb: Queryable = {
  query: <T = unknown>(sql: string, params?: unknown[]) =>
    getPool().query(sql, params) as unknown as Promise<{ rows: T[]; rowCount: number | null }>,
};

/** JST 2026-08-16 12:00 の UTC ISO（冪等キーの日付は 2026-08-16）。 */
const NOW = "2026-08-16T03:00:00.000Z";

describe("createManualSuggestionJob / listSuggestions (local DB)", () => {
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

  async function seed(opts: {
    plan?: string;
    subscription?: string;
    accountStatus?: string;
    withAiKey?: boolean;
  } = {}): Promise<{ uid: string; xid: string }> {
    return withTransaction(async (c: PoolClient) => {
      const uid = randomUUID();
      await c.query(
        `insert into auth.users (id, instance_id, aud, role, email)
         values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2)`,
        [uid, `${uid}@example.com`],
      );
      await c.query(
        `insert into profiles (id, email, plan, subscription_status)
         values ($1,$2,$3::plan_type,$4::subscription_status)
         on conflict (id) do update set plan = excluded.plan, subscription_status = excluded.subscription_status`,
        [uid, `${uid}@example.com`, opts.plan ?? "premium", opts.subscription ?? "active"],
      );
      const xid = (
        await c.query<{ id: string }>(
          `insert into x_accounts (user_id, x_user_id, handle, name, auth_type, status)
           values ($1,$2,'h','n','byok',$3::x_account_status) returning id`,
          [uid, `x-${randomUUID()}`, opts.accountStatus ?? "active"],
        )
      ).rows[0].id;
      if (opts.withAiKey) {
        await c.query(
          `insert into user_api_keys (user_id, provider, credentials_ciphertext, status)
           values ($1,'anthropic','sealed','valid')`,
          [uid],
        );
      }
      return { uid, xid };
    });
  }

  const cleanup = (uid: string) => withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));

  const start = (uid: string, xid: string, nowIso = NOW) =>
    createManualSuggestionJob(pooledDb, { nowIso, userId: uid, xAccountId: xid });

  async function jobsFor(xid: string): Promise<{ trigger: string; request_key: string; status: string }[]> {
    return (
      await pooledDb.query<{ trigger: string; request_key: string; status: string }>(
        `select trigger::text as trigger, request_key, status from generation_jobs
          where x_account_id = $1 and kind = 'suggestion' order by created_at`,
        [xid],
      )
    ).rows;
  }

  it("対象アカウントのjobを trigger='manual'・1日1回の冪等キーで1件作る", async () => {
    const { uid, xid } = await seed({ plan: "premium" });
    try {
      const res = await start(uid, xid);
      expect(res.ok).toBe(true);
      expect(res.jobId).toBeTruthy();
      const jobs = await jobsFor(xid);
      expect(jobs).toHaveLength(1);
      expect(jobs[0].trigger).toBe("manual");
      expect(jobs[0].request_key).toBe(`sug-manual:${xid}:2026-08-16`);
      expect(jobs[0].status).toBe("queued");
    } finally {
      await cleanup(uid);
    }
  });

  it("実行中（queued/running）にもう一度押すと already_running を返し、2件にならない", async () => {
    const { uid, xid } = await seed({ plan: "premium" });
    try {
      await start(uid, xid);
      const res = await start(uid, xid);
      expect(res).toEqual({ ok: false, reason: "already_running" });
      expect(await jobsFor(xid)).toHaveLength(1);
    } finally {
      await cleanup(uid);
    }
  });

  it("当日分が完了済みなら already_done_today を返す（費用の上限＝1日1回）", async () => {
    const { uid, xid } = await seed({ plan: "premium" });
    try {
      const first = await start(uid, xid);
      await pooledDb.query(
        `update generation_jobs set status = 'succeeded', finished_at = now() where id = $1`,
        [first.jobId],
      );
      const res = await start(uid, xid);
      expect(res).toEqual({ ok: false, reason: "already_done_today" });
      expect(await jobsFor(xid)).toHaveLength(1);

      // 翌日は冪等キーの日付が変わるので、また作れる。
      const nextDay = await start(uid, xid, "2026-08-17T03:00:00.000Z");
      expect(nextDay.ok).toBe(true);
      expect(await jobsFor(xid)).toHaveLength(2);
    } finally {
      await cleanup(uid);
    }
  });

  it("前日のjobがまだactiveなら already_running（「activeなsuggestionは1件」のpartial-unique）", async () => {
    const { uid, xid } = await seed({ plan: "premium" });
    try {
      // 前日に起票され回収待ちのままのjob（冪等キーの日付は昨日）。
      await pooledDb.query(
        `insert into generation_jobs (x_account_id, kind, trigger, request_key, status)
         values ($1, 'suggestion', 'manual', $2, 'queued')`,
        [xid, `sug-manual:${xid}:2026-08-15`],
      );
      const res = await start(uid, xid);
      expect(res).toEqual({ ok: false, reason: "already_running" });
      expect(await jobsFor(xid)).toHaveLength(1);
    } finally {
      await cleanup(uid);
    }
  });

  it("他人のアカウント・存在しないアカウントは not_found（所有ゲート）", async () => {
    const owner = await seed({ plan: "premium" });
    const stranger = await seed({ plan: "premium" });
    try {
      expect(await start(stranger.uid, owner.xid)).toEqual({ ok: false, reason: "not_found" });
      expect(await start(owner.uid, randomUUID())).toEqual({ ok: false, reason: "not_found" });
      expect(await jobsFor(owner.xid)).toHaveLength(0);
    } finally {
      await cleanup(owner.uid);
      await cleanup(stranger.uid);
    }
  });

  it("activeでないアカウント（expired等）は x_account_inactive", async () => {
    const { uid, xid } = await seed({ plan: "premium", accountStatus: "expired" });
    try {
      expect(await start(uid, xid)).toEqual({ ok: false, reason: "x_account_inactive" });
    } finally {
      await cleanup(uid);
    }
  });

  it("契約が無効（canceled等）は subscription_inactive", async () => {
    const { uid, xid } = await seed({ plan: "premium", subscription: "canceled" });
    try {
      expect(await start(uid, xid)).toEqual({ ok: false, reason: "subscription_inactive" });
    } finally {
      await cleanup(uid);
    }
  });

  /**
   * expert は運営キー運用で user_api_keys を持たない。ゲートが `plan = 'premium'` 固定だと
   * expert だけ分析を一切開始できない（旧・毎朝起票のレビューで検出・T-M8-168と同型）。
   */
  it("expert はAIキーなしでも開始できる（運営キー系）", async () => {
    const { uid, xid } = await seed({ plan: "expert", withAiKey: false });
    try {
      expect((await start(uid, xid)).ok).toBe(true);
    } finally {
      await cleanup(uid);
    }
  });

  it("BYOKはvalidなAIキーが無ければ api_key_required（キーがあれば開始できる）", async () => {
    const withKey = await seed({ plan: "standard", withAiKey: true });
    const withoutKey = await seed({ plan: "standard", withAiKey: false });
    try {
      expect((await start(withKey.uid, withKey.xid)).ok).toBe(true);
      expect(await start(withoutKey.uid, withoutKey.xid)).toEqual({
        ok: false,
        reason: "api_key_required",
      });
    } finally {
      await cleanup(withKey.uid);
      await cleanup(withoutKey.uid);
    }
  });

  it("listSuggestions returns only the latest succeeded job's suggestions", async () => {
    const { uid, xid } = await seed({ plan: "premium" });
    try {
      await withTransaction(async (c) => {
        const oldJob = (
          await c.query<{ id: string }>(
            `insert into generation_jobs (x_account_id, kind, trigger, status, finished_at)
             values ($1,'suggestion','manual','succeeded', now() - interval '1 day') returning id`,
            [xid],
          )
        ).rows[0].id;
        const newJob = (
          await c.query<{ id: string }>(
            `insert into generation_jobs (x_account_id, kind, trigger, status, finished_at)
             values ($1,'suggestion','manual','succeeded', now()) returning id`,
            [xid],
          )
        ).rows[0].id;
        await c.query(
          `insert into improvement_suggestions (x_account_id, source_job_id, content, evidence)
           values ($1,$2,'古いレポート','{}'::jsonb), ($1,$3,'新しいレポート','{}'::jsonb)`,
          [xid, oldJob, newJob],
        );
      });
      const rows = await listSuggestions(pooledDb, uid, xid);
      expect(rows).toHaveLength(1);
      expect(rows[0].content).toBe("新しいレポート");
    } finally {
      await cleanup(uid);
    }
  });
});
