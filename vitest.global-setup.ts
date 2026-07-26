import { Client } from "pg";

/**
 * `REQUIRE_DB=1` のときだけ、ローカルSupabaseの到達性を**テスト実行前**に検証する。
 *
 * `*.db.test.ts`（52本）は DB が無いと `ctx.skip()` で静かに skip され、vitest はファイルを
 * 「passed」として数える。そのため Supabase を起動し忘れると **DB・RLS・ロール権限の検証が
 * まるごと消えたまま `npm test` と `release:check` が緑になる**（2026-07-26 に実測で確認）。
 * リリース判定でそれを許すと、再発防止テスト自体が「動いているつもり」になる。
 *
 * 通常の開発（`npm test`）では従来どおり skip を許し、Supabase 未起動でもテストを回せる。
 */

const DB_URL =
  process.env.SUPABASE_DB_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const REST_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";

async function assertPostgres(): Promise<void> {
  const client = new Client({ connectionString: DB_URL, connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    await client.query("select 1");
  } finally {
    await client.end();
  }
}

async function assertRest(): Promise<void> {
  // PostgREST 経由（service_role）の経路は直結pgでは検証できないため、こちらも到達性を見る。
  const res = await fetch(`${REST_URL}/rest/v1/`, {
    signal: AbortSignal.timeout(5000),
  });
  // 認証なしのため 401/404 も「到達している」と見なす。5xx とネットワーク失敗だけを異常とする。
  if (res.status >= 500) throw new Error(`PostgREST が ${res.status} を返しました`);
}

export default async function globalSetup(): Promise<void> {
  if (process.env.REQUIRE_DB !== "1") return;

  const problems: string[] = [];
  await assertPostgres().catch((e: unknown) => {
    problems.push(`Postgres へ接続できません（${DB_URL.replace(/\/\/[^@]*@/, "//***@")}）: ${
      e instanceof Error ? e.message : String(e)
    }`);
  });
  await assertRest().catch((e: unknown) => {
    problems.push(`PostgREST へ到達できません（${REST_URL}）: ${
      e instanceof Error ? e.message : String(e)
    }`);
  });

  if (problems.length > 0) {
    throw new Error(
      `REQUIRE_DB=1 ですがローカルSupabaseに到達できません。\n- ${problems.join(
        "\n- ",
      )}\n\n\`supabase start\` で起動してから再実行してください（DBテスト52本が静かにskipされるのを防ぐためのゲートです）。`,
    );
  }
}
