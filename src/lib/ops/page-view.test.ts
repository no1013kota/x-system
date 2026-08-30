import { describe, expect, it } from "vitest";

import { isCountableUserAgent, visitorHashFor } from "./page-view";

describe("ページ閲覧の記録（T-M8-378）", () => {
  it("botと空のUAは数えない。実ブラウザとHeadlessChromeは数える", () => {
    expect(isCountableUserAgent(null)).toBe(false);
    expect(isCountableUserAgent("")).toBe(false);
    expect(isCountableUserAgent("Googlebot/2.1 (+http://www.google.com/bot.html)")).toBe(false);
    expect(isCountableUserAgent("UptimeRobot/2.0")).toBe(false);
    expect(isCountableUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe(true);
    // E2Eがこの記録自体を検証できるよう、headlessはわざと数える（page-view.ts参照）。
    expect(isCountableUserAgent("Mozilla/5.0 HeadlessChrome/128.0")).toBe(true);
  });

  it("ハッシュは日替わり（同じ人でも日が変わると別の値＝日をまたいだ突合はできない）", () => {
    const a = visitorHashFor("secret", "2026-08-30", "203.0.113.1", "UA");
    const same = visitorHashFor("secret", "2026-08-30", "203.0.113.1", "UA");
    const nextDay = visitorHashFor("secret", "2026-08-31", "203.0.113.1", "UA");
    const otherIp = visitorHashFor("secret", "2026-08-30", "203.0.113.2", "UA");
    expect(a).toBe(same);
    expect(a).not.toBe(nextDay);
    expect(a).not.toBe(otherIp);
    // 生のIP・UAがそのまま含まれない（HMACの出力32桁だけ）。
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });
});
