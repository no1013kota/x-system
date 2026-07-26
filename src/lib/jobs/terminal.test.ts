import { describe, expect, it } from "vitest";
import type { PoolClient } from "pg";

import { AppError, userMessageForCode } from "@/lib/observability/errors";

import { fallbackJobError, finalizeFailedJob } from "./terminal";

type Row = Record<string, unknown>;

const LOAD_JOB = /coalesce\(gj\.input->>'mode', pj\.input->>'mode'\)/;
const REFUND = /insert into usage_events/;
const COUNTER = /update usage_counters/;
const NOTIF_ERROR = /insert into notifications[\s\S]*?'error', \$2/;
const NOTIF_DRAFT = /'draft_created', \$2/;
const PUBLISH_FAIL = /update drafts\s+set status = 'failed', last_post_error/;
const MD_MERGE = /update learning_sources set status = 'analyzed'/;
const IMAGE_MARK = /update drafts\s+set images = jsonb_build_array/;
const CHILD = /insert into generation_jobs/;
const CHILD_ACTIVE = /select 1 from generation_jobs\s+where draft_id = \$1 and kind = 'post_publish'/;

function makeDb(handler: (sql: string) => { rows?: Row[]; rowCount?: number }) {
  const writes: { sql: string; params: unknown[] }[] = [];
  const db = {
    query: async (sql: string, params: unknown[] = []) => {
      writes.push({ sql, params });
      const r = handler(sql);
      return { rows: r.rows ?? [], rowCount: r.rowCount ?? r.rows?.length ?? 0 };
    },
  } as unknown as PoolClient;
  return { db, writes };
}

const jobRow = (over: Partial<Row> = {}): Row => ({
  draft_id: "d1",
  learning_source_id: null,
  x_account_id: "xa1",
  user_id: "u1",
  mode: null,
  ...over,
});

describe("finalizeFailedJob", () => {
  it("no-op when the job row is gone", async () => {
    const { db, writes } = makeDb(() => ({ rows: [] }));
    await finalizeFailedJob(db, "j1", "post_generation");
    expect(writes.length).toBe(1); // load only
  });

  it("post_generation: refunds generation reserve and creates a job:{id}:failed error notification", async () => {
    const { db, writes } = makeDb((sql) => {
      if (LOAD_JOB.test(sql)) return { rows: [jobRow({ draft_id: null })] };
      return { rows: [] }; // reserve absent → no counter update
    });
    await finalizeFailedJob(db, "j1", "post_generation");
    const refund = writes.find((w) => REFUND.test(w.sql));
    expect(refund?.params[0]).toBe("job:j1:generation:reserve");
    expect(refund?.params[1]).toBe("job:j1:generation:refund");
    expect(writes.some((w) => COUNTER.test(w.sql))).toBe(false); // reserve absent
    const notif = writes.find((w) => NOTIF_ERROR.test(w.sql));
    expect(notif?.params[1]).toBe("job:j1:failed");
  });

  it("post_generation: decrements the counter when a reserve existed", async () => {
    const { db, writes } = makeDb((sql) => {
      if (LOAD_JOB.test(sql)) return { rows: [jobRow()] };
      if (REFUND.test(sql))
        return { rows: [{ user_id: "u1", month: "2026-07", counter_type: "generation" }] };
      return { rows: [] };
    });
    await finalizeFailedJob(db, "j1", "post_generation");
    const counter = writes.find((w) => COUNTER.test(w.sql));
    expect(counter?.sql).toContain("generations_count");
    expect(counter?.params).toEqual(["u1", "2026-07"]);
  });

  it("post_publish: reverts posting→failed and notifies", async () => {
    const { db, writes } = makeDb((sql) =>
      LOAD_JOB.test(sql) ? { rows: [jobRow()] } : { rows: [] },
    );
    await finalizeFailedJob(db, "j2", "post_publish");
    expect(writes.some((w) => PUBLISH_FAIL.test(w.sql))).toBe(true);
    expect(writes.find((w) => NOTIF_ERROR.test(w.sql))?.params[1]).toBe("job:j2:failed");
  });

  it("image_generation draft mode: marks image failed and sends draft_created (no error notif)", async () => {
    const { db, writes } = makeDb((sql) =>
      LOAD_JOB.test(sql) ? { rows: [jobRow({ mode: "draft" })] } : { rows: [] },
    );
    await finalizeFailedJob(db, "j3", "image_generation");
    expect(writes.some((w) => IMAGE_MARK.test(w.sql))).toBe(true);
    expect(writes.some((w) => NOTIF_DRAFT.test(w.sql))).toBe(true);
    expect(writes.some((w) => NOTIF_ERROR.test(w.sql))).toBe(false);
    expect(writes.some((w) => CHILD.test(w.sql))).toBe(false);
  });

  it("image_generation auto mode: creates a post_publish child (no draft_created)", async () => {
    const { db, writes } = makeDb((sql) => {
      if (LOAD_JOB.test(sql)) return { rows: [jobRow({ mode: "auto" })] };
      if (CHILD_ACTIVE.test(sql)) return { rows: [], rowCount: 0 }; // no active publish
      return { rows: [] };
    });
    await finalizeFailedJob(db, "j4", "image_generation");
    expect(writes.some((w) => IMAGE_MARK.test(w.sql))).toBe(true);
    const child = writes.find((w) => CHILD.test(w.sql));
    expect(child?.params[3]).toBe("job:d1:post_publish:auto");
    expect(writes.some((w) => NOTIF_DRAFT.test(w.sql))).toBe(false);
  });

  it("image_generation auto mode: skips child creation when a post_publish is already active", async () => {
    const { db, writes } = makeDb((sql) => {
      if (LOAD_JOB.test(sql)) return { rows: [jobRow({ mode: "auto" })] };
      if (CHILD_ACTIVE.test(sql)) return { rows: [{ "?column?": 1 }], rowCount: 1 };
      return { rows: [] };
    });
    await finalizeFailedJob(db, "j5", "image_generation");
    expect(writes.some((w) => CHILD.test(w.sql))).toBe(false);
  });

  it("md_merge: reverts source removing→analyzed and notifies deletion incomplete", async () => {
    const { db, writes } = makeDb((sql) =>
      LOAD_JOB.test(sql)
        ? { rows: [jobRow({ draft_id: null, learning_source_id: "s1" })] }
        : { rows: [] },
    );
    await finalizeFailedJob(db, "j6", "md_merge");
    expect(writes.some((w) => MD_MERGE.test(w.sql))).toBe(true);
    expect(writes.find((w) => NOTIF_ERROR.test(w.sql))?.params[1]).toBe("job:j6:failed");
  });
});

describe("fallbackJobError", () => {
  it("AppError の code を採用し、利用者向け文言を使う", () => {
    const r = fallbackJobError("post_generation", new AppError("api_key_required"));
    expect(r.code).toBe("api_key_required");
    expect(r.message).toBe(userMessageForCode("api_key_required"));
  });

  it("handler の terminal error が持つ snake_case の code を採用する", () => {
    const err = Object.assign(new Error("internal detail"), { code: "invalid_output" });
    const r = fallbackJobError("post_generation", err);
    expect(r.code).toBe("invalid_output");
    // 未知コードなので kind別の定型文になる（例外の message は使わない）
    expect(r.message).not.toContain("internal detail");
    expect(r.message.length).toBeGreaterThan(0);
  });

  it("未知の例外は job_failed とkind別の定型文になる", () => {
    for (const kind of ["post_generation", "post_publish", "md_merge", "image_generation"] as const) {
      const r = fallbackJobError(kind, new Error("boom"));
      expect(r.code).toBe("job_failed");
      expect(r.message.length).toBeGreaterThan(0);
    }
  });

  it("危険・非対象の code は採用しない（SQLSTATE・errno・長すぎる値・非文字列）", () => {
    const cases: unknown[] = [
      Object.assign(new Error("dup"), { code: "23505" }),
      Object.assign(new Error("net"), { code: "ECONNREFUSED" }),
      Object.assign(new Error("long"), { code: "a".repeat(80) }),
      Object.assign(new Error("num"), { code: 500 }),
      null,
      "just a string",
    ];
    for (const error of cases) {
      expect(fallbackJobError("post_generation", error).code).toBe("job_failed");
    }
  });

  it("例外の message を返り値に含めない（秘密値の流出防止）", () => {
    const secret = "sk-live-should-not-leak provider said unauthorized";
    const r = fallbackJobError("post_generation", new Error(secret));
    expect(JSON.stringify(r)).not.toContain("sk-live");
    expect(JSON.stringify(r)).not.toContain("provider said");
  });
});
