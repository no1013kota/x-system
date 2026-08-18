import Link from "next/link";
import type { ReactNode } from "react";

import { LogoTile } from "@/components/app-shell/brand-logo";
import { LegalFooter } from "@/components/legal-footer";
import { APP_NAME } from "@/lib/app-config";

/**
 * ログイン・会員登録・パスワード再設定の共通の外枠（T-M8-146）。
 *
 * **3画面へ逐語で重複していた**（ページ背景・カード・ロゴ＋アプリ名ヘッダ・h1・法務フッタ）。
 * T-M8-60 で見た目を揃えたが、揃え方はコピーだったので**片方だけ直すと再びトーンがずれる**
 * （実際に reset-password だけ旧デザインで残っていたのがT-M8-60の発端）。
 *
 * 法務3ページへの導線はここが必ず出す（要件06 §11）。T-M8-30 では
 * **ログインだけ導線が無く**、ログインから入る利用者が規約へ辿れなかった。
 */
export function AuthPageShell({
  title,
  description,
  children,
}: {
  title: ReactNode;
  /** h1の下に置く1〜2行の補足。無い画面もある。 */
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="bg-page flex min-h-screen flex-col">
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-[400px] space-y-6 rounded-card border border-hairline bg-surface p-6 shadow-[var(--shadow-pop)] sm:p-7">
          <header className="space-y-2 text-center">
            <span className="inline-flex items-center justify-center gap-2">
              <LogoTile size={28} />
              <Link className="text-[16px] font-bold tracking-tight text-ink" href="/">
                {APP_NAME}
              </Link>
            </span>
            <h1 className="text-[22px] font-bold tracking-tight text-ink">{title}</h1>
            {description ? (
              <p className="text-body leading-5 text-ink-2">{description}</p>
            ) : null}
          </header>
          {children}
        </div>
      </main>
      <LegalFooter />
    </div>
  );
}
