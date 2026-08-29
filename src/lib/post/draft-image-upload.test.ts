import { describe, expect, it } from "vitest";

import {
  assertUploadableImage,
  draftImagePath,
  replacedImagePaths,
  UPLOAD_MAX_INPUT_BYTES,
  uploadedImagesJson,
} from "./draft-image-upload";

/**
 * 下書きへ自分で画像を添える（T-M8-353）。
 *
 * ここで守るのは2つ。**断る理由が画面にそのまま出ること**（「アップロードできません」だけだと
 * 何を直せばよいか分からない）と、**投稿に使われる1枚と画面の1枚がずれないこと**。
 */
describe("draft image upload", () => {
  const file = (over: Partial<{ name: string; type: string; size: number }> = {}) => ({
    name: "a.png",
    type: "image/png",
    size: 1024,
    ...over,
  });

  it("PNG・JPEG・WEBPは受け取る", () => {
    for (const type of ["image/png", "image/jpeg", "image/webp"]) {
      expect(() => assertUploadableImage(file({ type }))).not.toThrow();
    }
  });

  it("対応していない形式は「何を選べばよいか」を言って断る", () => {
    expect(() => assertUploadableImage(file({ type: "image/gif" }))).toThrowError(
      /PNG・JPEG・WEBP/,
    );
  });

  it("空ファイルと大きすぎるファイルは、理由つきで断る", () => {
    expect(() => assertUploadableImage(file({ size: 0 }))).toThrowError(/空です/);
    // 上限はXの画像上限＝5MBに合わせ、Server Action の bodySizeLimit と揃える（T-M8-367）。
    expect(() =>
      assertUploadableImage(file({ size: UPLOAD_MAX_INPUT_BYTES + 1 })),
    ).toThrowError(/5MBまで/);
  });

  it("置き場は生成画像と同じ並び（利用者/アカウント/下書き/画像ID）", () => {
    expect(
      draftImagePath({ userId: "u", xAccountId: "x", draftId: "d", localId: "l", ext: "png" }),
    ).toBe("u/x/d/l.png");
  });

  /**
   * **投稿に使われるのは最初の `ready` 画像1枚**（`post-publish`）。足す形にすると
   * 画面には2枚あるのに投稿されるのは片方、という説明できない状態になる。
   */
  it("アップロードは置き換え。古い画像のpathは削除対象として返る", () => {
    const next = {
      local_id: "new",
      storage_path: "u/x/d/new.png",
      status: "ready",
      provider: "upload",
    };
    expect(uploadedImagesJson(next)).toEqual([next]);
    expect(
      replacedImagePaths(
        [
          { local_id: "old", storage_path: "u/x/d/old.png", status: "ready" },
          { local_id: "new", storage_path: "u/x/d/new.png", status: "ready" },
        ],
        "u/x/d/new.png",
      ),
      "残す1枚は消さない",
    ).toEqual(["u/x/d/old.png"]);
  });
});
