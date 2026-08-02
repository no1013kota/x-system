import type { Metadata } from "next";
import { Geist_Mono, Inter, Noto_Sans_JP } from "next/font/google";
import "./globals.css";

/**
 * フォントは**すべて自前配信**する（T-M8-02）。
 *
 * CSPが `font-src 'self' data:` / `style-src 'self' 'unsafe-inline'` なので、Google Fonts の
 * CDNからは読み込めない（読み込むとコンソールエラー0件を検証するE2Eが落ちる）。
 * `next/font/google` はビルド時にフォントを取得して自ドメインから配信するため、CSPに適合する。
 *
 * 日本語=Noto Sans JP / 英数・数値=Inter。
 * アイコンはフォントではなくインラインSVG（`components/ui/icon.tsx`）。可変フォントが3.8MBと
 * 重すぎるため、使う41個だけをSVGで持つ（12.6KB）。
 */
/**
 * `subsets` を指定せず `preload: false` にする。
 *
 * **日本語フォントで `subsets: ["latin"]` を指定すると、latin以外のグリフが入らず日本語が
 * フォールバックする**（当初そう書いていた）。Noto Sans JP は unicode-range で細かく分割
 * 配信されるので、preloadせずブラウザに必要な範囲だけ取らせるのが正しい。
 */
const notoSansJp = Noto_Sans_JP({
  variable: "--font-noto-sans-jp",
  weight: ["400", "500", "700"],
  preload: false,
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Space AI",
  description: "AIによるX運用の自動化・半自動化",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      className={`${notoSansJp.variable} ${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
