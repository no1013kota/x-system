import { describe, expect, it } from "vitest";

import { PATTERN_MAX_POSTS } from "./generation-validation";
import { capPostCount, GENERATION_MAX_POSTS, maxPostsFor } from "./thread-limits";

/**
 * ポスト数の上限（T-M7-41）。プロンプトの分量指示は守られないため、コードで収める。
 * 2026-08-01 実測: P-6は「3〜5ポスト」の指示に対し6ポストを返した。
 */
describe("capPostCount", () => {
  const posts = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

  it("上限内なら何も変えない", () => {
    const r = capPostCount("p6", posts(4));
    expect(r.posts).toEqual(["p1", "p2", "p3", "p4"]);
    expect(r.dropped).toBe(0);
  });

  it("上限ちょうども変えない（境界）", () => {
    expect(capPostCount("p6", posts(5)).dropped).toBe(0);
  });

  it("超過分を落とすが、スレッドの締めは残す", () => {
    // 6ポスト → P-6の上限5。先頭4件＋最後の1件（締め）を残す。
    const r = capPostCount("p6", posts(6));
    expect(r.posts).toEqual(["p1", "p2", "p3", "p4", "p6"]);
    expect(r.dropped).toBe(1);
  });

  it("大きく超過しても上限件数へ収める", () => {
    const r = capPostCount("p4", posts(7));
    expect(r.posts).toEqual(["p1", "p7"]);
    expect(r.dropped).toBe(5);
  });

  it("単発パターン（P-2）は先頭1件だけを残す", () => {
    const r = capPostCount("p2", posts(3));
    expect(r.posts).toEqual(["p1"]);
    expect(r.dropped).toBe(2);
  });

  it("未知パターンは既定の上限を使う（既存の挙動を壊さない）", () => {
    expect(maxPostsFor("unknown")).toBe(8);
    expect(capPostCount("unknown", posts(8)).dropped).toBe(0);
  });

  it("各パターンの上限はプロンプトの分量指示の上端と一致する", () => {
    expect(maxPostsFor("p1")).toBe(4);
    expect(maxPostsFor("p2")).toBe(1);
    expect(maxPostsFor("p3")).toBe(6);
    expect(maxPostsFor("p4")).toBe(2);
    expect(maxPostsFor("p6")).toBe(5);
  });
});

describe("編集の上限との関係", () => {
  it("生成時の上限は編集で許す上限を超えない（生成物が編集不能にならない）", () => {
    for (const [pattern, genMax] of Object.entries(GENERATION_MAX_POSTS)) {
      const editMax = PATTERN_MAX_POSTS[pattern];
      expect(editMax, `${pattern} の編集上限が未定義`).toBeGreaterThan(0);
      expect(genMax, `${pattern}: 生成上限 ${genMax} > 編集上限 ${editMax}`).toBeLessThanOrEqual(editMax);
    }
  });
});
