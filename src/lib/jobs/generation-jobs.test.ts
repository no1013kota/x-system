import { describe, expect, it } from "vitest";

import { AppError } from "@/lib/observability/errors";
import type { ExecutionPrereqInput } from "@/lib/execution-prereqs";

import {
  cancelGenerationJob,
  createGenerationJob,
  getGenerationJob,
  regenerateDraft,
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
