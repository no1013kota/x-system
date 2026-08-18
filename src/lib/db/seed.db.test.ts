import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { connectLocalDb } from "./test-utils";

/**
 * Verifies seed (要件02 §6): the 7 system-default prompt_templates and the
 * private generated-images Storage bucket. Skips without the local stack.
 */
describe("seed data", () => {
  let db: Client | null = null;

  beforeAll(async () => {
    db = await connectLocalDb();
  });
  afterAll(async () => {
    await db?.end();
  });
  beforeEach(async (ctx) => {
    if (!db) ctx.skip();
  });

  /**
   * 型プロンプト（p1〜p6）は `post_patterns` へ移した（T-M8-129 U2）。`prompt_templates` に
   * 残るのは画像だけ。**型の行があってはいけない**——行を残すとコード定数の改善が届かなくなる
   * 経路が復活する（T-M7-37）。
   */
  it("system-default の prompt_templates は画像だけ（型は post_patterns）", async () => {
    const { rows } = await db!.query<{ kind: string; content: string }>(
      `select kind, content from prompt_templates
        where x_account_id is null order by kind`,
    );
    expect(rows.map((r) => r.kind)).toEqual(["image"]);
    expect(rows[0].content.length, "image content").toBeGreaterThan(20);
  });

  it("created the private generated-images Storage bucket", async () => {
    const { rows } = await db!.query<{ id: string; public: boolean }>(
      `select id, public from storage.buckets where id = 'generated-images'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].public).toBe(false);
  });
});
