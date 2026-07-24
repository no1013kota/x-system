import { describe, expect, it } from "vitest";

import { AppError } from "@/lib/observability/errors";
import type { ExecutionPrereqInput } from "@/lib/execution-prereqs";

import {
  cancelGenerationJob,
  createDraftFromNews,
  createGenerationJob,
  getGenerationJob,
  publishDraft,
  regenerateDraft,
  regenerateImage,
  retryGenerationJob,
  type CreateGenerationJobInput,
  type GenerationJobDeps,
} from "./generation-jobs";
import type { Queryable } from "../x/token-refresh";

type Row = Record<string, unknown>;

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

const EXISTING = /select id from generation_jobs where request_key/;
const ACCOUNT = /from x_accounts xa join profiles/;
const BUDGET = /count\(\*\)::int as n from generation_jobs/;
const INSERT = /insert into generation_jobs/;
const RETRY_LOAD = /select gj\.status, gj\.kind, gj\.pattern/;
const CANCEL_LOAD = /select gj\.status from generation_jobs/;

async function rejection(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    return e as AppError;
  }
  throw new Error("expected the promise to reject");
}

const okPrereq = (): ExecutionPrereqInput => ({
  plan: "standard",
  subscriptionStatus: "active",
  xApiKeyStatus: "valid",
  hasActiveXAccount: true,
  textAiKeyValid: true,
  imageRequested: false,
  imageAiKeyValid: false,
  baseMdVersion: 1,
});

function deps(db: Queryable, over: Partial<GenerationJobDeps> = {}): GenerationJobDeps {
  return {
    runInTx: (fn) => fn(db),
    gatherPrereqInputs: async () => okPrereq(),
    quotePostEnabled: false,
    ...over,
  };
}

const XID = "11111111-1111-1111-1111-111111111111";
const input = (over: Partial<CreateGenerationJobInput> = {}): CreateGenerationJobInput => ({
  request_key: "tok-1",
  x_account_id: XID,
  pattern: "p1",
  image_enabled: false,
  ...over,
} as CreateGenerationJobInput);

describe("createGenerationJob", () => {
  it("creates a queued job when all checks pass", async () => {
    const { db, writes } = makeDb((sql) => {
      if (EXISTING.test(sql)) return [];
      if (ACCOUNT.test(sql)) return [{ status: "active", active_x_account_id: XID }];
      if (BUDGET.test(sql)) return [{ n: 0 }];
      if (INSERT.test(sql)) return [{ id: "job-new" }];
      return [];
    });
    const res = await createGenerationJob("u1", input(), deps(db));
    expect(res).toEqual({ jobId: "job-new", deduped: false });
    expect(writes.some((w) => INSERT.test(w.sql))).toBe(true);
  });

  it("returns the existing job for a duplicate request_key (idempotent)", async () => {
    const { db, writes } = makeDb((sql) => (EXISTING.test(sql) ? [{ id: "job-old" }] : []));
    const res = await createGenerationJob("u1", input(), deps(db));
    expect(res).toEqual({ jobId: "job-old", deduped: true });
    expect(writes.some((w) => INSERT.test(w.sql))).toBe(false);
  });

  it("rejects P-5 while the feature flag is off", async () => {
    const { db } = makeDb(() => []);
    await expect(
      createGenerationJob("u1", input({ pattern: "p5" }), deps(db)),
    ).rejects.toMatchObject({ code: "feature_disabled" });
  });

  it("rejects when the x_account is not the active one (job_conflict)", async () => {
    const { db } = makeDb((sql) => {
      if (EXISTING.test(sql)) return [];
      if (ACCOUNT.test(sql)) return [{ status: "active", active_x_account_id: "other" }];
      return [];
    });
    const err = await rejection(createGenerationJob("u1", input(), deps(db)));
    expect(err.code).toBe("job_conflict");
    expect(err.details?.reason).toBe("x_account_mismatch");
  });

  it("surfaces prerequisite errors with code and details", async () => {
    const { db } = makeDb((sql) => {
      if (EXISTING.test(sql)) return [];
      if (ACCOUNT.test(sql)) return [{ status: "active", active_x_account_id: XID }];
      return [];
    });
    const err = await rejection(
      createGenerationJob(
        "u1",
        input(),
        deps(db, {
          gatherPrereqInputs: async () => ({ ...okPrereq(), hasActiveXAccount: false }),
        }),
      ),
    );
    expect(err.code).toBe("x_account_required");
    expect(err.details?.settingsPath).toBe("/app/settings?tab=x-accounts");
  });

  it("rejects when 5 jobs are already queued/running", async () => {
    const { db } = makeDb((sql) => {
      if (EXISTING.test(sql)) return [];
      if (ACCOUNT.test(sql)) return [{ status: "active", active_x_account_id: XID }];
      if (BUDGET.test(sql)) return [{ n: 5 }];
      return [];
    });
    const err = await rejection(createGenerationJob("u1", input(), deps(db)));
    expect(err.code).toBe("job_conflict");
    expect(err.details?.reason).toBe("too_many_active_jobs");
  });
});

describe("retryGenerationJob", () => {
  it("creates a parent-linked job for a failed job", async () => {
    const { db, writes } = makeDb((sql) => {
      if (EXISTING.test(sql)) return [];
      if (RETRY_LOAD.test(sql)) return [{ status: "failed", kind: "post_generation", pattern: "p1", input: {}, x_account_id: XID }];
      if (BUDGET.test(sql)) return [{ n: 0 }];
      if (INSERT.test(sql)) return [{ id: "retry-job" }];
      return [];
    });
    const res = await retryGenerationJob("u1", { job_id: "old", request_key: "tok-2" }, deps(db));
    expect(res.jobId).toBe("retry-job");
    const insert = writes.find((w) => INSERT.test(w.sql));
    expect(insert?.params).toContain("old"); // parent_job_id
  });

  it("rejects retrying a non-failed job", async () => {
    const { db } = makeDb((sql) => {
      if (EXISTING.test(sql)) return [];
      if (RETRY_LOAD.test(sql)) return [{ status: "succeeded", kind: "post_generation", pattern: "p1", input: {}, x_account_id: XID }];
      return [];
    });
    await expect(
      retryGenerationJob("u1", { job_id: "old", request_key: "tok-2" }, deps(db)),
    ).rejects.toMatchObject({ code: "job_conflict" });
  });
});

describe("regenerateDraft", () => {
  const REGEN_LOAD = /select d\.status, d\.pattern, d\.thread/;

  it("snapshots the source draft into a parent-linked job", async () => {
    const { db, writes } = makeDb((sql) => {
      if (EXISTING.test(sql)) return [];
      if (REGEN_LOAD.test(sql))
        return [
          {
            status: "draft",
            pattern: "p3",
            thread: [{ text: "元1" }, { text: "元2" }],
            x_account_id: XID,
            tweet_ids: [],
            last_post_error: null,
          },
        ];
      if (BUDGET.test(sql)) return [{ n: 0 }];
      if (INSERT.test(sql)) return [{ id: "regen-job" }];
      return [];
    });
    const res = await regenerateDraft(
      "u1",
      { request_key: "rg", draft_id: "src", additional_instructions: "改善して", image_enabled: false },
      deps(db),
    );
    expect(res.jobId).toBe("regen-job");
    const insert = writes.find((w) => INSERT.test(w.sql));
    const jobInput = JSON.parse(insert?.params[2] as string);
    expect(jobInput.parent_draft_id).toBe("src");
    expect(jobInput.previous_posts).toEqual(["元1", "元2"]);
    expect(jobInput.instructions).toBe("改善して");
    expect(jobInput.pattern).toBe("p3");
  });

  it("rejects regenerating a non-regenerable (posted) draft", async () => {
    const { db } = makeDb((sql) => {
      if (EXISTING.test(sql)) return [];
      if (REGEN_LOAD.test(sql))
        return [{ status: "posted", pattern: "p1", thread: [], x_account_id: XID, tweet_ids: [], last_post_error: null }];
      return [];
    });
    await expect(
      regenerateDraft("u1", { request_key: "rg", draft_id: "src", image_enabled: false }, deps(db)),
    ).rejects.toMatchObject({ code: "job_conflict" });
  });

  it("rejects regenerating a failed draft with unresolved posting", async () => {
    const { db } = makeDb((sql) => {
      if (EXISTING.test(sql)) return [];
      if (REGEN_LOAD.test(sql))
        return [{ status: "failed", pattern: "p1", thread: [], x_account_id: XID, tweet_ids: ["9"], last_post_error: null }];
      return [];
    });
    const err = await rejection(
      regenerateDraft("u1", { request_key: "rg", draft_id: "src", image_enabled: false }, deps(db)),
    );
    expect(err.details?.reason).toBe("unresolved_posting");
  });

  it("is idempotent on request_key", async () => {
    const { db } = makeDb((sql) => (EXISTING.test(sql) ? [{ id: "existing" }] : []));
    const res = await regenerateDraft(
      "u1",
      { request_key: "rg", draft_id: "src", image_enabled: false },
      deps(db),
    );
    expect(res).toEqual({ jobId: "existing", deduped: true });
  });
});

describe("regenerateImage", () => {
  const DRAFT_LOAD = /select d\.status, d\.pattern, d\.x_account_id/;
  const ACTIVE_IMG = /kind = 'image_generation' and status in/;

  it("creates a queued image_generation job for a regenerable draft", async () => {
    const { db, writes } = makeDb((sql) => {
      if (EXISTING.test(sql)) return [];
      if (DRAFT_LOAD.test(sql)) return [{ status: "draft", pattern: "p1", x_account_id: XID }];
      if (ACTIVE_IMG.test(sql)) return [];
      if (BUDGET.test(sql)) return [{ n: 0 }];
      if (INSERT.test(sql)) return [{ id: "img-job" }];
      return [];
    });
    const res = await regenerateImage("u1", { request_key: "ri", draft_id: "src" }, deps(db));
    expect(res).toEqual({ jobId: "img-job", deduped: false });
    const insert = writes.find((w) => INSERT.test(w.sql));
    expect(insert?.sql).toContain("image_generation");
    expect(JSON.parse(insert?.params[2] as string)).toEqual({ regenerate: true });
  });

  it("dedups to the active image job when one is already queued/running", async () => {
    const { db, writes } = makeDb((sql) => {
      if (EXISTING.test(sql)) return [];
      if (DRAFT_LOAD.test(sql)) return [{ status: "draft", pattern: "p1", x_account_id: XID }];
      if (ACTIVE_IMG.test(sql)) return [{ id: "active-1" }];
      return [];
    });
    const res = await regenerateImage("u1", { request_key: "ri", draft_id: "src" }, deps(db));
    expect(res).toEqual({ jobId: "active-1", deduped: true });
    expect(writes.some((w) => INSERT.test(w.sql))).toBe(false);
  });

  it("is idempotent on request_key", async () => {
    const { db } = makeDb((sql) => (EXISTING.test(sql) ? [{ id: "existing" }] : []));
    const res = await regenerateImage("u1", { request_key: "ri", draft_id: "src" }, deps(db));
    expect(res).toEqual({ jobId: "existing", deduped: true });
  });

  it("rejects a non-regenerable (posted) draft", async () => {
    const { db } = makeDb((sql) => {
      if (EXISTING.test(sql)) return [];
      if (DRAFT_LOAD.test(sql)) return [{ status: "posted", pattern: "p1", x_account_id: XID }];
      return [];
    });
    await expect(
      regenerateImage("u1", { request_key: "ri", draft_id: "src" }, deps(db)),
    ).rejects.toMatchObject({ code: "job_conflict" });
  });

  it("rejects regenerating an image on a P-5 draft while the flag is off", async () => {
    const { db } = makeDb((sql) => {
      if (EXISTING.test(sql)) return [];
      if (DRAFT_LOAD.test(sql)) return [{ status: "draft", pattern: "p5", x_account_id: XID }];
      return [];
    });
    await expect(
      regenerateImage("u1", { request_key: "ri", draft_id: "src" }, deps(db)),
    ).rejects.toMatchObject({ code: "feature_disabled" });
  });
});

describe("publishDraft", () => {
  const PUB_LOAD = /select d\.status, d\.pattern, d\.x_account_id, d\.tweet_ids/;
  const ACTIVE_PUB = /kind = 'post_publish' and status in/;

  const pubInput = { request_key: "pk", draft_id: "d1", mode: "manual" as const };

  it("creates a post_publish job for a draft status", async () => {
    const { db, writes } = makeDb((sql) => {
      if (EXISTING.test(sql)) return [];
      if (PUB_LOAD.test(sql)) return [{ status: "draft", pattern: "p1", x_account_id: XID, tweet_ids: [], last_post_error: null }];
      if (ACTIVE_PUB.test(sql)) return [];
      if (BUDGET.test(sql)) return [{ n: 0 }];
      if (INSERT.test(sql)) return [{ id: "pub-job" }];
      return [];
    });
    const res = await publishDraft("u1", pubInput, deps(db));
    expect(res).toEqual({ jobId: "pub-job", deduped: false });
    const insert = writes.find((w) => INSERT.test(w.sql));
    expect(insert?.sql).toContain("post_publish");
    expect(JSON.parse(insert?.params[2] as string)).toEqual({ mode: "manual" });
  });

  it("dedups to an active post_publish job", async () => {
    const { db, writes } = makeDb((sql) => {
      if (EXISTING.test(sql)) return [];
      if (PUB_LOAD.test(sql)) return [{ status: "draft", pattern: "p1", x_account_id: XID, tweet_ids: [], last_post_error: null }];
      if (ACTIVE_PUB.test(sql)) return [{ id: "active-pub" }];
      return [];
    });
    const res = await publishDraft("u1", pubInput, deps(db));
    expect(res).toEqual({ jobId: "active-pub", deduped: true });
    expect(writes.some((w) => INSERT.test(w.sql))).toBe(false);
  });

  it("is idempotent on request_key", async () => {
    const { db } = makeDb((sql) => (EXISTING.test(sql) ? [{ id: "existing" }] : []));
    expect(await publishDraft("u1", pubInput, deps(db))).toEqual({ jobId: "existing", deduped: true });
  });

  it("allows a clean retryable failed draft", async () => {
    const { db, writes } = makeDb((sql) => {
      if (EXISTING.test(sql)) return [];
      if (PUB_LOAD.test(sql)) return [{ status: "failed", pattern: "p1", x_account_id: XID, tweet_ids: [], last_post_error: null }];
      if (ACTIVE_PUB.test(sql)) return [];
      if (BUDGET.test(sql)) return [{ n: 0 }];
      if (INSERT.test(sql)) return [{ id: "pub-job" }];
      return [];
    });
    expect((await publishDraft("u1", pubInput, deps(db))).jobId).toBe("pub-job");
    expect(writes.some((w) => INSERT.test(w.sql))).toBe(true);
  });

  it("rejects a failed draft with created tweets (unresolved posting)", async () => {
    const { db } = makeDb((sql) => {
      if (EXISTING.test(sql)) return [];
      if (PUB_LOAD.test(sql)) return [{ status: "failed", pattern: "p1", x_account_id: XID, tweet_ids: ["9"], last_post_error: null }];
      return [];
    });
    const err = await rejection(publishDraft("u1", pubInput, deps(db)));
    expect(err.code).toBe("job_conflict");
    expect(err.details?.reason).toBe("unresolved_posting");
  });

  it("rejects a failed draft with remaining/ambiguous state", async () => {
    const { db } = makeDb((sql) => {
      if (EXISTING.test(sql)) return [];
      if (PUB_LOAD.test(sql))
        return [{ status: "failed", pattern: "p1", x_account_id: XID, tweet_ids: [], last_post_error: { ambiguous_create_indices: [0] } }];
      return [];
    });
    const err = await rejection(publishDraft("u1", pubInput, deps(db)));
    expect(err.details?.reason).toBe("unresolved_posting");
  });

  it("rejects a non-publishable (posted) draft", async () => {
    const { db } = makeDb((sql) => {
      if (EXISTING.test(sql)) return [];
      if (PUB_LOAD.test(sql)) return [{ status: "posted", pattern: "p1", x_account_id: XID, tweet_ids: ["9"], last_post_error: null }];
      return [];
    });
    await expect(publishDraft("u1", pubInput, deps(db))).rejects.toMatchObject({ code: "job_conflict" });
  });

  it("surfaces posting prerequisite errors (no active X account)", async () => {
    const { db } = makeDb((sql) => {
      if (EXISTING.test(sql)) return [];
      if (PUB_LOAD.test(sql)) return [{ status: "draft", pattern: "p1", x_account_id: XID, tweet_ids: [], last_post_error: null }];
      if (ACTIVE_PUB.test(sql)) return [];
      return [];
    });
    const err = await rejection(
      publishDraft("u1", pubInput, deps(db, {
        gatherPrereqInputs: async () => ({ ...okPrereq(), hasActiveXAccount: false }),
      })),
    );
    expect(err.code).toBe("x_account_required");
  });

  it("rejects publishing a P-5 draft while the feature flag is off", async () => {
    const { db } = makeDb((sql) => {
      if (EXISTING.test(sql)) return [];
      if (PUB_LOAD.test(sql))
        return [{ status: "draft", pattern: "p5", x_account_id: XID, tweet_ids: [], last_post_error: null }];
      return [];
    });
    await expect(publishDraft("u1", pubInput, deps(db))).rejects.toMatchObject({
      code: "feature_disabled",
    });
  });
});

describe("cancelGenerationJob", () => {
  it("cancels a queued job", async () => {
    const { db, writes } = makeDb((sql) => (CANCEL_LOAD.test(sql) ? [{ status: "queued" }] : []));
    expect(await cancelGenerationJob(db, "u1", "j1")).toEqual({ status: "canceled" });
    expect(writes.some((w) => /update generation_jobs set status = 'canceled'/.test(w.sql))).toBe(true);
  });

  it("rejects cancelling a running job", async () => {
    const { db } = makeDb((sql) => (CANCEL_LOAD.test(sql) ? [{ status: "running" }] : []));
    await expect(cancelGenerationJob(db, "u1", "j1")).rejects.toMatchObject({
      code: "job_conflict",
    });
  });

  it("is idempotent for an already-canceled job", async () => {
    const { db, writes } = makeDb((sql) => (CANCEL_LOAD.test(sql) ? [{ status: "canceled" }] : []));
    expect(await cancelGenerationJob(db, "u1", "j1")).toEqual({ status: "canceled" });
    expect(writes.some((w) => /update generation_jobs/.test(w.sql))).toBe(false);
  });

  it("returns not_found for a job the user does not own", async () => {
    const { db } = makeDb(() => []);
    await expect(cancelGenerationJob(db, "u1", "j1")).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("getGenerationJob", () => {
  it("returns the job for the owner", async () => {
    const { db } = makeDb(() => [{ id: "j1", kind: "post_generation", status: "queued", pattern: "p1", progress_stage: null, draft_id: null, error: null, created_at: "2026-01-01" }]);
    expect((await getGenerationJob(db, "u1", "j1")).id).toBe("j1");
  });
  it("throws not_found when not owned", async () => {
    const { db } = makeDb(() => []);
    await expect(getGenerationJob(db, "u1", "j1")).rejects.toMatchObject({ code: "not_found" });
  });
});

const NEWS_LOOKUP = /select source_url from news_items where id/;
const NID = "22222222-2222-4222-8222-222222222222";

describe("createDraftFromNews", () => {
  it("throws not_found when the news item is missing", async () => {
    const { db } = makeDb((sql) => (NEWS_LOOKUP.test(sql) ? [] : []));
    const err = await rejection(
      createDraftFromNews("u1", { request_key: "n1", x_account_id: XID, news_item_id: NID }, deps(db)),
    );
    expect(err.code).toBe("not_found");
  });

  it("creates a P-1 post_generation carrying the news source_url and news_item_id", async () => {
    const { db, writes } = makeDb((sql) => {
      if (NEWS_LOOKUP.test(sql)) return [{ source_url: "https://n.example/a" }];
      if (EXISTING.test(sql)) return [];
      if (ACCOUNT.test(sql)) return [{ status: "active", active_x_account_id: XID }];
      if (BUDGET.test(sql)) return [{ n: 0 }];
      if (INSERT.test(sql)) return [{ id: "job-news" }];
      return [];
    });
    const res = await createDraftFromNews(
      "u1",
      { request_key: "n1", x_account_id: XID, news_item_id: NID },
      deps(db),
    );
    expect(res).toEqual({ jobId: "job-news", deduped: false });
    const ins = writes.find((w) => INSERT.test(w.sql))!;
    expect(ins.params[1]).toBe("p1"); // pattern
    const inputJson = JSON.parse(ins.params[2] as string);
    expect(inputJson.source_url).toBe("https://n.example/a");
    expect(inputJson.news_item_id).toBe(NID);
  });

  it("is idempotent: an existing request_key returns the same job (deduped)", async () => {
    const { db } = makeDb((sql) => {
      if (NEWS_LOOKUP.test(sql)) return [{ source_url: "https://n.example/a" }];
      if (EXISTING.test(sql)) return [{ id: "job-existing" }];
      return [];
    });
    const res = await createDraftFromNews(
      "u1",
      { request_key: "n1", x_account_id: XID, news_item_id: NID },
      deps(db),
    );
    expect(res).toEqual({ jobId: "job-existing", deduped: true });
  });

  it("runs the image prerequisite check when image_enabled (parity with createGenerationJob)", async () => {
    let seenImageRequested = false;
    const { db } = makeDb((sql) => {
      if (NEWS_LOOKUP.test(sql)) return [{ source_url: "https://n.example/a" }];
      if (EXISTING.test(sql)) return [];
      if (ACCOUNT.test(sql)) return [{ status: "active", active_x_account_id: XID }];
      return [];
    });
    const d = deps(db, {
      gatherPrereqInputs: async (_u, opts) => {
        seenImageRequested = opts.imageRequested;
        return { ...okPrereq(), imageRequested: true, imageAiKeyValid: false };
      },
    });
    const err = await rejection(
      createDraftFromNews(
        "u1",
        { request_key: "n1", x_account_id: XID, news_item_id: NID, image_enabled: true },
        d,
      ),
    );
    expect(seenImageRequested).toBe(true);
    expect(err.details?.settingsPath).toBeDefined();
  });
});

const REMOVING = /from learning_sources[\s\S]*status = 'removing'/;

describe("createGenerationJob — learning removal guard (T-M5-05)", () => {
  it("rejects new generation while a learning source is being removed", async () => {
    const { db } = makeDb((sql) => {
      if (EXISTING.test(sql)) return [];
      if (ACCOUNT.test(sql)) return [{ status: "active", active_x_account_id: XID }];
      if (REMOVING.test(sql)) return [{ "?column?": 1 }];
      return [];
    });
    const err = await rejection(createGenerationJob("u1", input(), deps(db)));
    expect(err.code).toBe("job_conflict");
    expect(err.details?.reason).toBe("learning_removing");
  });
});
