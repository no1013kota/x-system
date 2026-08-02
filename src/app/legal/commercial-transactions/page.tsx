import type { Metadata } from "next";
import Link from "next/link";

import { APP_NAME } from "@/lib/app-config";

export const metadata: Metadata = {
  title: `特定商取引法に基づく表記 | ${APP_NAME}`,
};

// nonceベースCSP（T-M6-17）のため動的レンダリング（静的prerenderはnonce付与不可）。
export const dynamic = "force-dynamic";

const ITEMS = [
  ["販売事業者", "松本洸太"],
  ["運営責任者", "松本洸太"],
  ["所在地", "神奈川県川崎市川崎区池田1-8-10-101"],
  ["問い合わせ先", "matsubuz.10@gmail.com"],
  ["電話番号", "請求があった場合に遅滞なく開示します"],
  ["販売価格", "通常プラン 500円、mdプラン 1,000円、プレミアムプラン 2,980円（各税込月額）"],
  ["支払時期・方法", "初回は7日間の無料期間終了時、以後毎月の更新日にカード決済"],
  ["提供時期", "Checkout完了後、契約反映が確認でき次第提供を開始"],
  ["自動更新", "無料期間終了後、選択プランを月単位で自動更新"],
  ["解約", "Customer Portalから期間末解約。支払済み期間の終了まで利用可能"],
  ["返金", "法令上返金が必要な場合を除き、支払済み料金は返金不可"],
  [
    "動作環境",
    "最新版のモダンブラウザ（Google Chrome・Safari・Microsoft Edge等）とインターネット接続が必要です。JavaScriptとCookieを有効にしてご利用ください。",
  ],
] as const;

export default function CommercialTransactionsPage() {
  return (
    <main className="min-h-screen bg-muted/40 px-4 py-12">
      <article className="mx-auto max-w-3xl rounded-2xl border bg-card p-6 shadow-sm sm:p-10">
        <header className="space-y-3">
          <Link className="text-sm font-semibold" href="/plans">
            {APP_NAME}
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">
            特定商取引法に基づく表記
          </h1>
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
            開発中の暫定版です。公開前に専門家による法務確認を行います。
          </p>
        </header>
        <dl className="mt-8 divide-y rounded-xl border">
          {ITEMS.map(([term, description]) => (
            <div className="grid gap-2 p-4 sm:grid-cols-[11rem_1fr]" key={term}>
              <dt className="font-medium">{term}</dt>
              <dd className="text-sm leading-6 text-muted-foreground">
                {description}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-8 text-sm">
          <Link className="font-medium underline" href="/plans">
            プラン選択へ戻る
          </Link>
        </p>
      </article>
    </main>
  );
}
