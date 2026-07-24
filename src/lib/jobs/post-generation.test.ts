import { describe, expect, it, vi } from "vitest";

import type { ExecutionPrereqInput } from "@/lib/execution-prereqs";

import { emptyUsage, type TextGen } from "../ai/types";
import type { Queryable } from "../x/token-refresh";
import { createDeadline } from "./deadline";
import { executePostGeneration, type PostGenerationDeps } from "./post-generation";

/**
 * post_generation の「画像ONで image_generation 子jobへ連鎖する」経路の単体検証（T-M3-15）。
 * 生成本体の広いハッピーパス/失敗系は post-generation.db.test.ts（実DB）が担う。ここでは
 * 子job作成の決定的key・冪等（on conflict）と、画像ON時に draft_created を送らないことを確認する。
 */

type Row = Record<string, unknown>;

const LOAD_JOB = /select gj\.pattern, gj\.trigger/;
const EXISTING = /select id from drafts where source_job_id/;
const RECENT = /select thread from drafts/;
const TEMPLATES = /from prompt_templates/;
const INSERT_DRAFT = /insert into drafts/;
const INSERT_JOB = /insert into generation_jobs/;
const NOTIFY = /insert into notifications/;

function makeDb(handler: (sql: string, params: unknown[]) => Row[]) {
  const writes: { sql: string; params: unknown[] }[] = [];
  const db: Queryable = {
    query: async <T = unknown>(sql: string, params: unknown[] = []) => {
      writes.push({ sql, params });
      const rows = handler(sql, params) as T[];
      return { rows, rowCount: rows.length };
    },
  };
  return { db, writes };
}

const okPrereq = (): ExecutionPrereqInput => ({
  plan: "premium",
  subscriptionStatus: "active",
  xApiKeyStatus: "valid",
  hasActiveXAccount: true,
  textAiKeyValid: true,
  imageRequested: true,
  imageAiKeyValid: true,
  baseMdVersion: 1,
});

const textGen: TextGen = {
  generate: vi.fn(async () => ({
    provider: "anthropic" as const,
    requestId: null,
    text: '{"posts":["本人の考えを述べる短い単発ポスト"],"sources":[],"error":null}',
    citations: [],
    usage: emptyUsage(),
    stopReason: null,
  })),
};

function deps(db: Queryable): PostGenerationDeps {
  return {
    db,
    jobId: "job-x",
    runInTx: (fn) => fn(db),
    resolveProvider: async () => ({ textGen, provider: "anthropic", model: "claude-x" }),
    gatherPrereqInputs: async () => okPrereq(),
    validateSource: async () => true,
    recordStage: async () => {},
    makeDeadline: () => createDeadline(),
  };
}

function jobRow(imageEnabled: boolean) {
  return {
    pattern: "p2",
    trigger: "manual",
    input: { image_enabled: imageEnabled },
    x_account_id: "xacc1",
    user_id: "user1",
    base_md: "## 1. a\n## 2. b\n## 3. c\n## 4. d\n## 5. e\n## 6. f",
    settings: { ng: { words: [] } },
    plan: "premium",
  };
}

describe("executePostGeneration image chain", () => {
  it("creates a deterministic image_generation child job and skips draft_created when image is ON", async () => {
    const { db, writes } = makeDb((sql) => {
      if (LOAD_JOB.test(sql)) return [jobRow(true)];
      if (EXISTING.test(sql)) return [];
      if (RECENT.test(sql)) return [];
      if (TEMPLATES.test(sql)) return [];
      if (INSERT_DRAFT.test(sql)) return [{ id: "draft1" }];
      return [];
    });

    const res = await executePostGeneration(deps(db));
    expect(res).toEqual({ status: "created", draftId: "draft1" });

    const child = writes.find((w) => INSERT_JOB.test(w.sql));
    expect(child?.sql).toContain("image_generation");
    expect(child?.sql).toContain("on conflict (request_key) do nothing");
    expect(child?.params).toEqual([
      "xacc1",
      "job-x",
      "draft1",
      "parent:job-x:image_generation:draft1",
    ]);
    // 画像ON: draft_created は子（image_generation）が送るのでここでは送らない
    expect(writes.some((w) => NOTIFY.test(w.sql))).toBe(false);
  });

  it("sends draft_created and creates no child job when image is OFF", async () => {
    const { db, writes } = makeDb((sql) => {
      if (LOAD_JOB.test(sql)) return [jobRow(false)];
      if (EXISTING.test(sql)) return [];
      if (RECENT.test(sql)) return [];
      if (TEMPLATES.test(sql)) return [];
      if (INSERT_DRAFT.test(sql)) return [{ id: "draft1" }];
      return [];
    });

    await executePostGeneration(deps(db));
    expect(writes.some((w) => INSERT_JOB.test(w.sql))).toBe(false);
    expect(writes.some((w) => NOTIFY.test(w.sql))).toBe(true);
  });

  it("ensures the child job even on the idempotent already-done path when image is ON", async () => {
    const { db, writes } = makeDb((sql) => {
      if (LOAD_JOB.test(sql)) return [jobRow(true)];
      if (EXISTING.test(sql)) return [{ id: "draft1" }]; // draft already exists
      return [];
    });

    const res = await executePostGeneration(deps(db));
    expect(res).toEqual({ status: "already_done", draftId: "draft1" });
    const child = writes.find((w) => INSERT_JOB.test(w.sql));
    expect(child?.params[3]).toBe("parent:job-x:image_generation:draft1");
  });
});

describe("executePostGeneration P-5 feature flag off", () => {
  it("cancels a queued P-5 job before external/quota when the flag is off", async () => {
    const { db, writes } = makeDb((sql) => {
      if (LOAD_JOB.test(sql)) return [{ ...jobRow(false), pattern: "p5" }];
      return [];
    });
    await expect(
      executePostGeneration({ ...deps(db), quotePostEnabled: false }),
    ).rejects.toMatchObject({ code: "feature_disabled" });
    // canceled 化し、下書き・provider は呼ばない
    expect(writes.some((w) => /status = 'canceled'/.test(w.sql))).toBe(true);
    expect(writes.some((w) => INSERT_DRAFT.test(w.sql))).toBe(false);
  });
});
