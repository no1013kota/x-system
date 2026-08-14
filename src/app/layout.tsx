import type { Metadata } from "next";
import { Geist_Mono, Inter, Noto_Sans_JP } from "next/font/google";
import "./globals.css";

import { ToastProvider } from "@/components/ui/toast";

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
  title: "Exos AI",
  description: "AIによるX運用の自動化・半自動化",
};

/**
 * **静的プリレンダを全面的に止める**（T-M8-87）。
 *
 * CSPの `script-src` は `'nonce-…' 'strict-dynamic'`（`security-headers.ts`）。
 * `'strict-dynamic'` があるとホスト指定（`'self'`）は**無視され**、nonceが一致する
 * scriptだけが実行される。nonceはリクエストごとに作るので、**ビルド時にHTMLへ
 * 焼き付けることが原理的にできない**。
 *
 * その結果、静的プリレンダされたページは script が1本も実行されず、
 * ハイドレートしない＝フォームもTurnstileも動かない。2026-08-14 に本番（exosai.net）で
 * `/signup` と `/reset-password` が実際にこの状態だった（scriptタグ16本すべてブロック・
 * 会員登録とパスワード再設定が不可能）。**HTTPは200を返し、本文も表示されるため
 * 気付けない**。
 *
 * 個々のページへ書くと「動的入力を持たないページを新しく足したら静かに壊れる」ので、
 * ここで一括して止める（CLAUDE.md 原則3＝手順を記憶に依存させない）。
 * 失われる最適化は実質ゼロだった——32ルートのうち静的だったのは
 * `/signup`・`/reset-password`・`/_not-found` の3つだけで、LPも法務ページも既に動的。
 *
 * 破られていないことは `npm run check:csp-nonce`（`release:check` に組込み）が
 * ビルド成果物を走査して確認する。E2Eは `next dev` で動きプリレンダが起きないため、
 * この不具合を**原理的に検出できない**。
 */
export const dynamic = "force-dynamic";

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
      <body className="min-h-full flex flex-col">
        {/* 操作結果の通知はここへ1本化する（T-M8-15）。 */}
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
