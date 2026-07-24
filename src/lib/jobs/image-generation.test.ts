import { describe, expect, it, vi } from "vitest";

import type { ImageGen, ImageGenRequest } from "../ai/image";
import { emptyUsage, type TextGen, type TextGenRequest } from "../ai/types";
import type { Queryable } from "../x/token-refresh";
import { createDeadline } from "./deadline";
import {
  ImageGenerationTerminalError,
  executeImageGeneration,
  type ImageGenerationDeps,
} from "./image-generation";

type Row = Record<string, unknown>;

const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQAY3Y2wAAAAAElFTkSuQmCC",
  "base64",
);

const BASE_MD = `## 1. ペルソナ
- 発信者: X
## 2. 発信テーマ
- 主テーマ: Y
## 3. トーン&マナー
- 文末: 断定調
## 4. やらないこと
- Z
## 5. 文体
- A
## 6. 型
- B`;

const LOAD_JOB = /select gj\.draft_id, gj\.x_account_id/;
const LOAD_DRAFT = /select thread, images from drafts/;
const TEMPLATES = /from prompt_templates/;
const UPD_IMAGES = /update drafts set images/;
const UPD_USAGE = /update generation_jobs set usage/;
const UPD_ERROR = /update generation_jobs set error/;
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

function fakeTextGen(text: string): { textGen: TextGen; captured: { req?: TextGenRequest } } {
  const captured: { req?: TextGenRequest } = {};
  const textGen: TextGen = {
    generate: vi.fn(async (req: TextGenRequest) => {
      captured.req = req;
      return {
        provider: "anthropic" as const,
        requestId: null,
        text,
        citations: [],
        usage: emptyUsage(),
        stopReason: null,
      };
    }),
  };
  return { textGen, captured };
}

function fakeImageGen(
  impl: (req: ImageGenRequest) => Promise<{ bytes: Buffer; declaredMime: string | null }>,
): { imageGen: ImageGen; captured: { req?: ImageGenRequest } } {
  const captured: { req?: ImageGenRequest } = {};
  const imageGen: ImageGen = {
    generate: vi.fn(async (req: ImageGenRequest) => {
      captured.req = req;
      const { bytes, declaredMime } = await impl(req);
      return {
        provider: "openai" as const,
        requestId: null,
        image: { bytes, declaredMime },
        requestedSize: "1536x1024",
      };
    }),
  };
  return { imageGen, captured };
}

function baseDeps(
  db: Queryable,
  over: Partial<ImageGenerationDeps> = {},
): ImageGenerationDeps {
  const { textGen } = fakeTextGen('{"prompt":"a cat on a roof","aspect":"16:9"}');
  const { imageGen } = fakeImageGen(async () => ({ bytes: PIXEL_PNG, declaredMime: null }));
  return {
    db,
    jobId: "job-img",
    runInTx: (fn) => fn(db),
    resolveTextProvider: async () => ({ textGen, provider: "anthropic", model: "claude-x" }),
    resolveImage: async () => ({ imageGen, provider: "openai" }),
    uploadImage: vi.fn(async () => {}),
    deleteImages: vi.fn(async () => {}),
    recordStage: async () => {},
    makeDeadline: () => createDeadline(),
    newId: () => "img-1",
    ...over,
  };
}

const JOB_ROW = {
  draft_id: "draft1",
  x_account_id: "xacc1",
  user_id: "user1",
  base_md: BASE_MD,
  plan: "premium",
  input: null as { regenerate?: boolean } | null,
};

const REGEN_JOB_ROW = { ...JOB_ROW, input: { regenerate: true } };

const draftRow = (images: unknown[] = []) => ({
  thread: [{ local_id: "p1", text: "1ポスト目の本文", weighted_length: 8 }],
  images,
});

describe("executeImageGeneration", () => {
  it("generates, normalizes, uploads and marks the draft image ready", async () => {
    const { db, writes } = makeDb((sql) => {
      if (LOAD_JOB.test(sql)) return [JOB_ROW];
      if (LOAD_DRAFT.test(sql)) return [draftRow()];
      if (TEMPLATES.test(sql)) return []; // system default PT-IMG
      return [];
    });
    const upload = vi.fn(async () => {});
    const { textGen, captured } = fakeTextGen('{"prompt":"a cat","aspect":"16:9"}');

    const res = await executeImageGeneration(
      baseDeps(db, {
        uploadImage: upload,
        resolveTextProvider: async () => ({ textGen, provider: "anthropic", model: "claude-x" }),
      }),
    );

    expect(res).toEqual({ status: "created", draftId: "draft1" });
    // PT-IMG は 1ポスト目本文 + base_md セクション3（トーン&マナー）を含む
    expect(captured.req?.user).toContain("1ポスト目の本文");
    expect(captured.req?.user).toContain("断定調");
    // upload は user/x_account/draft/local_id.ext のパスへ png で保存
    expect(upload).toHaveBeenCalledWith({
      path: "user1/xacc1/draft1/img-1.png",
      bytes: expect.any(Buffer),
      contentType: "image/png",
    });
    // drafts.images に ready 印
    const imgUpdate = writes.find((w) => UPD_IMAGES.test(w.sql));
    const images = JSON.parse(imgUpdate?.params[1] as string);
    expect(images[0]).toMatchObject({
      local_id: "img-1",
      post_local_id: "p1",
      storage_path: "user1/xacc1/draft1/img-1.png",
      provider: "openai",
      mime_type: "image/png",
      status: "ready",
    });
    expect(writes.some((w) => UPD_USAGE.test(w.sql))).toBe(true);
    expect(writes.some((w) => NOTIFY.test(w.sql))).toBe(true);
  });

  it("is idempotent when the draft already has a ready image", async () => {
    const upload = vi.fn(async () => {});
    const { db } = makeDb((sql) => {
      if (LOAD_JOB.test(sql)) return [JOB_ROW];
      if (LOAD_DRAFT.test(sql)) return [draftRow([{ status: "ready" }])];
      return [];
    });
    const res = await executeImageGeneration(baseDeps(db, { uploadImage: upload }));
    expect(res).toEqual({ status: "already_done", draftId: "draft1" });
    expect(upload).not.toHaveBeenCalled();
  });

  it("maps 16:9 aspect to the image adapter request", async () => {
    const { db } = makeDb((sql) => {
      if (LOAD_JOB.test(sql)) return [JOB_ROW];
      if (LOAD_DRAFT.test(sql)) return [draftRow()];
      if (TEMPLATES.test(sql)) return [];
      return [];
    });
    const { imageGen, captured } = fakeImageGen(async () => ({
      bytes: PIXEL_PNG,
      declaredMime: null,
    }));
    await executeImageGeneration(
      baseDeps(db, { resolveImage: async () => ({ imageGen, provider: "openai" }) }),
    );
    expect(captured.req?.aspectRatio).toBe("16:9");
  });

  it("on image failure keeps the draft image-less, marks it failed, notifies and throws", async () => {
    const { db, writes } = makeDb((sql) => {
      if (LOAD_JOB.test(sql)) return [JOB_ROW];
      if (LOAD_DRAFT.test(sql)) return [draftRow()];
      if (TEMPLATES.test(sql)) return [];
      return [];
    });
    const upload = vi.fn(async () => {});
    const { imageGen } = fakeImageGen(async () => {
      throw new Error("provider 500");
    });

    await expect(
      executeImageGeneration(
        baseDeps(db, {
          uploadImage: upload,
          resolveImage: async () => ({ imageGen, provider: "openai" }),
        }),
      ),
    ).rejects.toBeInstanceOf(ImageGenerationTerminalError);

    expect(upload).not.toHaveBeenCalled();
    const imgUpdate = writes.find((w) => UPD_IMAGES.test(w.sql));
    const images = JSON.parse(imgUpdate?.params[1] as string);
    expect(images[0]).toMatchObject({ status: "failed", storage_path: "" });
    expect(writes.some((w) => UPD_ERROR.test(w.sql))).toBe(true);
    // 本文は使えるため draft_created 通知は送る
    expect(writes.some((w) => NOTIFY.test(w.sql))).toBe(true);
  });

  it("throws terminal when the draft has no posts", async () => {
    const { db } = makeDb((sql) => {
      if (LOAD_JOB.test(sql)) return [JOB_ROW];
      if (LOAD_DRAFT.test(sql)) return [{ thread: [], images: [] }];
      return [];
    });
    await expect(executeImageGeneration(baseDeps(db))).rejects.toMatchObject({
      code: "empty_thread",
    });
  });
});

describe("executeImageGeneration regenerate", () => {
  it("regenerates over an existing ready image and best-effort deletes the old object", async () => {
    const { db, writes } = makeDb((sql) => {
      if (LOAD_JOB.test(sql)) return [REGEN_JOB_ROW];
      if (LOAD_DRAFT.test(sql))
        return [draftRow([{ status: "ready", storage_path: "user1/xacc1/draft1/old.png" }])];
      if (TEMPLATES.test(sql)) return [];
      return [];
    });
    const upload = vi.fn(async () => {});
    const del = vi.fn(async () => {});

    const res = await executeImageGeneration(
      baseDeps(db, { uploadImage: upload, deleteImages: del }),
    );

    expect(res).toEqual({ status: "created", draftId: "draft1" });
    // 既存readyがあっても already_done にせず再生成する
    expect(upload).toHaveBeenCalledTimes(1);
    // 置換後に旧objectを削除
    expect(del).toHaveBeenCalledWith(["user1/xacc1/draft1/old.png"]);
    const images = JSON.parse(writes.find((w) => UPD_IMAGES.test(w.sql))?.params[1] as string);
    expect(images[0]).toMatchObject({ status: "ready", storage_path: "user1/xacc1/draft1/img-1.png" });
    // 再生成では draft_created を送らない
    expect(writes.some((w) => NOTIFY.test(w.sql))).toBe(false);
  });

  it("on regenerate failure keeps the existing image and records only the error", async () => {
    const { db, writes } = makeDb((sql) => {
      if (LOAD_JOB.test(sql)) return [REGEN_JOB_ROW];
      if (LOAD_DRAFT.test(sql))
        return [draftRow([{ status: "ready", storage_path: "user1/xacc1/draft1/old.png" }])];
      if (TEMPLATES.test(sql)) return [];
      return [];
    });
    const del = vi.fn(async () => {});
    const { imageGen } = fakeImageGen(async () => {
      throw new Error("provider 500");
    });

    await expect(
      executeImageGeneration(
        baseDeps(db, { deleteImages: del, resolveImage: async () => ({ imageGen, provider: "openai" }) }),
      ),
    ).rejects.toBeInstanceOf(ImageGenerationTerminalError);

    // 既存画像は維持（drafts.images を書き換えない）
    expect(writes.some((w) => UPD_IMAGES.test(w.sql))).toBe(false);
    // 旧objectは消さない
    expect(del).not.toHaveBeenCalled();
    // error は記録・通知は送らない
    expect(writes.some((w) => UPD_ERROR.test(w.sql))).toBe(true);
    expect(writes.some((w) => NOTIFY.test(w.sql))).toBe(false);
  });
});
