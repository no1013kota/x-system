import { describe, expect, it } from "vitest";

import {
  isLimitedSettingsRoute,
  isProtectedRoute,
  routeGuardDestination,
} from "./route-guard";

const BASE = "https://app.example.com";

function destination(
  path: string,
  input: {
    plan?: string | null;
    status?: string;
    userId?: string | null;
  } = {},
) {
  const userId = input.userId === undefined ? "user-1" : input.userId;
  return routeGuardDestination({
    profile: userId
      ? {
          plan: input.plan === undefined ? "standard" : input.plan,
          subscription_status: input.status ?? "active",
        }
      : null,
    url: new URL(path, BASE),
    userId,
  });
}

describe("route guards", () => {
  it.each(["/app", "/app/posts?tab=drafts", "/plans"])(
    "redirects a signed-out request for %s to login with an internal next",
    (path) => {
      expect(destination(path, { userId: null })).toBe(
        `/login?next=${encodeURIComponent(path)}`,
      );
    },
  );

  it.each(["/", "/login", "/signup", "/auth/confirm", "/application"])(
    "leaves the public route %s unguarded",
    (path) => {
      expect(destination(path, { userId: null })).toBeNull();
      expect(isProtectedRoute(path)).toBe(false);
    },
  );

  it.each([
    { plan: null, status: "active" },
    { plan: "standard", status: "incomplete" },
    { plan: "premium", status: "incomplete_expired" },
  ])("redirects an unselected or incomplete plan to plans", (profile) => {
    expect(destination("/app/posts", profile)).toBe("/plans");
  });

  it.each(["billing", "support"])(
    "allows incomplete users to reach the %s settings tab",
    (tab) => {
      const path = `/app/settings?tab=${tab}`;
      expect(
        destination(path, { plan: null, status: "incomplete" }),
      ).toBeNull();
      expect(isLimitedSettingsRoute(new URL(path, BASE))).toBe(true);
    },
  );

  it.each([
    "/app/settings",
    "/app/settings?tab=api-keys",
    "/app/settings/billing",
  ])("redirects incomplete users away from non-billing settings %s", (path) => {
    expect(destination(path, { status: "incomplete" })).toBe("/plans");
  });

  it.each(["trialing", "active", "past_due", "unpaid", "paused", "canceled"])(
    "allows %s users to browse app routes",
    (status) => {
      expect(destination("/app/posts?tab=history", { status })).toBeNull();
    },
  );
});
