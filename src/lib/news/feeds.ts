import type { NewsCategory } from "@/lib/news";

/**
 * 監視するRSSフィード（T-M8-380・運営者の指示 2026-08-30「監視すべきサイトはあなたが選ぶ。
 * AIは重点的に」）。**全URLは選定時（2026-08-30）に実際に取得して200＋item付きを確認済み**。
 *
 * 選定基準:
 * - 分野の一次〜準一次情報源で、更新頻度がある公式RSS/Atomのみ
 * - **Google News RSSは使わない**——規約が「個人・非商用のフィードリーダーに限る」と明記
 *   しており、商用サービスからの利用は許諾外（選定時に原文で確認）
 * - AI分野は本数を厚くする（国内メディア＋一次情報のOpenAI/Google公式ブログ。英語記事は
 *   要約時に日本語のタイトル・要約へ直す）
 *
 * フィードの追加・削除はこの表を編集するだけでよい（DBや設定画面は持たない——
 * 運営者は1人で、コード変更の方が検査（実在チェックのテスト）を通るため安全）。
 */
export interface NewsFeed {
  /** 出どころの表示名（ログ・調査用。画面には出さない）。 */
  source: string;
  url: string;
}

export const NEWS_FEEDS: Record<NewsCategory, NewsFeed[]> = {
  ai: [
    { source: "ITmedia AI＋", url: "https://rss.itmedia.co.jp/rss/2.0/aiplus.xml" },
    { source: "Publickey", url: "https://www.publickey1.jp/atom.xml" },
    { source: "MITテクノロジーレビューJP", url: "https://www.technologyreview.jp/feed/" },
    { source: "AINOW", url: "https://ainow.ai/feed/" },
    { source: "OpenAI News", url: "https://openai.com/news/rss.xml" },
    { source: "Google AI Blog", url: "https://blog.google/technology/ai/rss/" },
    // 英語の速報メディア（2026-08-31実測: TechCrunch 最新1.1h前・5.7件/日、Verge 0.5h前・
    // 3.2件/日）。国内メディアは週末に止まる（実測で全滅した）ため、速報の穴を英語圏で埋める。
    // 要約時に日本語のtitle・summaryへ直す（SYS-NEWS-SUM）。
    { source: "TechCrunch AI", url: "https://techcrunch.com/category/artificial-intelligence/feed/" },
    { source: "The Verge AI", url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml" },
  ],
  web3: [
    { source: "CoinPost", url: "https://coinpost.jp/?feed=rss2" },
    { source: "あたらしい経済", url: "https://www.neweconomy.jp/feed" },
  ],
  sns: [
    { source: "ITmedia マーケティング", url: "https://rss.itmedia.co.jp/rss/2.0/marketing.xml" },
    // Gaiaxソーシャルメディアラボは2026-08-31の実測で最新記事が448時間前（更新0.1件/日）
    // だったため外し、MarkeZine（7.5件/日）へ差し替えた。
    { source: "MarkeZine", url: "https://markezine.jp/rss/new/20/index.xml" },
  ],
  investment: [
    { source: "東洋経済オンライン", url: "https://toyokeizai.net/list/feed/rss" },
    { source: "ZUU online", url: "https://zuuonline.com/feed" },
    { source: "幻冬舎ゴールドオンライン", url: "https://gentosha-go.com/list/feed/rss" },
  ],
  love: [
    { source: "マイナビウーマン", url: "https://woman.mynavi.jp/rss" },
    { source: "CanCam.jp", url: "https://cancam.jp/feed" },
  ],
  beauty: [
    { source: "WWD JAPAN", url: "https://www.wwdjapan.com/feed" },
    { source: "Oggi.jp", url: "https://oggi.jp/feed" },
  ],
  // 定時取得の対象外（NEWS_FETCH_CATEGORIES に無い分野）。空で持ち、追加時にここへ書く。
  business: [],
  business_ops: [],
};
