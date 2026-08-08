import Link from "next/link";

/**
 * 法務導線の共通フッタ（要件06 §11, T-M6-15）。公開法務3ページ（利用規約・プライバシーポリシー・
 * 特定商取引法に基づく表記）へのリンクを提供する。LP・会員登録・プラン選択・アプリ設定に配置し、
 * どの導線からも3ページへ到達できるようにする。表示専用（JS不要）。
 */

const LEGAL_LINKS: [string, string][] = [
  ["/terms", "利用規約"],
  ["/privacy", "プライバシーポリシー"],
  ["/legal/commercial-transactions", "特定商取引法に基づく表記"],
];

/**
 * 法務3リンクのnav単体。レイアウトを自前で持つフッター（LP等）はこちらを埋め込む。
 * URLは常にこのファイルの `LEGAL_LINKS` を正とし、呼び出し側で書かない。
 */
export function LegalFooterLinks({
  className = "",
  linkClassName = "underline hover:text-foreground",
}: {
  className?: string;
  linkClassName?: string;
}) {
  return (
    <nav aria-label="法務情報" className={className}>
      {LEGAL_LINKS.map(([href, label]) => (
        <Link className={linkClassName} href={href} key={href}>
          {label}
        </Link>
      ))}
    </nav>
  );
}

export function LegalFooter({ className = "" }: { className?: string }) {
  return (
    <footer className={`border-t py-6 text-center text-sm text-muted-foreground ${className}`.trim()}>
      <LegalFooterLinks className="mx-auto flex max-w-6xl flex-wrap justify-center gap-x-6 gap-y-2 px-4" />
    </footer>
  );
}
