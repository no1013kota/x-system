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

/** いまのアカウント設定（mergeの入力・T-M8-341）。 */
const SETTINGS = {
  ng: { rules: ["煽らない"], topics: ["政治"], words: [] },
  persona: { audience: "実務者", speaker: "A", value: "手順が分かる" },
  themes: { free_text: "", primary: ["ai"], secondary: [] },
  tone: {
    emoji_max_per_post: 1,
    emoji_policy: "limited",
    first_person: "私",
    hashtags_max: 0,
    sentence_style: "polite",
    thread_numbering: true,
  },
};

/** 洗練後の設定（AIが返すJSON）。発信者が具体化されている。 */
const POLISHED = JSON.stringify({
  ...SETTINGS,
  persona: { ...SETTINGS.persona, speaker: "A（現場の実務者へ、手順で説明する）" },
});

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
        `insert into x_accounts
           (user_id, x_user_id, handle, name, auth_type, base_md, base_md_version, settings)
         values ($1,$2,'h','n','byok',$3,2,$4::jsonb) returning id`,
        [uid, `x-${randomUUID()}`, BASE_MD, JSON.stringify(SETTINGS)],
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

  it("セクション1〜4を洗練して版・履歴・ソース確定を同じtxで書く（5〜6は不変）", async () => {
    const s = await withTransaction((c) => seed(c));
    try {
      const res = await executeMdMerge(deps(s.jobId, POLISHED), { confirmSourceId: s.sourceId });
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
      // 反映先はセクション1〜4（T-M8-336）。5〜6と前文はバイト単位で残る。
      expect(acct.base_md).toContain("- 発信者: A（現場の実務者へ、手順で説明する）");
      expect(acct.base_md).toContain("# 発信定義書");
      expect(acct.base_md).toContain("## 5. 文体・自分らしさ\n旧5");
      expect(acct.base_md).toContain("## 6. 参考にする型\n旧6");

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

  /**
   * 反映merge（T-M8-349・運営者の指示 2026-08-28）。
   *
   * **押した瞬間に本番の設定を書き換えない。** 参考ソースからの反映は保存前の提案として
   * `settings_proposal` に置き、利用者が確認して保存したときに確定する。
   * これを取り違えると「見る前に設定が変わっていた」に戻る。
   */
  it("proposalOnly: settings_proposal だけに書き、settings・base_md・版は変えない", async () => {
    const s = await withTransaction((c) => seed(c));
    try {
      await executeMdMerge(deps(s.jobId, POLISHED), { proposalOnly: true });

      const acct = (
        await withTransaction((c) =>
          c.query<{
            base_md: string;
            base_md_version: number;
            settings: { persona: { speaker: string } };
            settings_proposal: { persona: { speaker: string } } | null;
          }>(
            `select base_md, base_md_version, settings, settings_proposal from x_accounts where id = $1`,
            [s.xid],
          ),
        )
      ).rows[0];
      // 提案だけが入る。
      expect(acct.settings_proposal?.persona.speaker).toBe("A（現場の実務者へ、手順で説明する）");
      // 保存済みの設定・アカウント.md・版は動かない（保存で初めて変わる）。
      expect(acct.settings.persona.speaker).toBe(SETTINGS.persona.speaker);
      expect(acct.base_md_version).toBe(2);
      expect(acct.base_md).toBe(BASE_MD);

      // 版を積まない（まだ何も確定していないので履歴に残す出来事が無い）。
      const versions = (
        await withTransaction((c) =>
          c.query<{ n: string }>(`select count(*)::text as n from base_md_versions where x_account_id = $1`, [
            s.xid,
          ]),
        )
      ).rows[0];
      expect(versions.n).toBe("0");
    } finally {
      await withTransaction((c) => c.query(`delete from base_md_versions where x_account_id = $1`, [s.xid]));
      await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [s.uid]));
    }
  });

  it("removal path: rebuilds the target section, sets source removed(removed_at), preserves the other section", async () => {
    const seeded = await withTransaction(async (c) => {
      // 独自アカウント（seed の running learning_analysis job と競合しないよう別立て）。
      const uid = randomUUID();
      await c.query(
        `insert into auth.users (id, instance_id, aud, role, email)
         values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2)`,
        [uid, `${uid}@example.com`],
      );
      await c.query(`insert into profiles (id, email) values ($1,$2) on conflict (id) do nothing`, [uid, `${uid}@example.com`]);
      const xid = (
        await c.query<{ id: string }>(
          `insert into x_accounts
             (user_id, x_user_id, handle, name, auth_type, base_md, base_md_version, settings)
           values ($1,$2,'h','n','byok',$3,2,$4::jsonb) returning id`,
          [uid, `x-${randomUUID()}`, BASE_MD, JSON.stringify(SETTINGS)],
        )
      ).rows[0].id;
      // remove a ref_post source (→ §6). status must be 'removing' (set by removeLearningSource).
      const removed = (
        await c.query<{ id: string }>(
          `insert into learning_sources (x_account_id, type, url, status, analysis_summary)
           values ($1,'ref_post','https://x.com/a/status/1','removing',$2::jsonb) returning id`,
          [xid, JSON.stringify({ type: "ref_post", gone: true })],
        )
      ).rows[0].id;
      const mergeJob = (
        await c.query<{ id: string }>(
          `insert into generation_jobs (x_account_id, kind, trigger, learning_source_id, status)
           values ($1,'md_merge','manual',$2,'running') returning id`,
          [xid, removed],
        )
      ).rows[0].id;
      return { uid, xid, removed, mergeJob };
    });
    try {
      const res = await executeMdMerge(deps(seeded.mergeJob, POLISHED), { removedSourceId: seeded.removed });
      expect(res.section).toBe("profile");

      const acct = (
        await withTransaction((c) =>
          c.query<{ base_md: string; base_md_version: number }>(`select base_md, base_md_version from x_accounts where id = $1`, [seeded.xid]),
        )
      ).rows[0];
      expect(acct.base_md_version).toBe(3);
      expect(acct.base_md).toContain("- 発信者: A（現場の実務者へ、手順で説明する）"); // 1〜4が書き直された
      expect(acct.base_md).toContain("## 5. 文体・自分らしさ\n旧5"); // 5〜6は不変
      expect(acct.base_md).toContain("## 6. 参考にする型\n旧6");

      const rm = (
        await withTransaction((c) =>
          c.query<{ status: string; removed_at: string | null }>(`select status::text as status, removed_at from learning_sources where id = $1`, [seeded.removed]),
        )
      ).rows[0];
      expect(rm.status).toBe("removed");
      expect(rm.removed_at).not.toBeNull();
    } finally {
      await withTransaction((c) => c.query(`delete from base_md_versions where x_account_id = $1`, [seeded.xid]));
      await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [seeded.uid]));
    }
  });
});
