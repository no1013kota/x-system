import { describe, expect, it } from "vitest";

import {
  clampNewsMaxItems,
  NEWS_MAX_ITEMS_MAX,
  NEWS_MAX_ITEMS_MIN,
} from "./config-defaults";

/**
 * ニュース表示件数の丸め（T-M8-37）。設定画面とニュース一覧で**同じ関数**を使うための正本。
 * 以前は片方だけがクランプしており、同じ設定項目が画面によって挙動が違った。
 */
describe("clampNewsMaxItems", () => {
  it("範囲内はそのまま", () => {
    expect(clampNewsMaxItems(20)).toBe(20);
    expect(clampNewsMaxItems(NEWS_MAX_ITEMS_MIN)).toBe(NEWS_MAX_ITEMS_MIN);
    expect(clampNewsMaxItems(NEWS_MAX_ITEMS_MAX)).toBe(NEWS_MAX_ITEMS_MAX);
  });

  it("下限・上限を超えたら丸める", () => {
    expect(clampNewsMaxItems(0)).toBe(NEWS_MAX_ITEMS_MIN);
    expect(clampNewsMaxItems(-5)).toBe(NEWS_MAX_ITEMS_MIN);
    expect(clampNewsMaxItems(101)).toBe(NEWS_MAX_ITEMS_MAX);
  });

  // 欄を空にすると `Number("")` は 0、削除中の入力では NaN になり得る。
  // どちらも「サーバー検証で弾かれる値」なので、入力の時点で下限へ寄せる。
  it("数値にならない入力は下限へ寄せる", () => {
    expect(clampNewsMaxItems(Number(""))).toBe(NEWS_MAX_ITEMS_MIN);
    expect(clampNewsMaxItems(Number.NaN)).toBe(NEWS_MAX_ITEMS_MIN);
  });

  it("小数は切り捨てる（件数は整数・zodも int を要求する）", () => {
    expect(clampNewsMaxItems(7.9)).toBe(7);
  });
});
