import { describe, expect, it } from "vitest";

import { canPostThreadToday, remainingDailyPosts } from "./daily-post-limit";

/**
 * 日次投稿上限の判定（T-M8-26・要決定D-15 案A）。
 *
 * **画面のバナーと投稿jobが同じ関数を使う**ことが肝心なので、境界をここで固定する。
 * 別々に持つと「バナーは出ないのに投稿は弾かれる」というもっとも分かりにくい食い違いになる。
 */
describe("remainingDailyPosts", () => {
  it("まだ余裕があれば残り件数を返す", () => {
    expect(remainingDailyPosts(10, 50)).toBe(40);
  });

  it("ちょうど上限で0になる（バナーが出る境界）", () => {
    expect(remainingDailyPosts(50, 50)).toBe(0);
  });

  it("**上限を超えていてもマイナスにしない**（「残り-3件」を画面に出さないため）", () => {
    expect(remainingDailyPosts(53, 50)).toBe(0);
  });

  it("1件も投稿していなければ上限そのまま", () => {
    expect(remainingDailyPosts(0, 50)).toBe(50);
  });
});

describe("canPostThreadToday", () => {
  it("スレッド全体が収まれば投稿できる", () => {
    expect(canPostThreadToday(45, 50, 5)).toBe(true);
  });

  it("**途中までしか収まらないなら投稿しない**（読めないスレッドがXに残るため）", () => {
    expect(canPostThreadToday(46, 50, 5)).toBe(false);
  });

  it("上限に達していれば1ポストでも投稿できない", () => {
    expect(canPostThreadToday(50, 50, 1)).toBe(false);
  });

  it("バナーが出る状態（残り0）と投稿できない状態が一致する", () => {
    const todays = 50;
    expect(remainingDailyPosts(todays, 50)).toBe(0);
    expect(canPostThreadToday(todays, 50, 1)).toBe(false);
  });
});
