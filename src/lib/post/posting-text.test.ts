import { describe, expect, it } from "vitest";

import {
  counterTypeFor,
  finalPostText,
  finalTextResolver,
  hasUrl,
  postConsumeKey,
} from "./posting-text";

/**
 * 投稿本文の最終形と、そこから決まる課金区分・冪等key（R24）。
 *
 * 投稿は「通常の投稿job」と「結果不明を後から突き合わせる経路」の2つから確定する。
 * 以前はこの3点が2ファイルに別々に定義されており、ずれると
 * **課金区分が経路で変わる／同じ投稿を二重に数える／同じ投稿を別物と誤判定して再送する**
 * ことになる。ここが正本であることを固定する。
 */

describe("hasUrl / counterTypeFor", () => {
  it("http・httpsのURLを検出する", () => {
    expect(hasUrl("詳しくは https://example.com/a を見てください")).toBe(true);
    expect(hasUrl("http://example.com")).toBe(true);
    expect(hasUrl("URLはありません")).toBe(false);
  });

  it("空白まででURLを区切る（\\S+）", () => {
    expect(hasUrl("https://example.com 続きの文")).toBe(true);
    // スキームが無いものはURL扱いしない（課金区分が変わるため厳密に）。
    expect(hasUrl("example.com")).toBe(false);
  });

  it("URLの有無で課金区分が決まる", () => {
    expect(counterTypeFor("https://example.com")).toBe("post_url");
    expect(counterTypeFor("ただの本文")).toBe("post_normal");
  });
});

describe("finalPostText / finalTextResolver", () => {
  const thread = [{ text: "1本目" }, { text: "2本目" }];

  it("1ポスト目だけ引用URLを改行で末尾合成する（要件04 §10 step5）", () => {
    expect(finalPostText(thread, 0, "https://x.com/a/status/1")).toBe(
      "1本目\nhttps://x.com/a/status/1",
    );
    expect(finalPostText(thread, 1, "https://x.com/a/status/1")).toBe("2本目");
  });

  it("引用URLが無ければ本文のまま", () => {
    expect(finalPostText(thread, 0, null)).toBe("1本目");
    expect(finalPostText(thread, 0, undefined)).toBe("1本目");
  });

  it("引用URLがある1ポスト目は課金区分がpost_urlになる（本文にURLが無くても）", () => {
    const at = finalTextResolver(thread, "https://x.com/a/status/1");
    expect(counterTypeFor(at(0))).toBe("post_url");
    expect(counterTypeFor(at(1))).toBe("post_normal");
  });
});

describe("postConsumeKey", () => {
  it("作成と削除で別のkeyになる", () => {
    expect(postConsumeKey("d1", "t1", "post_create")).toBe("draft:d1:tweet:t1:post:create");
    expect(postConsumeKey("d1", "t1", "post_delete")).toBe("draft:d1:tweet:t1:post:delete");
  });

  it("同じ投稿なら経路によらず同じkeyになる（二重計上を防ぐ要）", () => {
    // 投稿job側と突き合わせ側が同じ引数から同じ文字列を作ることを固定する。
    expect(postConsumeKey("d1", "t1", "post_create")).toBe(
      postConsumeKey("d1", "t1", "post_create"),
    );
  });
});
