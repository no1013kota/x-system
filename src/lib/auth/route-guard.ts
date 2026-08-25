interface GuardProfile {
  plan: string | null;
  subscription_status: string;
}

interface RouteGuardInput {
  profile: GuardProfile | null;
  url: URL;
  userId: string | null;
}

export function isProtectedRoute(pathname: string): boolean {
  return (
    pathname === "/plans" ||
    pathname === "/app" ||
    pathname.startsWith("/app/")
  );
}

function loginDestination(url: URL): string {
  const destination = new URL("/login", url.origin);
  destination.searchParams.set("next", `${url.pathname}${url.search}`);
  return `${destination.pathname}${destination.search}`;
}

/**
 * Resolves route-level authentication redirects (要件03 §5, T-M8-268).
 *
 * **契約状態では画面を弾かない**（運営者の指示 2026-08-23）。登録しただけの利用者も解約した
 * 利用者も、まず通常の画面を見て、**何かを実行しようとしたときに**プラン選択へ案内する
 * （その判定は Server Action / job lease 側の契約ガード＝要件04 §4.1 が持つ）。
 * 画面を隠すと、招待キャンペーンへの参加も、再開の判断に必要な自分のデータの確認もできない。
 *
 * `profile` は受け取るが判定には使わない——middleware（`update-session.ts`）が同じ形で
 * 呼び出しており、将来ここで契約を見たくなったときの引数を保つ。
 */
export function routeGuardDestination({
  url,
  userId,
}: RouteGuardInput): string | null {
  if (!isProtectedRoute(url.pathname)) return null;
  if (!userId) return loginDestination(url);
  return null;
}
