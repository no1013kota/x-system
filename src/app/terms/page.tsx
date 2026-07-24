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
        <h2 className="text-xl font-semibold">料金・自動更新・解約</h2>
        <p>
          各プランは月額課金（税込）で、初回7日間の無料トライアル終了後に選択プランが月単位で自動更新されます。解約はCustomer
          Portalから受け付け、支払済み期間の終了（契約期間末）まで利用でき、期間途中の日割り返金は行いません。
        </p>
        <h2 className="text-xl font-semibold">Premium利用枠の見直し</h2>
        <p>
          Premiumプランの月間利用枠（通常投稿・URL付き投稿・生成・画像の各上限）は、外部APIの原価や運用状況に応じて改定する場合があります。利用者に不利益となる変更を行う場合は、事前に合理的な方法で通知します。
        </p>
        <h2 className="text-xl font-semibold">停止・免責・改定</h2>
        <p>
          保守や外部サービスの障害時は提供を一時停止する場合があります。重要な規約改定では再同意を求めます。
        </p>
        <h2 className="text-xl font-semibold">お問い合わせ</h2>
        <p>
          本規約および本サービスに関するお問い合わせは、matsubuz.10@gmail.com までご連絡ください。
        </p>
      </section>
      <Link className="font-medium underline" href="/signup">
        会員登録へ戻る
      </Link>
    </main>
  );
}
