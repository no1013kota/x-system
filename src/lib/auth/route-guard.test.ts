import { describe, expect, it } from "vitest";

import { isProtectedRoute, routeGuardDestination } from "./route-guard";

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

  /**
   * 契約状態で画面を弾かない（T-M8-268・運営者の指示 2026-08-23）。
   *
   * 登録しただけの利用者も解約した利用者も通常の画面を見られる——招待キャンペーンへの参加も、
   * 再開の判断に必要な自分のデータの確認も、画面を隠すとできない。実行の抑止は
   * Server Action と job lease の契約ガード（要件04 §4.1）が持つ。
   */
  it.each([
    { plan: null, status: "incomplete", label: "登録しただけ（プラン未選択）" },
    { plan: "premium", status: "canceled", label: "解約済み" },
    { plan: "premium", status: "past_due", label: "支払い確認中" },
    { plan: "standard", status: "incomplete_expired", label: "申し込み期限切れ" },
    { plan: "premium", status: "trialing", label: "トライアル中" },
    { plan: "premium", status: "active", label: "契約中" },
  ])("$label は /app 配下を閲覧できる", ({ plan, status }) => {
    for (const path of ["/app", "/app/posts", "/app/invite", "/app/settings?tab=billing"]) {
      expect(destination(path, { plan, status })).toBeNull();
    }
  });

  it("プロフィールが読めなくても閲覧は止めない（実行側で止まる）", () => {
    expect(
      routeGuardDestination({ profile: null, url: new URL("/app", BASE), userId: "user-1" }),
    ).toBeNull();
  });
});
