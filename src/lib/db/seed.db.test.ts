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

  it("has 7 system-default prompt_templates (p1-p6, image) with non-empty content", async () => {
    const { rows } = await db!.query<{ kind: string; content: string }>(
      `select kind, content from prompt_templates
        where x_account_id is null order by kind`,
    );
    expect(rows.map((r) => r.kind)).toEqual([
      "image",
      "p1",
      "p2",
      "p3",
      "p4",
      "p5",
      "p6",
    ]);
    for (const r of rows) {
      expect(r.content.length, `${r.kind} content`).toBeGreaterThan(20);
    }
  });

  it("created the private generated-images Storage bucket", async () => {
    const { rows } = await db!.query<{ id: string; public: boolean }>(
      `select id, public from storage.buckets where id = 'generated-images'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].public).toBe(false);
  });
});
