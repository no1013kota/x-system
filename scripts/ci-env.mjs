#!/usr/bin/env node
//
// CI 用の `.env.local` を生成する（要件01 §3）。
//
// テストは外部API（Stripe / X / AI各社 / SMTP）をすべてモックするため、CI で必要な「本物」は
// ローカルSupabaseの接続情報と暗号鍵だけ。したがって **GitHub Secrets を一切使わない**。
// 秘密情報をCIへ置かない＝漏洩面を増やさない、かつ誰でも同じ結果を再現できる。
//
//   node scripts/ci-env.mjs > .env.local
//
// Supabase の接続情報（API_URL / ANON_KEY / SERVICE_ROLE_KEY / DB_URL）は、環境変数か
// `SUPABASE_STATUS_ENV` が指すファイル（`supabase status -o env` の出力）から読む。
// 出力は `KEY="value"` 形式なので、シェルの `source` に頼らずここで剥がす。
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

const statusFile = process.env.SUPABASE_STATUS_ENV;
if (statusFile) {
  for (const line of readFileSync(statusFile, "utf8").split("\n")) {
    const m = /^([A-Z_0-9]+)="?(.*?)"?$/.exec(line.trim());
    if (m) process.env[m[1]] ??= m[2];
  }
}

function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(
      `ci-env: ${name} が未設定です。\`supabase status -o env\` の出力を環境へ流し込んでから実行してください。`,
    );
    process.exit(2);
  }
  return v;
}

const API_URL = required("API_URL");
const ANON_KEY = required("ANON_KEY");
const SERVICE_ROLE_KEY = required("SERVICE_ROLE_KEY");
const DB_URL = required("DB_URL");

/**
 * Cloudflare が公開しているテストキー（常に成功）。秘密情報ではない。
 * https://developers.cloudflare.com/turnstile/troubleshooting/testing/
 */
const TURNSTILE_SITE_KEY = "1x00000000000000000000AA";
const TURNSTILE_SECRET_KEY = "1x0000000000000000000000000000000AA";

/**
 * env-schema が「非空」だけを要求し、テストでは対応クライアントをモックする項目。
 * 実際に外部へ到達しないことが前提（X_POSTING_MODE=dry_run・APP_ENV=development）。
 */
const PLACEHOLDERS = {
  STRIPE_SECRET_KEY: "sk_test_ci_placeholder",
  STRIPE_WEBHOOK_SECRET: "whsec_ci_placeholder",
  STRIPE_PORTAL_CONFIGURATION_ID: "bpc_ci_placeholder",
  // プラン解決を検証するため3つは必ず別の値にする。
  STRIPE_PRICE_STANDARD_MONTHLY: "price_ci_standard",
  STRIPE_PRICE_MD_MONTHLY: "price_ci_md",
  STRIPE_PRICE_PREMIUM_MONTHLY: "price_ci_premium",
  X_MANAGED_CLIENT_ID: "ci-managed-client-id",
  X_MANAGED_CLIENT_SECRET: "ci-managed-client-secret",
  ANTHROPIC_API_KEY: "sk-ant-ci-placeholder",
  OPENAI_API_KEY: "sk-ci-placeholder",
  GEMINI_API_KEY: "ci-placeholder",
  ANTHROPIC_TEXT_MODEL: "claude-sonnet-4-5",
  OPENAI_TEXT_MODEL: "gpt-5",
  OPENAI_IMAGE_MODEL: "gpt-image-1",
  GEMINI_TEXT_MODEL: "gemini-2.5-flash",
  GEMINI_IMAGE_MODEL: "gemini-2.5-flash-image",
  SMTP_USER: "ci@example.com",
  SMTP_APP_PASSWORD: "ci-placeholder",
  EMAIL_FROM: "ci@example.com",
  EMAIL_REPLY_TO: "ci@example.com",
  SUPPORT_EMAIL: "ci@example.com",
};

const RESOLVED = {
  ...PLACEHOLDERS,
  APP_BASE_URL: "http://127.0.0.1:3000",
  APP_ENV: "development",
  X_POSTING_MODE: "dry_run",
  // 環境ごとに新規生成する（CIの実行間で共有しない）。
  CRON_SECRET: randomBytes(32).toString("hex"),
  APP_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  NEXT_PUBLIC_SUPABASE_URL: API_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
  DATABASE_URL: DB_URL,
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: TURNSTILE_SITE_KEY,
  TURNSTILE_SECRET_KEY: TURNSTILE_SECRET_KEY,
};

// `.env.example` を土台にする。キーの追加漏れがあれば env-schema が起動時に落とすため、
// 「テンプレートに載っている全キーを出力する」ことで CI と手元の差を作らない。
const template = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
const keys = [];
for (const line of template.split("\n")) {
  const m = /^([A-Z_0-9]+)=(.*)$/.exec(line.trim());
  if (!m) continue;
  const fallback = m[2].replace(/\s+#.*$/, "").trim();
  keys.push([m[1], RESOLVED[m[1]] ?? fallback]);
}

const missing = Object.keys(RESOLVED).filter((k) => !keys.some(([name]) => name === k));
if (missing.length > 0) {
  console.error(`ci-env: .env.example に無いキーを指定しています: ${missing.join(", ")}`);
  process.exit(2);
}

console.log("# 自動生成（scripts/ci-env.mjs）。CI専用。コミットしない。");
// 空値は出力しない。env-schema は「キーがある＝設定済み」と見なすため、空文字を書くと
// `optional()` ではなく「短すぎる」で検証に落ちる（Sentry DSN 等が該当）。
for (const [name, value] of keys) {
  if (value === "") continue;
  console.log(`${name}=${value}`);
}
