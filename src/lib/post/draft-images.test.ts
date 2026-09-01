import { describe, expect, it } from "vitest";

import {
  effectiveImagePost,
  imagePathsForPost,
  imagesReplacingPost,
  readyImageForPost,
} from "./draft-images";

/** ポスト別画像の割り当て規則（T-M8-398）。旧データ（post_local_id無し）は1ポスト目扱い。 */
describe("draft-images (T-M8-398)", () => {
  interface TestImage {
    local_id: string;
    post_local_id?: string;
    status?: string;
    storage_path?: string;
  }
  const img = (over: Partial<TestImage>): TestImage => ({
    local_id: "i",
    status: "ready",
    storage_path: "a/b",
    ...over,
  });

  it("post_local_id 無しの旧画像は1ポスト目のものとして扱う", () => {
    expect(effectiveImagePost({}, "p1")).toBe("p1");
    expect(readyImageForPost([img({})], "p1", "p1")).toBeDefined();
    expect(readyImageForPost([img({})], "p1", "p2")).toBeUndefined();
  });

  it("差し替えは対象ポストだけ（他ポストの画像は残る）", () => {
    const current = [
      img({ local_id: "a", post_local_id: "p1", storage_path: "x/1" }),
      img({ local_id: "b", post_local_id: "p2", storage_path: "x/2" }),
    ];
    const next = img({ local_id: "c", post_local_id: "p2", storage_path: "x/3" });
    const replaced = imagesReplacingPost(current, "p1", next as never);
    expect(replaced.map((i) => (i as TestImage).local_id)).toEqual(["a", "c"]);
  });

  it("旧画像（無印）は1ポスト目の差し替えで置き換わる", () => {
    const current = [img({ local_id: "legacy" })];
    const next = img({ local_id: "n", post_local_id: "p1" });
    expect(imagesReplacingPost(current, "p1", next as never).map((i) => (i as TestImage).local_id)).toEqual(["n"]);
  });

  it("削除対象のpathは対象ポストの分だけ", () => {
    const current = [
      img({ post_local_id: "p1", storage_path: "x/1" }),
      img({ post_local_id: "p2", storage_path: "x/2" }),
      img({ post_local_id: "p2", storage_path: "", status: "failed" }),
    ];
    expect(imagePathsForPost(current, "p1", "p2")).toEqual(["x/2"]);
  });
});
