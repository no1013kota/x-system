import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

describe("server-only boundaries", () => {
  it.each([
    "src/lib/supabase/admin.ts",
    "src/lib/supabase/server.ts",
    "src/lib/auth/profile.ts",
    "src/lib/ai-purpose-config-server.ts",
    "src/lib/api-key-deletion-server.ts",
    "src/lib/api-key-view-server.ts",
    "src/lib/api-key-store-server.ts",
    "src/lib/api-key-verification-server.ts",
    "src/lib/api-key-verifiers-server.ts",
    "src/lib/crypto/index.ts",
  ])("marks %s as server-only", async (relativePath) => {
    const source = await readFile(path.join(ROOT, relativePath), "utf8");
    expect(source).toMatch(/^import "server-only";/m);
  });
});
