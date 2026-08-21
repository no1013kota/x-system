import type { ReactNode } from "react";
import Link from "next/link";

import { LegalFooter } from "@/components/legal-footer";
import { buttonVariants } from "@/components/ui/button";
import { APP_NAME } from "@/lib/app-config";
import { cn } from "@/lib/utils";

/**
 * 公開コンテンツページ（プロンプト集・ブログ）の共通の器（T-M8-184）。
 *
 * LP・認証画面とは別に、**ログイン不要で読める読み物ページ**が複数になったので、
 * ヘッダー（ブランド・相互の導線・ログイン／新規登録）とフッタを1か所で決める。
 * プロンプト集だけにあった器を切り出したもので、見た目は変えていない。
 */

/** 公開コンテンツページの一覧。ヘッダーの相互導線と `aria-current` の判定に使う。 */
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
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-5">
            <Link className="text-sm font-semibold tracking-wide whitespace-nowrap" href="/">
              {APP_NAME}
            </Link>
            <nav aria-label="公開コンテンツ" className="flex items-center gap-4">
              {PUBLIC_CONTENT_PAGES.map(({ href, label }) => {
                const active = href === current;
                return (
                  <Link
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "inline-flex min-h-6 items-center text-body font-medium whitespace-nowrap transition-colors",
                      active ? "text-brand" : "text-ink-2 hover:text-brand",
                    )}
                    href={href}
                    key={href}
                  >
                    {label}
                  </Link>
                );
              })}
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
