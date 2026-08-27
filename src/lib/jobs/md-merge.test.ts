import { describe, expect, it } from "vitest";

import { emptyUsage, type TextGen } from "../ai/types";
import type { Queryable } from "../x/token-refresh";
import { executeMdMerge, MdMergeConflictError, MdMergeStructureError } from "./md-merge";

const JOB_META = /select gj\.x_account_id, gj\.kind::text as kind, xa\.user_id, p\.plan/;
const LOAD_REMOVED = /select analysis_summary from learning_sources where id = \$1/;
const LOAD_ACCT = /select base_md, base_md_version from x_accounts/;
const LOAD_ANALYSES = /from learning_sources[\s\S]*analysis_summary is not null/;
const UPDATE_ACCT = /update x_accounts set base_md = \$2, base_md_version = \$3/;
const INSERT_VERSION = /insert into base_md_versions/;
const CONFIRM = /update learning_sources set status = 'analyzed'/;
const REMOVED_UPDATE = /update learning_sources set status = 'removed'/;

const BASE_MD = `# 発信定義書（アカウント.md）

## 1. ペルソナ
- 発信者: A

## 2. 発信テーマ
- 主テーマ: AI

## 3. トーン&マナー
- 文末: です・ます調

## 4. やらないこと
- 煽らない

## 5. 文体・自分らしさ
旧セクション5

## 6. 参考にする型
旧セクション6
`;

/** 洗練後のセクション1〜4（見出し4つを順番どおり含むのが新しい規約・T-M8-336）。 */
const POLISHED = `## 1. ペルソナ
- 発信者: A（実務者向けに具体例で説明する）

## 2. 発信テーマ
- 主テーマ: AI

## 3. トーン&マナー
- 文末: です・ます調

## 4. やらないこと
- 煽らない`;

function textGen(body: string): TextGen {
  return {
    generate: async () => ({
      provider: "anthropic",
      requestId: "r",
      text: body,
      citations: [],
      usage: emptyUsage(),
      stopReason: "end_turn",
    }),
  };
}

interface DbOpts {
  version?: number;
  analyses?: { analysis_summary: unknown }[];
  removedAnalysis?: unknown; // removedSourceId の analysis_summary
  updateRowCounts?: number[];
}

function mockDb(opts: DbOpts) {
  const writes: { sql: string; params: unknown[] }[] = [];
  let updateIdx = 0;
  let acctVersion = opts.version ?? 1;
  const db: Queryable = {
    query: async <T = unknown>(sql: string, params: unknown[] = []) => {
      writes.push({ sql, params });
      if (JOB_META.test(sql)) return { rows: [{ x_account_id: "xa1", kind: "learning_analysis", user_id: "u1", plan: "md" }] as T[], rowCount: 1 };
      if (LOAD_REMOVED.test(sql))
        return { rows: (opts.removedAnalysis ? [{ analysis_summary: opts.removedAnalysis }] : []) as T[], rowCount: opts.removedAnalysis ? 1 : 0 };
      if (LOAD_ACCT.test(sql)) return { rows: [{ base_md: BASE_MD, base_md_version: acctVersion }] as T[], rowCount: 1 };
      if (LOAD_ANALYSES.test(sql)) return { rows: (opts.analyses ?? []) as T[], rowCount: (opts.analyses ?? []).length };
      if (UPDATE_ACCT.test(sql)) {
        const rc = opts.updateRowCounts ? (opts.updateRowCounts[updateIdx] ?? 1) : 1;
        updateIdx += 1;
        if (rc === 0) acctVersion += 1; // 競合: 別txがversionを進めた
        return { rows: [] as T[], rowCount: rc };
      }
      return { rows: [] as T[], rowCount: 1 };
    },
  };
  return { db, writes };
}

function deps(db: Queryable, gen: TextGen) {
  return {
    db,
    jobId: "job1",
    runInTx: <T>(fn: (tx: Queryable) => Promise<T>) => fn(db),
    resolveProvider: async () => ({ textGen: gen, provider: "anthropic" as const, model: "m" }),
    recordStage: async () => {},
    makeDeadline: () => ({ remainingMs: () => 90_000, canStartCall: () => true, callTimeoutMs: () => 90_000 }),
  };
}

describe("executeMdMerge", () => {
  /**
   * T-M8-336。**反映先はセクション1〜4**（5〜6ではない）。
   * 5〜6と前文はバイト単位で保持する——ここを書き換えると、利用者が手で書いた
   * 文体メモや参考型が学習のたびに消えることになる。
   */
  it("セクション1〜4を洗練し、前文と5〜6はそのまま残す（版と確定も同じtx）", async () => {
    const { db, writes } = mockDb({
      version: 3,
      analyses: [{ analysis_summary: { type: "ref_account", tone: "casual" } }],
    });
    const res = await executeMdMerge(deps(db, textGen(POLISHED)), { confirmSourceId: "s6" });
    expect(res).toEqual({ version: 4, section: "profile" });

    const upd = writes.find((w) => UPDATE_ACCT.test(w.sql))!;
    const newBaseMd = upd.params[1] as string;
    expect(newBaseMd).toContain("# 発信定義書（アカウント.md）"); // 前文は保持
    expect(newBaseMd).toContain("- 発信者: A（実務者向けに具体例で説明する）"); // 1〜4は洗練後
    expect(newBaseMd).toContain("## 5. 文体・自分らしさ\n旧セクション5"); // 5〜6は不変
    expect(newBaseMd).toContain("## 6. 参考にする型\n旧セクション6");
    expect(upd.params[2]).toBe(4);
    expect(upd.params[3]).toBe(3); // expected version guard

    expect(writes.some((w) => INSERT_VERSION.test(w.sql) && w.sql.includes("'learning'"))).toBe(true);
    expect(writes.some((w) => CONFIRM.test(w.sql))).toBe(true);
  });

  it("参考ソースの種別で分けない（全ソースの分析をまとめて1回で反映する）", async () => {
    const { db, writes } = mockDb({
      version: 1,
      analyses: [{ analysis_summary: { type: "ref_account" } }, { analysis_summary: { type: "ref_post" } }],
    });
    const res = await executeMdMerge(deps(db, textGen(POLISHED)), { confirmSourceId: "s6" });
    expect(res.section).toBe("profile");
    // 集める側でtypeを絞っていない（絞ると片方の学習が反映されない）。
    const load = writes.find((w) => LOAD_ANALYSES.test(w.sql))!;
    expect(load.sql).not.toContain("type::text = any");
  });

  it("removal path: excludes the removed source, passes it as <removed>, and sets it removed", async () => {
    const { db, writes } = mockDb({
      version: 2,
      analyses: [{ analysis_summary: { type: "ref_account", keep: true } }],
      removedAnalysis: { type: "ref_post", gone: true },
    });
    const res = await executeMdMerge(deps(db, textGen(POLISHED)), { removedSourceId: "srm" });
    expect(res.section).toBe("profile");
    expect(writes.some((w) => REMOVED_UPDATE.test(w.sql))).toBe(true); // source removed in same tx
    expect(writes.some((w) => CONFIRM.test(w.sql))).toBe(false); // not a confirm path
    const ver = writes.find((w) => INSERT_VERSION.test(w.sql))!;
    expect(ver.params[3]).toContain("削除"); // summary mentions deletion
  });

  it("re-merges from the latest version on a conflict without losing the concurrent change", async () => {
    const { db, writes } = mockDb({ version: 5, analyses: [{ analysis_summary: {} }], updateRowCounts: [0, 1] });
    const res = await executeMdMerge(deps(db, textGen(POLISHED)), { confirmSourceId: "s1" });
    expect(res.version).toBe(7); // re-read bumped to 6 → write 7
    expect(writes.filter((w) => LOAD_ACCT.test(w.sql)).length).toBe(2);
    expect(writes.filter((w) => UPDATE_ACCT.test(w.sql)).length).toBe(2);
  });

  it("throws MdMergeConflictError when conflicts exhaust the retry budget", async () => {
    const { db } = mockDb({ version: 1, analyses: [{ analysis_summary: {} }], updateRowCounts: [0, 0, 0] });
    await expect(
      executeMdMerge({ ...deps(db, textGen(POLISHED)), maxRetries: 2 }, { confirmSourceId: "s1" }),
    ).rejects.toBeInstanceOf(MdMergeConflictError);
  });

  it("throws MdMergeConflictError (retryable) when the deadline has no headroom", async () => {
    const { db } = mockDb({ version: 1, analyses: [{ analysis_summary: {} }] });
    const d = {
      ...deps(db, textGen(POLISHED)),
      makeDeadline: () => ({ remainingMs: () => 0, canStartCall: () => false, callTimeoutMs: () => 0 }),
    };
    await expect(executeMdMerge(d, { confirmSourceId: "s1" })).rejects.toBeInstanceOf(MdMergeConflictError);
  });

  /** 見出しが揃わない出力は落とす（差し替え後に6見出し構造が壊れるのを手前で止める）。 */
  it("見出しが1〜4で揃わない出力は、1回直してもだめなら構造エラー", async () => {
    const { db } = mockDb({ version: 1, analyses: [{ analysis_summary: {} }] });
    await expect(
      executeMdMerge(deps(db, textGen("## 1. ペルソナ\n- A\n\n## 5. 混入\nbad")), {
        confirmSourceId: "s1",
      }),
    ).rejects.toBeInstanceOf(MdMergeStructureError);
  });

  it("rejects an empty merge output when the section had content/analyses (no silent wipe)", async () => {
    const { db } = mockDb({ version: 1, analyses: [{ analysis_summary: { tone: "x" } }] });
    await expect(
      executeMdMerge(deps(db, textGen("   ")), { confirmSourceId: "s1" }),
    ).rejects.toBeInstanceOf(MdMergeStructureError);
  });
});
