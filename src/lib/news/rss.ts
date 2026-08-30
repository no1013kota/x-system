/**
 * RSS/Atomフィードの最小パーサ（T-M8-380・運営者の指示 2026-08-30）。
 *
 * 依存を増やさない（このリポジトリの方針）。フルXMLパーサではなく、
 * ニュース取得に必要な4項目（title / link / 日時 / 概要）だけを取り出す。
 * 対応形式: RSS 2.0・RSS 1.0（RDF）＝`<item>`、Atom＝`<entry>`。
 *
 * **壊れたフィードで例外にしない**——読めた分だけ返す（1本のフィードの不調で
 * 分野全体を失敗させない。呼び出し側はitem数0を「取れなかった」として扱える）。
 */

export interface FeedEntry {
  title: string;
  /** リンク（絶対URL）。無いitemは捨てる。 */
  link: string;
  /** ISO8601。読めない・無い場合は null（呼び出し側が取得時刻扱いにする）。 */
  publishedAt: string | null;
  /** description/summary をタグ除去したテキスト（要約の材料）。 */
  snippet: string;
}

/** CDATAを剥がし、数値・名前付き実体を戻し、タグを落とす。 */
function textOf(raw: string): string {
  let s = raw.trim();
  const cdata = s.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) s = cdata[1];
  s = s.replace(/<[^>]+>/g, " ");
  s = s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
  // 実体参照を戻すとタグが現れることがある（Atomの type="html" は &lt;p&gt; 形式）。もう1周落とす。
  s = s.replace(/<[^>]+>/g, " ");
  return s.replace(/\s+/g, " ").trim();
}

/** ブロック内の最初の `<tag>…</tag>` の中身。 */
function tagContent(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? m[1] : null;
}

/** RFC822（RSSのpubDate）とISO8601の両方を受けてISOへ。読めなければnull。 */
function parseDate(raw: string | null): string | null {
  if (!raw) return null;
  const t = Date.parse(textOf(raw));
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString();
}

/** Atomの `<link href="…">`（rel=alternate優先）。 */
function atomLink(block: string): string | null {
  const links = [...block.matchAll(/<link\b([^>]*)\/?>(?:<\/link>)?/gi)];
  let fallback: string | null = null;
  for (const [, attrs] of links) {
    const href = attrs.match(/href="([^"]+)"/i)?.[1] ?? null;
    if (!href) continue;
    if (/rel="alternate"/i.test(attrs)) return textOf(href);
    if (!/rel=/i.test(attrs)) fallback = fallback ?? textOf(href);
  }
  return fallback;
}

export function parseFeed(xml: string): FeedEntry[] {
  const out: FeedEntry[] = [];
  const blocks = [
    ...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi),
    ...xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi),
  ];
  for (const [block] of blocks) {
    const title = textOf(tagContent(block, "title") ?? "");
    // RSS: <link>URL</link>／Atom: <link href>。Google系は<link/>直後にURLが裸で続く形もある。
    const rssLink = tagContent(block, "link");
    const link = (rssLink ? textOf(rssLink) : null) || atomLink(block);
    if (!title || !link || !/^https?:\/\//i.test(link)) continue;
    const publishedAt = parseDate(
      tagContent(block, "pubDate") ??
        tagContent(block, "dc:date") ??
        tagContent(block, "published") ??
        tagContent(block, "updated"),
    );
    const snippet = textOf(
      tagContent(block, "description") ??
        tagContent(block, "summary") ??
        tagContent(block, "content:encoded") ??
        "",
    ).slice(0, 500);
    out.push({ title, link, publishedAt, snippet });
  }
  return out;
}
