export const PLAN_REQUIRED_STATUSES = new Set([
  "incomplete",
  "incomplete_expired",
]);

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
    !profile?.plan ||
    PLAN_REQUIRED_STATUSES.has(profile.subscription_status);
  if (requiresPlan && !isLimitedSettingsRoute(url)) return "/plans";
  return null;
}
