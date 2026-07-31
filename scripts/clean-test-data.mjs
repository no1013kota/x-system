#!/usr/bin/env node
//
// ローカル開発DBに残るテストデータを掃除する（T-M7-12・T-M7-31）。DBテストは finally で後片付けするが、
// 実行中断や失敗で `auth.users` が残ることがあり、Studio や手動確認のノイズになる。
//
// 掃除するものは2つ:
//   (1) テストが作ったユーザーと関連データ（削除。T-M7-12）
//   (2) 送信待ちのお知らせメール（`email_status='queued'` を `not_requested` へ。T-M7-31）
//
// 安全策:
//   - 接続先がローカル（127.0.0.1 / localhost）でなければ即中止する
//   - (1)の削除対象は「テストが作るメール形式」に限定する（下記 TEST_EMAIL_PATTERNS）。実メールの
//     アカウントは削除しない
//   - (2)は実メールのアカウントも対象になるが、**行は消さず `email_status` だけを落とす**ので
//     画面の通知履歴（ベル）は元のまま残る
//   - 既定は dry-run。実際に反映するには `--apply` を付ける
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

/**
 * 送信待ちのお知らせメールをどこまで対象にするか（日数）。
 *
 * 既定は 0 = **送信待ちすべて**。ローカルDBの `queued` はすべてローカル検証で作られたもので
 * （本番は別DB）、このスクリプトはローカル以外へ接続しないため、期間で絞る意味がない。
 * 逆に既定を「7日より古い」にすると、直近の検証で作られた分が残って
 * **掃除したつもりで残る**（T-M7-31 の暫定案から変更した理由）。
 * 絞りたいときは `--older-than <日数>`。
 */
const olderThanDays = (() => {
  const i = process.argv.indexOf("--older-than");
  if (i === -1) return 0;
  const n = Number(process.argv[i + 1]);
  if (!Number.isFinite(n) || n < 0) {
    console.error("clean-test-data: --older-than には0以上の日数を指定してください");
    process.exit(2);
  }
  return n;
})();

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

  // --- (2) 送信待ちのお知らせメール（T-M7-31・要決定D-9 案A） ---
  //
  // `queued` は本番で `scheduler_tick` が初めて回ったときに**まとめて送信される**。ローカル検証で
  // 作られた古い通知をそのまま本番へ持ち込むと、本人宛に大量の古いメールが届く（2026-07-27 に
  // ガードが無かった時点で98通の実送信が発生している）。送るのは `queued` だけで、`failed` は
  // 利用者の明示的な再送要求でしか送られないため、`queued` を落とせば一斉送信は起こらない。
  console.log("");
  const cutoff = `now() - interval '${olderThanDays} days'`;
  const { rows: queued } = await client.query(
    `select count(*)::int as n,
            min(created_at) as oldest,
            count(distinct user_id)::int as users
       from notifications
      where email_status = 'queued' and created_at < ${cutoff}`,
  );
  const stat = queued[0];
  const scope = olderThanDays === 0 ? "送信待ちすべて" : `${olderThanDays}日より古いもの`;
  if (stat.n === 0) {
    console.log(`お知らせメール: 送信待ちはありません（対象: ${scope}）`);
  } else {
    const ageHours = Math.round((Date.now() - new Date(stat.oldest).getTime()) / 3_600_000);
    console.log(
      `お知らせメール: 送信待ち ${stat.n}件（${stat.users}名分・最古は約${ageHours}時間前・対象: ${scope}）`,
    );
    if (!apply) {
      console.log("  本番へ持ち込むと初回の定時実行でまとめて送信されます。");
      console.log("  dry-run です。反映するには --apply を付けてください。");
    } else {
      const { rowCount } = await client.query(
        `update notifications
            set email_status = 'not_requested', email_available_at = null
          where email_status = 'queued' and created_at < ${cutoff}`,
      );
      console.log(`  ${rowCount}件を送信対象から外しました（画面の通知履歴はそのまま残ります）。`);
    }
  }
} catch (error) {
  await client.query("rollback").catch(() => {});
  console.error("clean-test-data: 失敗しました:", error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
