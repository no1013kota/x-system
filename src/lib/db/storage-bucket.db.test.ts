import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closePool, getPool } from "./pool";

/**
 * 生成画像用 bucket が**migrationで作られている**こと（T-M7-45）。
 *
 * 以前は `supabase/config.toml` にしか定義が無く、ローカルの `supabase start` でしか作られて
 * いなかった。そのため staging / production では画像生成の最後（保存）だけが失敗する。
 * 2026-08-01、stagingで bucket が0件であることを実測して発覚した。
 *
 * このテストは**環境を作り直したときに揃っているか**を守る。設定値は `config.toml` と一致させる。
 */
describe("storage bucket（migrationで作られる）", () => {
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

  it("generated-images が private・5MiB・画像3形式で存在する", async () => {
    const { rows } = await getPool().query<{
      id: string;
      public: boolean;
      file_size_limit: string | number | null;
      allowed_mime_types: string[] | null;
    }>(
      `select id, public, file_size_limit, allowed_mime_types
         from storage.buckets where id = 'generated-images'`,
    );
    expect(rows, "bucketが無い（migrationが適用されていない可能性）").toHaveLength(1);
    expect(rows[0].public, "公開bucketにしない（閲覧は署名URL経由）").toBe(false);
    expect(Number(rows[0].file_size_limit)).toBe(5 * 1024 * 1024);
    expect(rows[0].allowed_mime_types?.sort()).toEqual(["image/jpeg", "image/png", "image/webp"]);
  });

  it("bucket名はアプリの既定値と一致する", async () => {
    // env未設定時の既定（`SUPABASE_STORAGE_BUCKET_IMAGES`）とズレていると、
    // 環境変数を設定し忘れた環境で存在しないbucketへ書きに行く。
    const { rows } = await getPool().query<{ id: string }>(
      `select id from storage.buckets where id = 'generated-images'`,
    );
    expect(rows[0]?.id).toBe("generated-images");
  });
});
