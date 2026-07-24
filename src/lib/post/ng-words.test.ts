import { describe, expect, it } from "vitest";

import { hasNgWord, matchNgWords } from "./ng-words";

describe("matchNgWords", () => {
  it("matches substrings case-insensitively", () => {
    expect(matchNgWords("これはNGワードです", ["NGワード"])).toEqual(["NGワード"]);
    expect(matchNgWords("Buy CRYPTO now", ["crypto"])).toEqual(["crypto"]);
  });

  it("returns every distinct matched word in input order", () => {
    expect(matchNgWords("絶対儲かる投資はギャンブル", ["儲かる", "ギャンブル", "無関係"])).toEqual([
      "儲かる",
      "ギャンブル",
    ]);
  });

  it("ignores blank ng entries and de-duplicates", () => {
    expect(matchNgWords("spam spam", ["", "  ", "spam", "spam"])).toEqual(["spam"]);
  });

  it("returns [] when nothing matches", () => {
    expect(matchNgWords("clean text", ["forbidden"])).toEqual([]);
  });

  it("hasNgWord reflects matches", () => {
    expect(hasNgWord("has forbidden term", ["forbidden"])).toBe(true);
    expect(hasNgWord("clean", ["forbidden"])).toBe(false);
  });
});
