import { describe, expect, it } from "vitest";

import {
  computeXAccountBanners,
  dailyPostLimitBanner,
  legalConsentBanner,
  usageLimitBanner,
} from "./app-banners";
import type { UsageSummary } from "./usage/usage-summary";

const ids = (banners: { id: string }[]) => banners.map((b) => b.id);

function summary(
  over: Partial<Record<"ai_credits" | "normal_posts" | "url_posts", number>> = {},
  options: { concealed?: boolean; paused?: boolean } = {},
): UsageSummary {
  const slot = (remaining: number) => ({ used: 0, limit: 0, remaining });
  const slots = {
    ai_credits: slot(over.ai_credits ?? 10),
    normal_posts: slot(over.normal_posts ?? 10),
    url_posts: slot(over.url_posts ?? 10),
  };
  return {
    ...slots,
    concealed: options.concealed === true,
    // 実物（computeUsageSummary）と同じ既定: どれかの枠が尽きたら paused。
    paused:
      options.paused ??
      Object.values(slots).some((s) => s.remaining <= 0),
  };
}

describe("computeXAccountBanners", () => {
  it("shows no X banners when accounts match the plan and are healthy", () => {
    const banners = computeXAccountBanners({
      plan: "premium",
      xAccounts: [{ status: "active", authType: "managed" }],
      xApiKeyStatus: null,
    });
    expect(banners).toEqual([]);
  });

  it("shows the auth_type re-link banner when an account's auth_type mismatches the plan", () => {
    // premium expects managed; a byok account means a plan change happened
    const banners = computeXAccountBanners({
      plan: "premium",
      xAccounts: [{ status: "expired", authType: "byok" }],
      xApiKeyStatus: null,
    });
    expect(ids(banners)).toEqual(["x_authtype"]); // mismatch takes precedence over generic expired
  });

  it("shows the connection-lost banner for expired/error accounts that still match the plan", () => {
    const banners = computeXAccountBanners({
      plan: "standard",
      xAccounts: [{ status: "expired", authType: "byok" }],
      xApiKeyStatus: "valid",
    });
    expect(ids(banners)).toEqual(["x_status"]);
  });

  it("shows the invalid-key banner for BYOK plans when the X key is invalid", () => {
    const banners = computeXAccountBanners({
      plan: "standard",
      xAccounts: [{ status: "active", authType: "byok" }],
      xApiKeyStatus: "invalid",
    });
    expect(ids(banners)).toEqual(["x_key"]);
  });

  it("does not show the invalid-key banner on premium (no BYOK requirement)", () => {
    const banners = computeXAccountBanners({
      plan: "premium",
      xAccounts: [{ status: "active", authType: "managed" }],
      xApiKeyStatus: "invalid",
    });
    expect(banners).toEqual([]);
  });

  it("ignores disabled accounts for the mismatch banner", () => {
    const banners = computeXAccountBanners({
      plan: "premium",
      xAccounts: [{ status: "disabled", authType: "byok" }],
      xApiKeyStatus: null,
    });
    expect(banners).toEqual([]);
  });

  it("can surface all three X systems at once", () => {
    const banners = computeXAccountBanners({
      plan: "standard", // expects byok
      xAccounts: [
        { status: "active", authType: "managed" }, // mismatch (plan change leftover)
        { status: "expired", authType: "byok" }, // connection lost
      ],
      xApiKeyStatus: "invalid", // BYOK key invalid
    });
    expect(ids(banners)).toEqual(["x_authtype", "x_status", "x_key"]);
  });
});

describe("usageLimitBanner (T-M6-13)", () => {
  it("returns null for non-premium (summary null)", () => {
    expect(usageLimitBanner(null)).toBeNull();
  });

  it("returns null when no slot is at the limit", () => {
    expect(usageLimitBanner(summary())).toBeNull();
  });

  it("shows a warning banner naming the exhausted slots when any remaining is 0", () => {
    const banner = usageLimitBanner(summary({ url_posts: 0, ai_credits: 0 }));
    expect(banner?.id).toBe("usage_limit");
    expect(banner?.tone).toBe("warning");
    expect(banner?.description).toContain("URL付き投稿クレジット");
    expect(banner?.description).toContain("AIクレジット");
    expect(banner?.actionHref).toBe("/app/settings?tab=billing");
  });
});

describe("dailyPostLimitBanner (T-M8-26・要決定D-15 案A)", () => {
  it("上限に達していなければ出さない（残りが少ないだけでは出さない）", () => {
    expect(dailyPostLimitBanner({ todaysPosts: 49, dailyLimit: 50 })).toBeNull();
  });

  it("**上限に達したら出す。** 何件までか・いつ再開するか・自動実行はどうなるかを書く", () => {
    const banner = dailyPostLimitBanner({ todaysPosts: 50, dailyLimit: 50 });
    expect(banner?.id).toBe("daily_post_limit");
    expect(banner?.tone).toBe("warning");
    expect(banner?.description).toContain("50件");
    expect(banner?.description).toContain("翌日0:00（JST）");
    // 自動実行が全部止まると誤解させない（下書き作成は続く）。
    expect(banner?.description).toContain("下書きの作成まで続きます");
    expect(banner?.actionHref).toBe("/app/posts?tab=drafts");
  });

  it("上限を超えていても出す（超過分でバナーが消えない）", () => {
    expect(dailyPostLimitBanner({ todaysPosts: 53, dailyLimit: 50 })?.id).toBe("daily_post_limit");
  });

  it("上限の値は引数のものを使う（envで変えられるため文言に埋め込まない）", () => {
    const banner = dailyPostLimitBanner({ todaysPosts: 20, dailyLimit: 20 });
    expect(banner?.description).toContain("20件");
    expect(banner?.description).not.toContain("50件");
  });
});

/**
 * 再同意バナー（T-M8-134）。
 *
 * **これが出ないと、生成も投稿もスケジュール保存も止まったまま理由が画面に出ない。**
 * 2026-08-18、運営者がスケジュール保存で実際に踏んだ（同意画面はあったが導線が無かった）。
 */
describe("再同意バナー", () => {
  it("どちらも同意済みなら出さない", () => {
    expect(legalConsentBanner({ terms: false, privacy: false })).toBeNull();
  });

  it("必要なものだけ名指しする", () => {
    expect(legalConsentBanner({ terms: true, privacy: false })?.title).toBe(
      "利用規約が更新されました",
    );
    expect(legalConsentBanner({ terms: false, privacy: true })?.title).toBe(
      "プライバシーポリシーが更新されました",
    );
    expect(legalConsentBanner({ terms: true, privacy: true })?.title).toBe(
      "利用規約とプライバシーポリシーが更新されました",
    );
  });

  it("同意画面へ行ける（導線が無かったのが不具合の本体）", () => {
    const banner = legalConsentBanner({ terms: true, privacy: true });
    expect(banner?.actionHref).toBe("/app/consent");
    expect(banner?.tone).toBe("warning");
  });

  it("止まっていることを本文で言う（「確認してください」だけにしない）", () => {
    const banner = legalConsentBanner({ terms: true, privacy: false });
    expect(banner?.description).toContain("実行できません");
    expect(banner?.description).toContain("スケジュール");
  });
});
