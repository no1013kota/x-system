import { describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/observability/errors";

import { discardDraft, updateDraft } from "./drafts";
import type { Queryable } from "./x/token-refresh";

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

const LOAD = /from drafts d join x_accounts xa/;
const UPDATE_THREAD = /update drafts\s+set thread/;
const UPDATE_DISCARD = /update drafts set status = 'discarded'/;

async function rejection(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    return e as AppError;
  }
  throw new Error("expected rejection");
}

function ownedDraft(over: Row = {}): Row {
  return {
    status: "draft",
    pattern: "p1",
    images: [],
    tweet_ids: [],
    last_post_error: null,
    settings: {},
    ...over,
  };
}

describe("updateDraft", () => {
  it("saves an edited thread for a draft (optimistic lock hit)", async () => {
    const { db, writes } = makeDb((sql) => {
      if (LOAD.test(sql)) return [ownedDraft()];
      if (UPDATE_THREAD.test(sql)) return [{ id: "d1", updated_at: "2026-01-01T00:00:00.000Z" }];
      return [];
    });
    const res = await updateDraft(db, {
      userId: "u1",
      draftId: "d1",
      expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
      posts: [{ text: "新しい本文" }],
    });
    expect(res.id).toBe("d1");
    const upd = writes.find((w) => UPDATE_THREAD.test(w.sql));
    expect(upd).toBeTruthy();
  });

  it("rejects editing a non-draft status", async () => {
    const { db } = makeDb((sql) => (LOAD.test(sql) ? [ownedDraft({ status: "posted" })] : []));
    const err = await rejection(
      updateDraft(db, { userId: "u1", draftId: "d1", expectedUpdatedAt: "t", posts: [{ text: "x" }] }),
    );
    expect(err.code).toBe("job_conflict");
  });

  it("rejects exceeding the pattern max posts (P-1=6)", async () => {
    const { db } = makeDb((sql) => (LOAD.test(sql) ? [ownedDraft({ pattern: "p1" })] : []));
    const err = await rejection(
      updateDraft(db, {
        userId: "u1",
        draftId: "d1",
        expectedUpdatedAt: "t",
        posts: Array.from({ length: 7 }, (_, i) => ({ text: `p${i}` })),
      }),
    );
    expect(err.code).toBe("validation_error");
    expect(err.details?.max).toBe(6);
  });

  it("rejects referencing an unknown image", async () => {
    const { db } = makeDb((sql) =>
      LOAD.test(sql) ? [ownedDraft({ images: [{ local_id: "img1", storage_path: "p" }] })] : [],
    );
    const err = await rejection(
      updateDraft(db, {
        userId: "u1",
        draftId: "d1",
        expectedUpdatedAt: "t",
        posts: [{ text: "x" }],
        imageLocalIds: ["img-nope"],
      }),
    );
    expect(err.code).toBe("validation_error");
  });

  it("maps a 0-row optimistic update to job_conflict", async () => {
    const { db } = makeDb((sql) => (LOAD.test(sql) ? [ownedDraft()] : []));
    const err = await rejection(
      updateDraft(db, { userId: "u1", draftId: "d1", expectedUpdatedAt: "stale", posts: [{ text: "x" }] }),
    );
    expect(err.code).toBe("job_conflict");
  });

  it("throws not_found for a draft the user does not own", async () => {
    const { db } = makeDb(() => []);
    await expect(
      updateDraft(db, { userId: "u1", draftId: "d1", expectedUpdatedAt: "t", posts: [{ text: "x" }] }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("discardDraft", () => {
  const deleteImages = vi.fn(async () => {});

  it("discards a draft and best-effort deletes its images", async () => {
    const { db } = makeDb((sql) => {
      if (LOAD.test(sql)) return [ownedDraft({ images: [{ local_id: "i", storage_path: "u/x/d/i.webp" }] })];
      if (UPDATE_DISCARD.test(sql)) return [{ id: "d1" }];
      return [];
    });
    const res = await discardDraft(db, { userId: "u1", draftId: "d1", expectedUpdatedAt: "t" }, { deleteImages });
    expect(res.status).toBe("discarded");
    expect(deleteImages).toHaveBeenCalledWith(["u/x/d/i.webp"]);
  });

  it("rejects discarding a failed draft with unresolved posted tweet_ids", async () => {
    const { db } = makeDb((sql) =>
      LOAD.test(sql) ? [ownedDraft({ status: "failed", tweet_ids: ["123"] })] : [],
    );
    const err = await rejection(
      discardDraft(db, { userId: "u1", draftId: "d1", expectedUpdatedAt: "t" }, { deleteImages }),
    );
    expect(err.code).toBe("job_conflict");
    expect(err.details?.reason).toBe("unresolved_posting");
  });

  it("allows discarding a clean failed draft", async () => {
    const { db } = makeDb((sql) => {
      if (LOAD.test(sql)) return [ownedDraft({ status: "failed" })];
      if (UPDATE_DISCARD.test(sql)) return [{ id: "d1" }];
      return [];
    });
    expect(
      (await discardDraft(db, { userId: "u1", draftId: "d1", expectedUpdatedAt: "t" }, { deleteImages })).status,
    ).toBe("discarded");
  });

  it("rejects discarding a posted draft", async () => {
    const { db } = makeDb((sql) => (LOAD.test(sql) ? [ownedDraft({ status: "posted" })] : []));
    await expect(
      discardDraft(db, { userId: "u1", draftId: "d1", expectedUpdatedAt: "t" }, { deleteImages }),
    ).rejects.toMatchObject({ code: "job_conflict" });
  });
});
