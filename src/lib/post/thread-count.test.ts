import { describe, expect, it } from "vitest";

import {
  PATTERN_MAX_POSTS_LIMIT,
  PATTERN_MAX_THREAD_COUNT,
  maxPostsFromThreadCount,
  threadCountLabel,
  threadCountOf,
} from "./post-patterns-store";

/**
 * 総ポスト数 ⇄ スレッド数の変換（T-M8-130・運営者の指示 2026-08-18）。
 *
 * **DBは総ポスト数、画面はスレッド数。** ここがずれると、画面で「3」と設定したのに
 * 4ポスト作られる（またはその逆）という、利用者からは原因の分からない食い違いになる。
 * 往復して元に戻ることを固定する。
 */
describe("スレッド数の表し方", () => {
  it("0 はメインポストのみ（総1ポスト）", () => {
    expect(maxPostsFromThreadCount(0)).toBe(1);
    expect(threadCountOf(1)).toBe(0);
    expect(threadCountLabel(1)).toBe("メインポストのみ（単発）");
  });

  it("スレッド数 N は総 N+1 ポスト", () => {
    for (let n = 0; n <= PATTERN_MAX_THREAD_COUNT; n++) {
      expect(maxPostsFromThreadCount(n), `スレッド${n}`).toBe(n + 1);
      expect(threadCountOf(n + 1), `総${n + 1}ポスト`).toBe(n);
    }
  });

  it("上限は 7（総8ポスト）で、超えても切り上げない", () => {
    expect(PATTERN_MAX_THREAD_COUNT).toBe(7);
    expect(maxPostsFromThreadCount(PATTERN_MAX_THREAD_COUNT)).toBe(PATTERN_MAX_POSTS_LIMIT);
    expect(maxPostsFromThreadCount(99), "上限で頭打ちにする").toBe(PATTERN_MAX_POSTS_LIMIT);
  });

  it("負の値は 0（単発）として扱う（画面から来ない値でも壊れない）", () => {
    expect(maxPostsFromThreadCount(-3)).toBe(1);
    expect(threadCountOf(0)).toBe(0);
  });

  it("既定6件の表示が設定と一致する", () => {
    // seed の総ポスト数（`20260818000001` の値）→ 画面のスレッド数。
    const cases: [number, string][] = [
      [4, "メイン＋スレッド最大3"], // ニュース解説
      [1, "メインポストのみ（単発）"], // 自分の考え・意見
      [6, "メイン＋スレッド最大5"], // ノウハウ・ハウツー
      [2, "メイン＋スレッド最大1"], // トレンド便乗
      [3, "メイン＋スレッド最大2"], // 引用ポスト
      [5, "メイン＋スレッド最大4"], // 週次まとめ
    ];
    for (const [maxPosts, label] of cases) {
      expect(threadCountLabel(maxPosts), `総${maxPosts}ポスト`).toBe(label);
    }
  });
});
