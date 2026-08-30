import { describe, expect, it } from "vitest";

import { parseFeed } from "./rss";

/**
 * RSSパーサ（T-M8-380）。実フィードの縮小サンプルで、RSS2.0・Atom・CDATA・実体参照・
 * 壊れたXMLの各形を固定する。パーサはニュースの入口なので、ここが黙って0件になると
 * 分野全体が「該当なし」に見える——形式ごとに最低1本のフィクスチャを持つ。
 */
describe("parseFeed", () => {
  it("RSS 2.0（ITmedia型）: title/link/pubDate/description を取り出す", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>ITmedia AI＋</title>
<item>
<title>生成AIの新モデルが公開</title>
<link>https://www.itmedia.co.jp/aiplus/articles/1.html</link>
<pubDate>Sat, 30 Aug 2026 10:00:00 +0900</pubDate>
<description><![CDATA[<p>新モデルが<b>公開</b>された。</p>]]></description>
</item>
<item><title>2本目 &amp; 続報</title><link>https://example.com/2</link></item>
</channel></rss>`;
    const entries = parseFeed(xml);
    expect(entries).toHaveLength(2);
    expect(entries[0].title).toBe("生成AIの新モデルが公開");
    expect(entries[0].link).toBe("https://www.itmedia.co.jp/aiplus/articles/1.html");
    expect(entries[0].publishedAt).toBe("2026-08-30T01:00:00.000Z");
    expect(entries[0].snippet).toBe("新モデルが 公開 された。");
    expect(entries[1].title).toBe("2本目 & 続報");
    expect(entries[1].publishedAt).toBeNull();
  });

  it("Atom（Publickey型）: entry / link href / updated を取り出す", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<entry>
<title type="html">Kubernetes 1.35リリース</title>
<link rel="alternate" type="text/html" href="https://www.publickey1.jp/blog/k8s135.html"/>
<updated>2026-08-29T21:30:00+09:00</updated>
<summary type="html">&lt;p&gt;新機能の概要。&lt;/p&gt;</summary>
</entry>
</feed>`;
    const entries = parseFeed(xml);
    expect(entries).toHaveLength(1);
    expect(entries[0].link).toBe("https://www.publickey1.jp/blog/k8s135.html");
    expect(entries[0].publishedAt).toBe("2026-08-29T12:30:00.000Z");
    expect(entries[0].snippet).toBe("新機能の概要。");
  });

  it("linkが無い・httpでないitemは捨て、壊れたXMLでも例外にしない", () => {
    expect(parseFeed("<rss><channel><item><title>t</title></item></channel>")).toEqual([]);
    expect(
      parseFeed(`<rss><item><title>t</title><link>ftp://x/y</link></item></rss>`),
    ).toEqual([]);
    expect(parseFeed("これはXMLではない")).toEqual([]);
  });

  it("snippetは500字で打ち切る（要約の材料であって全文は要らない）", () => {
    const xml = `<rss><item><title>t</title><link>https://e.com/1</link><description>${"あ".repeat(700)}</description></item></rss>`;
    expect(parseFeed(xml)[0].snippet).toHaveLength(500);
  });
});
