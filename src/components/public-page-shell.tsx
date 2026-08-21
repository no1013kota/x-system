import type { ReactNode } from "react";
import Link from "next/link";

import { LegalFooter } from "@/components/legal-footer";
import { buttonVariants } from "@/components/ui/button";
import { APP_NAME } from "@/lib/app-config";
import { cn } from "@/lib/utils";

/**
 * 公開コンテンツページ（プロンプト集・ブログ）の共通の器（T-M8-184/190）。
 *
 * LP・認証画面とは別に、**ログイン不要で読める読み物ページ**が複数になったので、
 * ヘッダー（ブランド・遷移ボタン・ログイン／新規登録）とフッタを1か所で決める。
 * ヘッダーの導線は**タブ風の現在地表示ではなく「ホーム＋もう片方のページ」への遷移ボタン**
 * （運営者の指示 2026-08-22・T-M8-190。いま居るページのボタンは出さない）。
 */

/** 公開コンテンツページの一覧。ヘッダーで「もう片方」を割り出すのに使う。 */
export const PUBLIC_CONTENT_PAGES = [
  { href: "/prompt-templates", label: "プロンプト集" },
  { href: "/blog", label: "ブログ" },
] as const;

export type PublicContentPath = (typeof PUBLIC_CONTENT_PAGES)[number]["href"];

export function PublicPageShell({
  children,
  current,
}: {
  children: ReactNode;
  /** いま表示しているページ。ヘッダーの該当リンクに `aria-current="page"` が付く。 */
  current: PublicContentPath;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <header className="border-b border-hairline bg-surface">
        {/* 320px では1行に収まらないので折り返しを許す（CTAがリンクを覆わない）。通常は h-16 相当。 */}
        <div className="mx-auto flex min-h-16 max-w-5xl flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2">
          <div className="flex min-w-0 items-center gap-4">
            <Link className="text-sm font-semibold tracking-wide whitespace-nowrap" href="/">
              {APP_NAME}
            </Link>
            <nav aria-label="公開コンテンツ" className="flex items-center gap-2">
              {/* いま居るページは出さない: ホームと「もう片方」への遷移ボタンだけ（T-M8-190）。 */}
              {[
                { href: "/", label: "ホーム" },
                ...PUBLIC_CONTENT_PAGES.filter(({ href }) => href !== current),
              ].map(({ href, label }) => (
                <Link
                  className={cn(
                    buttonVariants({ variant: "ghost" }),
                    "h-9 whitespace-nowrap px-3.5 text-body font-medium text-ink-2 hover:text-brand",
                  )}
                  href={href}
                  key={href}
                >
                  {label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex shrink-0 items-center gap-2.5">
            {/* 狭い幅（〜639px）ではログインを畳み、主CTAだけ残す（ブランド・相互導線・CTAが1行に収まる幅が無い）。 */}
            <Link
              className={cn(
                buttonVariants({ variant: "ghost" }),
                "hidden h-9 px-3.5 text-body font-medium sm:inline-flex",
              )}
              href="/login"
            >
              ログイン
            </Link>
            <Link
              className={cn(buttonVariants({ variant: "brand" }), "h-9 px-4 text-body font-bold")}
              href="/signup"
            >
              無料で始める
            </Link>
          </div>
        </div>
      </header>
      <main className="flex-1 px-4 py-10 sm:py-14">{children}</main>
      <LegalFooter />
    </div>
  );
}
