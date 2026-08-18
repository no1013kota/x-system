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

const LOAD_JOB = /select gj\.pattern_id, gj\.pattern_spec/;
const EXISTING = /select id from drafts where source_job_id/;
const RECENT = /select thread from drafts/;
const TEMPLATES = /from prompt_templates/;
const INSERT_DRAFT = /insert into drafts/;
const INSERT_JOB = /insert into generation_jobs/;
const NOTIFY = /insert into notifications/;
const LEDGER = /insert into external_api_usage_events/;

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

/** `pattern_spec_of()` が返す形（T-M8-129 U2）。生成の振る舞いはすべてここから決まる。 */
function patternSpec(over: Record<string, unknown> = {}) {
  return {
    id: "pat-p2",
    seed_key: "p2",
    name: "自分の考え・意見",
    description: null,
    prompt: null,
    max_posts: 1,
    max_posts_edit: 1,
    web_search_policy: "with_url",
    web_search_max_uses: 2,
    source_policy: "with_url",
    include_news_digest: false,
    requires_quote_url: false,
    ...over,
  };
}

function jobRow(imageEnabled: boolean, mode?: "draft" | "auto") {
return {
    pattern_id: "pat-p2",
    pattern_spec: patternSpec(),
    trigger: "manual",
    input: { image_enabled: imageEnabled, ...(mode ? { mode } : {}) },
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
      // override（T-M8-93）が無い通常の生成では '{}'。NOT NULL列なので null を渡してはならない
      // （2026-08-15 に smoke:live で制約違反として検出）。
      "{}",
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
    // T-M6-09: 成功した provider call 1回につき原価台帳へ1行（冪等key gen:{jobId}:{seq}）。
    const ledger = writes.filter((w) => LEDGER.test(w.sql));
    expect(ledger).toHaveLength(1);
    expect(ledger[0].params[13]).toBe("gen:job-x:0");
  });

/**
   * T-M8-143。**auto は生成成功後に投稿へ進む。**
   *
   * ここが無かったため `mode=auto` の予約は下書きを作るだけで投稿されていなかった
   * （`post_publish` を作っていたのは手動投稿と画像失敗の回収の2箇所だけ）。
   */
  it("画像OFFのautoは post_publish を作り、draft_created は送らない", async () => {
    const { db, writes } = makeDb((sql) => {
      if (LOAD_JOB.test(sql)) return [jobRow(false, "auto")];
      if (EXISTING.test(sql)) return [];
      if (RECENT.test(sql)) return [];
      if (TEMPLATES.test(sql)) return [];
      if (INSERT_DRAFT.test(sql)) return [{ id: "draft1" }];
      return [];
    });

    await executePostGeneration(deps(db));
    const PUB_INSERT = /insert into generation_jobs[\s\S]*'post_publish'/;
    const pub = writes.find((w) => PUB_INSERT.test(w.sql));
    expect(pub, "post_publish が作られていない").toBeDefined();
    // **draft単位の冪等key**（経路をまたいで衝突させ、二重投稿を防ぐ）。
    expect(pub!.params).toContain("job:draft1:post_publish:auto");
    // 投稿されるので「下書きができました」は送らない（誤った案内になる）。
    expect(writes.some((w) => NOTIFY.test(w.sql)), "draft_created を送っている").toBe(false);
  });

  it("画像OFFの draft は従来どおり通知だけ（勝手に投稿しない）", async () => {
    const { db, writes } = makeDb((sql) => {
      if (LOAD_JOB.test(sql)) return [jobRow(false, "draft")];
      if (EXISTING.test(sql)) return [];
      if (RECENT.test(sql)) return [];
      if (TEMPLATES.test(sql)) return [];
      if (INSERT_DRAFT.test(sql)) return [{ id: "draft1" }];
      return [];
    });

    await executePostGeneration(deps(db));
    expect(
      writes.some((w) => /insert into generation_jobs[\s\S]*'post_publish'/.test(w.sql)),
      "投稿jobを作っている",
    ).toBe(false);
    expect(writes.some((w) => NOTIFY.test(w.sql))).toBe(true);
  });

  it("画像ONのautoは子jobへ mode を引き継ぐ（子が投稿へ進めるように）", async () => {
    const { db, writes } = makeDb((sql) => {
      if (LOAD_JOB.test(sql)) return [jobRow(true, "auto")];
      if (EXISTING.test(sql)) return [];
      if (RECENT.test(sql)) return [];
      if (TEMPLATES.test(sql)) return [];
      if (INSERT_DRAFT.test(sql)) return [{ id: "draft1" }];
      return [];
    });

    await executePostGeneration(deps(db));
    const child = writes.find((w) => INSERT_JOB.test(w.sql));
    expect(child?.params[3]).toBe("parent:job-x:image_generation:draft1");
    // 子は親のinputを見られないので、mode を input へ入れて渡す。
    expect(String(child?.params[4])).toContain('"mode":"auto"');
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
      if (LOAD_JOB.test(sql)) {
        return [
          {
          ...jobRow(false),
            pattern_id: "pat-p5",
            // 引用ポスト（引用URLが必須）＝ flag OFF の間は実行前に canceled にする。
            pattern_spec: patternSpec({
              id: "pat-p5",
              seed_key: "p5",
              name: "引用ポスト",
              max_posts: 3,
              max_posts_edit: 3,
              web_search_policy: "never",
              web_search_max_uses: 0,
              source_policy: "never",
              requires_quote_url: true,
            }),
          },
        ];
      }
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
