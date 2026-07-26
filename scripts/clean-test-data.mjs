#!/usr/bin/env node
//
// ローカル開発DBに残るテストデータを掃除する（T-M7-12）。DBテストは finally で後片付けするが、
// 実行中断や失敗で `auth.users` が残ることがあり、Studio や手動確認のノイズになる。
//
// 安全策:
//   - 接続先がローカル（127.0.0.1 / localhost）でなければ即中止する
//   - 削除対象は「テストが作るメール形式」に限定する（下記 TEST_EMAIL_PATTERNS）
//   - 実メールのアカウントには一切触れない
//   - 既定は dry-run。実際に消すには `--apply` を付ける
//
import { Client } from "pg";

const DB_URL =
  process.env.SUPABASE_DB_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const host = (() => {
  try {
    return new URL(DB_URL).hostname;
  } catch {
    return null;
  }
})();
if (!host || !LOCAL_HOSTS.has(host)) {
  console.error(`clean-test-data: ローカルDBではないため中止します（host=${host ?? "不明"}）`);
  process.exit(2);
}

// テストが作るメールだけを対象にする。実メール（gmail等）は決して一致しない。
const TEST_EMAIL_PATTERNS = [
  // DBテストの `${randomUUID()}@example.com`
  "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@example\\.com$",
  // 手動UI検証・E2Eのfixture
  "^uxcheck-[a-z0-9-]+@example\\.com$",
  "^e2e-[a-z0-9-]+@example\\.com$",
];

// user_id / x_account_id を参照する表を子→親の順に消す（FK順）。
const BY_X_ACCOUNT = [
  "external_api_usage_events",
  "usage_events",
  "improvement_suggestions",
  "follower_snapshots",
  "learning_sources",
  "prompt_templates",
  "base_md_versions",
  "generation_jobs",
  "drafts",
  "schedule_slots",
];
const BY_USER = [
  "external_api_usage_events",
  "usage_events",
  "usage_counters",
  "user_api_keys",
  "notifications",
];

const apply = process.argv.includes("--apply");
const client = new Client({ connectionString: DB_URL, connectionTimeoutMillis: 5000 });
await client.connect();
try {
  const where = TEST_EMAIL_PATTERNS.map((_, i) => `email ~ $${i + 1}`).join(" or ");
  const { rows: targets } = await client.query(
    `select id, email from auth.users where ${where}`,
    TEST_EMAIL_PATTERNS,
  );
  const { rows: kept } = await client.query(
    `select count(*)::int as n from auth.users where not (${where})`,
    TEST_EMAIL_PATTERNS,
  );
  console.log(`対象: ${targets.length}件 / 温存: ${kept[0].n}件（実アカウント）`);
  if (targets.length === 0) {
    console.log("掃除するものはありません。");
  } else if (!apply) {
    console.log(`例: ${targets.slice(0, 3).map((r) => r.email).join(", ")}`);
    console.log("dry-run です。実行するには --apply を付けてください。");
  } else {
    const ids = targets.map((r) => r.id);
    await client.query("begin");
    for (const table of BY_X_ACCOUNT) {
      await client.query(
        `delete from ${table} where x_account_id in
           (select id from x_accounts where user_id = any($1::uuid[]))`,
        [ids],
      );
    }
    for (const table of BY_USER) {
      await client.query(`delete from ${table} where user_id = any($1::uuid[])`, [ids]);
    }
    await client.query(`update profiles set active_x_account_id = null where id = any($1::uuid[])`, [ids]);
    await client.query(`delete from x_accounts where user_id = any($1::uuid[])`, [ids]);
    await client.query(`delete from auth.users where id = any($1::uuid[])`, [ids]);
    await client.query("commit");
    console.log(`${ids.length}件のテストユーザーと関連データを削除しました。`);
  }
} catch (error) {
  await client.query("rollback").catch(() => {});
  console.error("clean-test-data: 失敗しました:", error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
