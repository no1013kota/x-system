import { describe, expect, it } from "vitest";

import { NEWS_FETCH_CATEGORIES } from "./news";

import { DEFAULT_NOTIFICATION_CONFIG } from "./config-defaults";
import {
  newsConfigSchema,
  notificationConfigSchema,
  resolveNewsConfig,
  resolveNotificationConfig,
} from "./settings";

const fullNotification = {
  news: { in_app: true },
  draft_created: { in_app: true },
  posted: { in_app: false },
  error: { in_app: true },
  billing: { in_app: true },
  usage: { in_app: false },
  summary: { in_app: true },
};

describe("notificationConfigSchema", () => {
  it("accepts all types (in_app only)", () => {
    expect(notificationConfigSchema.safeParse(fullNotification).success).toBe(true);
  });
  it("旧保存値の email キー（ニュース以外）は黙って落とす（strictにすると全既存レコードが既定へ戻る・T-M8-222）", () => {
    const legacy = Object.fromEntries(
      Object.entries(fullNotification).map(([k, v]) => [k, { ...v, email: true }]),
    );
    const parsed = notificationConfigSchema.safeParse(legacy);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.posted).toEqual({ in_app: false });
      // ニュースだけはメールも選べる（T-M8-407）。
      expect(parsed.data.news).toEqual({ in_app: true, email: true });
    }
  });
  it("ニュースの email は省略できる（省略＝保存済みの値を保つ・T-M8-407）", () => {
    const parsed = notificationConfigSchema.safeParse(fullNotification);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.news).toEqual({ in_app: true });
    expect(
      notificationConfigSchema.safeParse({ ...fullNotification, news: { in_app: true, email: "yes" } })
        .success,
    ).toBe(false);
  });
  it("rejects a missing type", () => {
    const { posted, ...rest } = fullNotification;
    void posted;
    expect(notificationConfigSchema.safeParse(rest).success).toBe(false);
  });
  it("rejects an unknown type (strict)", () => {
    expect(
      notificationConfigSchema.safeParse({
        ...fullNotification,
        marketing: { in_app: true },
      }).success,
    ).toBe(false);
  });
  it("rejects a non-boolean channel", () => {
    expect(
      notificationConfigSchema.safeParse({
        ...fullNotification,
        news: { in_app: "yes" },
      }).success,
    ).toBe(false);
  });
});

describe("newsConfigSchema", () => {
  it("accepts valid categories/impact", () => {
    expect(
      newsConfigSchema.safeParse({
        categories: ["ai", "web3"],
        impact_filter: ["high", "mid"],
      }).success,
    ).toBe(true);
  });
  it("旧max_items（廃止済み）は黙って落とす。strictで拒否しない（T-M8-187）", () => {
    // 拒否するとテーマ・インパクトまで既定へフォールバックし、保存済みの選択が消える。
    const parsed = newsConfigSchema.safeParse({
      categories: ["ai"],
      impact_filter: ["high"],
      max_items: 20,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && "max_items" in parsed.data).toBe(false);
  });
  it("rejects empty categories or impact_filter", () => {
    expect(
      newsConfigSchema.safeParse({ categories: [], impact_filter: ["high"] }).success,
    ).toBe(false);
    expect(
      newsConfigSchema.safeParse({ categories: ["ai"], impact_filter: [] }).success,
    ).toBe(false);
  });
  it("rejects duplicates", () => {
    expect(
      newsConfigSchema.safeParse({ categories: ["ai", "ai"], impact_filter: ["high"] }).success,
    ).toBe(false);
  });
  it("rejects unknown category / impact values", () => {
    expect(
      newsConfigSchema.safeParse({ categories: ["ai", "nope"], impact_filter: ["high"] }).success,
    ).toBe(false);
  });
});


describe("resolveNotificationConfig (fallback)", () => {
  it("falls back to §3.4 defaults when unset ({})", () => {
    expect(resolveNotificationConfig({})).toEqual(DEFAULT_NOTIFICATION_CONFIG);
  });
  it("keeps valid per-type overrides and defaults the rest", () => {
    const resolved = resolveNotificationConfig({
      news: { in_app: false, email: false },
      bogus: 1,
    });
    expect(resolved.news).toEqual({ in_app: false, email: false });
    expect(resolved.posted).toEqual(DEFAULT_NOTIFICATION_CONFIG.posted);
  });
  it("ニュースの email は保存値が無ければ OFF、あればその値（T-M8-407）", () => {
    expect(resolveNotificationConfig({ news: { in_app: true } }).news).toEqual({ in_app: true, email: false });
    expect(resolveNotificationConfig({ news: { in_app: true, email: true } }).news).toEqual({
      in_app: true,
      email: true,
    });
    // 他の種別の email（旧保存値）は読まない。
    expect(resolveNotificationConfig({ posted: { in_app: true, email: true } }).posted).toEqual({ in_app: true });
  });
});

describe("resolveNewsConfig (fallback)", () => {
  it("falls back to §3.4 defaults when unset ({})", () => {
    // 既定は**取得している分野**（記事の来ない分野を既定にしない・T-M7-55）。
    expect(resolveNewsConfig({})).toEqual({
      categories: [...NEWS_FETCH_CATEGORIES],
      impact_filter: ["high", "mid"],
    });
  });
  it("passes through a valid config（旧max_itemsは落とす）", () => {
    const cfg = { categories: ["ai"], impact_filter: ["low"] };
    expect(resolveNewsConfig(cfg)).toEqual(cfg);
    expect(resolveNewsConfig({ ...cfg, max_items: 5 })).toEqual(cfg);
  });
});
