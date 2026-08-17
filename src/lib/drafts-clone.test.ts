import { describe, expect, it, vi } from "vitest";

import { cloneFailedDraftForRetry, type CloneDraftDeps } from "./drafts-clone";
import type { Queryable } from "./x/token-refresh";

type Row = Record<string, unknown>;

const LOAD = /select d\.status, d\.pattern_id, d\.pattern_name/;
const DEDUP = /parent_draft_id = \$1 and source_job_id is null/;
const INSERT = /insert into drafts/;

function makeDb(handler: (sql: string) => Row[]) {
  const writes: { sql: string; params: unknown[] }[] = [];
  const db: Queryable = {
    query: async <T = unknown>(sql: string, params: unknown[] = []) => {
      writes.push({ sql, params });
      const rows = handler(sql) as T[];
      return { rows, rowCount: rows.length };
    },
  };
  return { db, writes };
}

function srcRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    status: "failed",
    pattern_id: "11111111-1111-4111-8111-111111111111",
    pattern_name: "ニュース解説",
    max_posts: 4,
    max_posts_edit: 6,
    requires_quote_url: false,
    thread: [{ local_id: "p1", text: "本文1", weighted_length: 5, sources: [], warnings: [] }],
    images: [
      {
        local_id: "old-img",
        post_local_id: "p1",
        storage_path: "u1/xa1/src/old.webp",
        provider: "openai",
        mime_type: "image/webp",
        size_bytes: 100,
        status: "ready",
      },
    ],
    quote_url: null,
    quote_tweet_id: null,
    source_news_item_id: null,
    tweet_ids: ["t-0"],
    last_post_error: { deleted_tweet_ids: ["t-0"], ambiguous_delete_tweet_ids: [] },
    x_account_id: "xa1",
    user_id: "u1",
    ...over,
  };
}

function deps(db: Queryable, over: Partial<CloneDraftDeps> = {}): CloneDraftDeps {
  let n = 0;
  return {
    db,
    copyImage: vi.fn(async () => {}),
    deleteImages: vi.fn(async () => {}),
    newId: () => `id-${++n}`,
    ...over,
  };
}

const input = { request_key: "ck", draft_id: "src" };

describe("cloneFailedDraftForRetry", () => {
  it("clones an eligible failed draft with copied images and empty posting state", async () => {
    const { db, writes } = makeDb((sql) => {
      if (DEDUP.test(sql)) return [];
      if (LOAD.test(sql)) return [srcRow()];
      return [];
    });
    const copyImage = vi.fn(async () => {});
    const res = await cloneFailedDraftForRetry("u1", input, deps(db, { copyImage }));

    expect(res).toEqual({ draftId: "id-1", deduped: false });
    // 画像を新draft用pathへcopy（newDraftId=id-1, localId=id-2）
    expect(copyImage).toHaveBeenCalledWith("u1/xa1/src/old.webp", "u1/xa1/id-1/id-2.webp");
    const insert = writes.find((w) => INSERT.test(w.sql));
    expect(insert?.params[0]).toBe("id-1"); // 明示id
    expect(insert?.params[3]).toBe(JSON.stringify(srcRow().thread)); // thread=initial_thread
    expect(insert?.params[5]).toBe("src"); // parent_draft_id
    const images = JSON.parse(insert?.params[4] as string);
    expect(images[0]).toMatchObject({ storage_path: "u1/xa1/id-1/id-2.webp", status: "ready", local_id: "id-2" });
    // source_job_id は null（insert SQL に null リテラル）
    expect(insert?.sql).toContain("null, $6");
  });

  it("dedups to an existing active clone", async () => {
    const { db, writes } = makeDb((sql) => {
      if (DEDUP.test(sql)) return [{ id: "existing-clone" }];
      if (LOAD.test(sql)) return [srcRow()];
      return [];
    });
    const copyImage = vi.fn(async () => {});
    const res = await cloneFailedDraftForRetry("u1", input, deps(db, { copyImage }));
    expect(res).toEqual({ draftId: "existing-clone", deduped: true });
    expect(copyImage).not.toHaveBeenCalled();
    expect(writes.some((w) => INSERT.test(w.sql))).toBe(false);
  });

  it("rejects a non-failed draft", async () => {
    const { db } = makeDb((sql) => (LOAD.test(sql) ? [srcRow({ status: "draft" })] : []));
    await expect(cloneFailedDraftForRetry("u1", input, deps(db))).rejects.toMatchObject({
      code: "job_conflict",
    });
  });

  it("rejects a failed draft with no creation history", async () => {
    const { db } = makeDb((sql) => (LOAD.test(sql) ? [srcRow({ tweet_ids: [] })] : []));
    await expect(cloneFailedDraftForRetry("u1", input, deps(db))).rejects.toMatchObject({
      code: "job_conflict",
      details: { reason: "no_creation_history" },
    });
  });

  it("rejects a failed draft with unresolved posting state", async () => {
    const { db } = makeDb((sql) =>
      LOAD.test(sql)
        ? [srcRow({ last_post_error: { ambiguous_delete_tweet_ids: ["t-0"] } })]
        : [],
    );
    await expect(cloneFailedDraftForRetry("u1", input, deps(db))).rejects.toMatchObject({
      details: { reason: "unresolved_posting" },
    });
  });

  it("deletes copied objects and creates no draft when an image copy fails", async () => {
    const src = srcRow({
      images: [
        { local_id: "i1", post_local_id: "p1", storage_path: "u1/xa1/src/a.webp", status: "ready" },
        { local_id: "i2", post_local_id: "p2", storage_path: "u1/xa1/src/b.webp", status: "ready" },
      ],
    });
    const { db, writes } = makeDb((sql) => {
      if (DEDUP.test(sql)) return [];
      if (LOAD.test(sql)) return [src];
      return [];
    });
    let calls = 0;
    const copyImage = vi.fn(async () => {
      calls += 1;
      if (calls === 2) throw new Error("copy boom");
    });
    const deleteImages = vi.fn(async () => {});
    await expect(
      cloneFailedDraftForRetry("u1", input, deps(db, { copyImage, deleteImages })),
    ).rejects.toMatchObject({ code: "internal_error" });

    // copy済み（1件目）を best effort 削除・新draftは作らない
    expect(deleteImages).toHaveBeenCalledWith(["u1/xa1/id-1/id-2.webp"]);
    expect(writes.some((w) => INSERT.test(w.sql))).toBe(false);
  });
});
