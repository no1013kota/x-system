import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Server-only 境界（要件01 §8, T-M6-18）。秘密値（service role・暗号鍵・provider/Stripe/X secret・
 * CRON_SECRET・SMTP）を実際に env から読む src/lib モジュールは、Client Component から import すると
 * ビルドが失敗するよう `import "server-only";` を先頭に持たねばならない。ここでは静的走査でその不変条件を
 * 強制する（新しい秘密参照モジュールがマーカーを欠くと落ちる＝将来のregression検出）。
 *
 * 純粋core（decrypt等を注入で受け取り env 秘密を直接読まない `*.ts`）は対象外。実際の秘密読取は
 * `*-server.ts`・crypto/index・supabase/admin・jobs/auth・jobs/dispatch 等に閉じ、server-only を持つ。
 */

const LIB_ROOT = path.join(process.cwd(), "src", "lib");

// 秘密値を「env から読む」参照だけを検出する（コメント中の言及や列名は含めない）。
const SECRET_READ =
  /(?:process\.env\.|env\.)(?:SUPABASE_SERVICE_ROLE_KEY|CRON_SECRET|APP_ENCRYPTION_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY|GEMINI_API_KEY|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|X_MANAGED_CLIENT_SECRET|SMTP_APP_PASSWORD)\b/;
const ADMIN_CLIENT = /createSupabaseAdminClient\s*\(/;
const ENCRYPTION_KEY = /getEncryptionKey\s*\(/;

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsFiles(full));
    else if (entry.name.endsWith(".ts") && !entry.name.includes(".test.")) out.push(full);
  }
  return out;
}

function referencesSecretValue(source: string): boolean {
  return SECRET_READ.test(source) || ADMIN_CLIENT.test(source) || ENCRYPTION_KEY.test(source);
}

describe("server-only boundaries", () => {
  const files = listTsFiles(LIB_ROOT).map((full) => ({
    rel: path.relative(process.cwd(), full),
    source: readFileSync(full, "utf8"),
  }));
  const secretModules = files.filter((f) => referencesSecretValue(f.source));

  it("detects the secret-referencing modules to guard", () => {
    // Guardrail: if this drops to ~0 the detector broke (env var renamed, etc.).
    expect(secretModules.length).toBeGreaterThanOrEqual(10);
  });

  it.each(secretModules.map((f) => f.rel))(
    "%s reads secret values and must be marked server-only",
    (rel) => {
      const source = secretModules.find((f) => f.rel === rel)!.source;
      expect(source).toMatch(/^import "server-only";/m);
    },
  );
});
