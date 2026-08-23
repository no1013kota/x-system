import { describe, expect, it, vi } from "vitest";

import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
} from "@/lib/legal";

import {
  loadAppShellDataWithDependencies,
  type AppShellDataDependencies,
  type AppShellProfileRow,
} from "./data";

const PROFILE: AppShellProfileRow = {
  plan: "premium",
  privacy_acknowledged_at: "2026-08-08T00:00:00.000Z",
  privacy_version: CURRENT_PRIVACY_VERSION,
  stripe_customer_id: "cus_test",
  subscription_status: "trialing",
  terms_accepted_at: "2026-08-08T00:00:00.000Z",
  terms_version: CURRENT_TERMS_VERSION,
  trial_ends_at: "2026-08-30T00:00:00.000Z",
  cancel_at_period_end: false,
  current_period_end: "2026-08-30T00:00:00.000Z",
  scheduled_plan: null,
  scheduled_plan_at: null,
};

function dependencies(
  overrides: Partial<AppShellDataDependencies> = {},
): AppShellDataDependencies {
  return {
    countUnreadNotifications: vi.fn().mockResolvedValue(2),
    dailyPostLimit: 50,
    getXApiKeyStatus: vi.fn().mockResolvedValue(null),
    listNotifications: vi.fn().mockResolvedValue({
      items: [
        {
          body: "本文",
          createdAt: "2026-08-19T00:00:00.000Z",
          emailStatus: "sent",
          id: "notification-1",
          link: "/app/news",
          readAt: null,
          title: "通知",
          type: "news",
        },
      ],
      nextCursor: "next-page",
    }),
    listXAccounts: vi.fn().mockResolvedValue([
      {
        authType: "managed",
        automationActive: false,
        handle: "active_user",
        id: "account-active",
        isActive: true,
        name: "Active",
        profileImageUrl: null,
        status: "active",
      },
      {
        authType: "byok",
        automationActive: false,
        handle: "disabled_user",
        id: "account-disabled",
        isActive: false,
        name: "Disabled",
        profileImageUrl: null,
        status: "disabled",
      },
    ]),
    loadProfile: vi.fn().mockResolvedValue(PROFILE),
    loadTodaysPostCount: vi.fn().mockResolvedValue(50),
    loadUsageSummary: vi.fn().mockResolvedValue({
      ai_credits: { limit: 100, remaining: 0, used: 100 },
      normal_posts: { limit: 100, remaining: 20, used: 80 },
      url_posts: { limit: 100, remaining: 10, used: 90 },
    }),
    resolveActiveXAccount: vi.fn().mockResolvedValue("account-active"),
    ...overrides,
  };
}

describe("loadAppShellDataWithDependencies", () => {
  it("independent sourcesを表示用データへ組み立てる", async () => {
    const deps = dependencies();

    const result = await loadAppShellDataWithDependencies("user-1", deps);

    expect(result.activeAccountId).toBe("account-active");
    expect(result.switcherAccounts).toEqual([
      {
        handle: "active_user",
        id: "account-active",
        profileImageUrl: null,
      },
    ]);
    expect(result.unreadCount).toBe(2);
    expect(result.notifications).toHaveLength(1);
    expect(result.notificationCursor).toBe("next-page");
    expect(result.subscriptionBanner?.title).toBe("無料トライアル中");
    expect(result.stripeCustomerId).toBe("cus_test");
    expect(result.consentBanner).toBeNull();
    expect(result.usageBanner?.id).toBe("usage_limit");
    expect(result.dailyPostBanner?.id).toBe("daily_post_limit");
    expect(result.xBanners).toEqual([]);
  });

  it("profileが無いとplan依存の第2波を実行しない", async () => {
    const deps = dependencies({ loadProfile: vi.fn().mockResolvedValue(null) });

    const result = await loadAppShellDataWithDependencies("user-1", deps);

    expect(deps.loadUsageSummary).not.toHaveBeenCalled();
    expect(deps.loadTodaysPostCount).not.toHaveBeenCalled();
    expect(result.subscriptionBanner).toBeNull();
    expect(result.stripeCustomerId).toBeNull();
    expect(result.usageBanner).toBeNull();
  });

  it("active Xアカウントが無ければ日次投稿数を読まない", async () => {
    const deps = dependencies({
      resolveActiveXAccount: vi.fn().mockResolvedValue(null),
    });

    const result = await loadAppShellDataWithDependencies("user-1", deps);

    expect(deps.loadUsageSummary).toHaveBeenCalledWith("user-1", "premium");
    expect(deps.loadTodaysPostCount).not.toHaveBeenCalled();
    expect(result.dailyPostBanner).toBeNull();
  });

  it("古い法務versionとX連携不一致を共通バナーへ変換する", async () => {
    const deps = dependencies({
      getXApiKeyStatus: vi.fn().mockResolvedValue("invalid"),
      loadProfile: vi.fn().mockResolvedValue({
        ...PROFILE,
        plan: "standard",
        privacy_version: "old",
        subscription_status: "active",
        terms_version: "old",
      }),
    });

    const result = await loadAppShellDataWithDependencies("user-1", deps);

    expect(result.consentBanner?.id).toBe("legal-consent");
    expect(result.xBanners.map((banner) => banner.id)).toEqual([
      "x_authtype",
      "x_key",
    ]);
  });

  /**
   * **portの失敗を通常のshellへ変換しない**（T-M8-158・原則1）。
   * ここで `.catch(() => null)` のような握り潰しを足すと、profileが読めないときに
   * 再同意・契約・利用枠・X連携のバナーが全部消えた「正常に見える画面」が出る。
   * 失敗はそのまま伝播させ、error boundary（`src/app/error.tsx`）に見せる。
   */
  it("profile取得が失敗したら伝播させ、plan依存の第2波も走らせない", async () => {
    const failure = new Error("read failed");
    const deps = dependencies({
      loadProfile: vi.fn().mockRejectedValue(failure),
    });

    await expect(
      loadAppShellDataWithDependencies("user-1", deps),
    ).rejects.toThrow(failure);
    expect(deps.loadUsageSummary).not.toHaveBeenCalled();
    expect(deps.loadTodaysPostCount).not.toHaveBeenCalled();
  });
});
