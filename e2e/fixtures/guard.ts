/**
 * E2Eの安全ゲート（T-M7-05）。本番・preview・実投稿の設定では起動前に落とす。
 * globalSetup として最初に1度だけ走る。秘密値は出力しない（ホスト名・モードのみ）。
 */

const LOCAL_HOSTS = ["127.0.0.1", "localhost", "::1"];

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/** 接続先がローカルかどうか。判定できない値は「ローカルでない」とみなす。 */
function isLocal(url: string | undefined): boolean {
  const host = hostOf(url);
  return host !== null && LOCAL_HOSTS.includes(host);
}

export function assertSafeE2eEnv(env: NodeJS.ProcessEnv = process.env): void {
  const problems: string[] = [];

  const appEnv = env.APP_ENV ?? "development";
  if (appEnv !== "development") problems.push(`APP_ENV=${appEnv}（development のみ）`);

  const postingMode = env.X_POSTING_MODE ?? "dry_run";
  if (postingMode !== "dry_run") problems.push(`X_POSTING_MODE=${postingMode}（dry_run のみ）`);

  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  if (!isLocal(supabaseUrl)) {
    problems.push(`Supabaseがローカルではない（host=${hostOf(supabaseUrl) ?? "不明"}）`);
  }

  const dbUrl = env.SUPABASE_DB_URL ?? env.DATABASE_URL;
  if (dbUrl && !isLocal(dbUrl)) {
    problems.push(`DBがローカルではない（host=${hostOf(dbUrl) ?? "不明"}）`);
  }

  const baseUrl = env.E2E_BASE_URL ?? "http://127.0.0.1:3000";
  if (!isLocal(baseUrl)) problems.push(`E2E_BASE_URLがローカルではない（${baseUrl}）`);

  if (!env.APP_ENCRYPTION_KEY) {
    problems.push("APP_ENCRYPTION_KEY が未設定（fixtureのtoken封緘に必要）");
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    problems.push("SUPABASE_SERVICE_ROLE_KEY が未設定（テストユーザー作成に必要）");
  }

  if (problems.length > 0) {
    throw new Error(
      `E2Eは安全な既定でのみ実行できます。中止した理由:\n- ${problems.join("\n- ")}`,
    );
  }
}

/**
 * devサーバのrouteを先に温める（T-M8-358）。
 *
 * `next dev` はrouteを**最初のリクエストで初めてコンパイルする**ため、
 * 1件目のテストだけがその時間を丸ごと被り、`src/**` を触った直後は
 * 20〜30秒かかることがある（CLAUDE.mdの落とし穴に記録がある事象）。
 * テストの数だけ再現条件が変わるのに、**落ちるのはいつも先頭のspec**という
 * 分かりにくい形になるので、走り出す前にまとめて叩いておく。
 *
 * **失敗しても止めない**——温めは速さのためのもので、正しさの前提ではない。
 * 認証が要るrouteはログイン画面へ流れるが、middlewareとlayoutのコンパイルは進む。
 */
async function warmUpRoutes(baseUrl: string): Promise<void> {
  const paths = [
    "/",
    "/login",
    "/signup",
    "/plans",
    "/app",
    "/app/posts",
    "/app/settings",
    "/app/prompts",
    "/app/schedule",
    "/app/news",
    "/app/analytics",
    "/app/invite",
    // 公開ページも1件目のspecがコンパイルを被る（ブログ本文は動的routeなので別枠）。
    "/blog",
    "/prompt-templates",
  ];
  await Promise.all(
    paths.map((path) =>
      fetch(`${baseUrl}${path}`, { redirect: "manual" }).catch(() => undefined),
    ),
  );
}

export default async function globalSetup(): Promise<void> {
  assertSafeE2eEnv();
  await warmUpRoutes(process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000");
}
