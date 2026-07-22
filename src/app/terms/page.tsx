import type { Metadata } from "next";
import Link from "next/link";

import { CURRENT_TERMS_VERSION } from "@/lib/legal";

export const metadata: Metadata = { title: "利用規約 | Space AI" };

export default function TermsPage() {
  return (
    <main className="mx-auto w-full max-w-3xl space-y-8 px-5 py-12">
      <header className="space-y-2">
        <p className="text-sm text-muted-foreground">
          暫定版 {CURRENT_TERMS_VERSION}
        </p>
        <h1 className="text-3xl font-bold">利用規約</h1>
        <p className="text-sm text-destructive">
          本文は開発用の暫定版です。公開前に法務確認を行います。
        </p>
      </header>
      <section className="space-y-4 leading-7">
        <h2 className="text-xl font-semibold">サービスの利用</h2>
        <p>
          Space AIは、X向けコンテンツの生成・投稿支援を提供します。生成内容と投稿の最終確認・責任は利用者にあります。
        </p>
        <h2 className="text-xl font-semibold">禁止事項</h2>
        <p>
          法令、Xの規約・自動化ルール、第三者の権利に反する利用、不正アクセスやサービス運営を妨げる行為を禁止します。
        </p>
        <h2 className="text-xl font-semibold">料金・解約</h2>
        <p>
          各プランは月額課金で、7日間のtrial後に自動更新されます。解約は契約期間末に反映されます。
        </p>
        <h2 className="text-xl font-semibold">停止・免責・改定</h2>
        <p>
          保守や外部サービスの障害時は提供を一時停止する場合があります。重要な規約改定では再同意を求めます。
        </p>
      </section>
      <Link className="font-medium underline" href="/signup">
        会員登録へ戻る
      </Link>
    </main>
  );
}
