import { canBrowseApp } from "./subscription-access";

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

export function isLimitedSettingsRoute(url: URL): boolean {
  // 契約切れでも開ける設定タブ。問い合わせタブは廃止（T-M8-104）——旧 support リンクは
  // billing 同様に開ける扱いを保つ（DB保存済みリンクを行き止まりにしない）。
  return (
    url.pathname === "/app/settings" &&
    ["billing", "support"].includes(url.searchParams.get("tab") ?? "")
  );
}

function loginDestination(url: URL): string {
  const destination = new URL("/login", url.origin);
  destination.searchParams.set("next", `${url.pathname}${url.search}`);
  return `${destination.pathname}${destination.search}`;
}

/** Resolves only route-level authentication and subscription redirects. */
export function routeGuardDestination({
  profile,
  url,
  userId,
}: RouteGuardInput): string | null {
  if (!isProtectedRoute(url.pathname)) return null;
  if (!userId) return loginDestination(url);
  if (!url.pathname.startsWith("/app")) return null;

  const requiresPlan =
    !profile?.plan || !canBrowseApp(profile.subscription_status);
  if (requiresPlan && !isLimitedSettingsRoute(url)) return "/plans";
  return null;
}
