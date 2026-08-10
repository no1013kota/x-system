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
  news: { in_app: true, email: true },
  draft_created: { in_app: true, email: false },
  posted: { in_app: false, email: false },
  error: { in_app: true, email: true },
  billing: { in_app: true, email: true },
  usage: { in_app: false, email: true },
        summary: { in_app: true, email: true },
};

describe("notificationConfigSchema", () => {
  it("accepts all 6 types with both channels", () => {
    expect(notificationConfigSchema.safeParse(fullNotification).success).toBe(true);
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
        marketing: { in_app: true, email: true },
      }).success,
    ).toBe(false);
  });
  it("rejects a non-boolean channel", () => {
    expect(
      notificationConfigSchema.safeParse({
        ...fullNotification,
        news: { in_app: "yes", email: true },
      }).success,
    ).toBe(false);
  });
});

describe("newsConfigSchema", () => {
  it("accepts valid categories/impact/max_items", () => {
    expect(
      newsConfigSchema.safeParse({
        categories: ["ai", "web3"],
        impact_filter: ["high", "mid"],
        max_items: 20,
      }).success,
    ).toBe(true);
  });
  it("rejects empty categories or impact_filter", () => {
    expect(
      newsConfigSchema.safeParse({
        categories: [],
        impact_filter: ["high"],
        max_items: 10,
      }).success,
    ).toBe(false);
    expect(
      newsConfigSchema.safeParse({
        categories: ["ai"],
        impact_filter: [],
        max_items: 10,
      }).success,
    ).toBe(false);
  });
  it("rejects duplicates", () => {
    expect(
      newsConfigSchema.safeParse({
        categories: ["ai", "ai"],
        impact_filter: ["high"],
        max_items: 10,
      }).success,
    ).toBe(false);
  });
  it("rejects unknown category / impact values", () => {
    expect(
      newsConfigSchema.safeParse({
        categories: ["ai", "nope"],
        impact_filter: ["high"],
        max_items: 10,
      }).success,
    ).toBe(false);
  });
  it("rejects max_items outside 1..100", () => {
    expect(
      newsConfigSchema.safeParse({
        categories: ["ai"],
        impact_filter: ["high"],
        max_items: 0,
      }).success,
    ).toBe(false);
    expect(
      newsConfigSchema.safeParse({
        categories: ["ai"],
        impact_filter: ["high"],
        max_items: 101,
      }).success,
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
});

describe("resolveNewsConfig (fallback)", () => {
  it("falls back to §3.4 defaults when unset ({})", () => {
    // 既定は**取得している分野**（記事の来ない分野を既定にしない・T-M7-55）。
    expect(resolveNewsConfig({})).toEqual({
      categories: [...NEWS_FETCH_CATEGORIES],
      impact_filter: ["high", "mid"],
      max_items: 20,
    });
  });
  it("passes through a valid config", () => {
    const cfg = { categories: ["ai"], impact_filter: ["low"], max_items: 5 };
    expect(resolveNewsConfig(cfg)).toEqual(cfg);
  });
});
