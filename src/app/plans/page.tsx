import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "lucide-react";

import { LegalFooter } from "@/components/legal-footer";
import { APP_NAME } from "@/lib/app-config";
import { PLAN_IDS, PLANS, type PlanId } from "@/lib/plans";

import { CheckoutButton } from "./checkout-button";

export const metadata: Metadata = {
  title: `プラン選択 | ${APP_NAME}`,
};

interface PlansPageProps {
  searchParams: Promise<{ checkout?: string }>;
}

const PLAN_COPY: Record<
  PlanId,
  {
    description: string;
    features: string[];
    keyLabel: string;
  }
> = {
  standard: {
    description: "まずは1つのXアカウントを着実に運用",
    keyLabel: "X・生成AIのAPIキーが必要",
    features: ["Xアカウント 1件", "AI投稿生成・スケジュール", "投稿分析と改善提案"],
  },
  md: {
    description: "複数アカウントと発信設計を細かく管理",
    keyLabel: "X・生成AIのAPIキーが必要",
    features: [
      "Xアカウント 3件",
      "Standardの全機能",
      "ベースmd・プロンプト編集",
    ],
  },
  premium: {
    description: "APIキーなしで、運用をまとめておまかせ",
    keyLabel: "X・生成AIのAPIキー登録は不要",
    features: [
      "Xアカウント 3件",
      "通常投稿 200件／月",
      "URL付き投稿 20件／月",
      "文章生成 100回／月・画像生成 20枚／月",
    ],
  },
};

function yen(value: number): string {
  return new Intl.NumberFormat("ja-JP").format(value);
}

export default async function PlansPage({ searchParams }: PlansPageProps) {
  const params = await searchParams;

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <main className="flex-1 px-4 py-10 sm:py-14">
      <div className="mx-auto max-w-6xl space-y-10">
        <header className="mx-auto max-w-3xl space-y-4 text-center">
          <Link className="text-sm font-semibold tracking-wide" href="/">
            {APP_NAME}
          </Link>
          <div className="space-y-2">
            <p className="text-sm font-semibold text-muted-foreground">
              すべてのプランを7日間無料でお試し
            </p>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
              あなたの運用に合うプランを選択
            </h1>
            <p className="text-sm leading-6 text-muted-foreground sm:text-base">
              表示価格はすべて税込です。初回のお申し込みに限り、7日間の無料トライアルをご利用いただけます。
            </p>
          </div>
        </header>

        {params.checkout === "canceled" ? (
          <p
            className="mx-auto max-w-3xl rounded-xl border bg-card p-4 text-sm"
            role="status"
          >
            決済手続きは完了していません。プランを確認して、もう一度お試しください。
          </p>
        ) : null}

        {params.checkout === "success" ? (
          <p
            className="mx-auto max-w-3xl rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"
            role="status"
          >
            お申し込みを受け付けました。契約情報を確認しています。
          </p>
        ) : null}

        <section
          aria-labelledby="application-terms-heading"
          className="rounded-2xl border bg-card p-5 shadow-sm sm:p-7"
        >
          <h2
            className="text-lg font-semibold"
            id="application-terms-heading"
          >
            お申し込み前の確認
          </h2>
          <dl className="mt-5 grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="font-medium">料金</dt>
              <dd className="mt-1 text-muted-foreground">税込月額500円〜2,980円</dd>
            </div>
            <div>
              <dt className="font-medium">無料期間</dt>
              <dd className="mt-1 text-muted-foreground">
                初回のみ7日間。開始時にカード登録が必要です
              </dd>
            </div>
            <div>
              <dt className="font-medium">自動更新</dt>
              <dd className="mt-1 text-muted-foreground">
                無料期間終了後、選択プランを月単位で自動更新します
              </dd>
            </div>
            <div>
              <dt className="font-medium">支払時期</dt>
              <dd className="mt-1 text-muted-foreground">
                初回は無料期間終了時、以後は毎月の更新日に請求します
              </dd>
            </div>
            <div>
              <dt className="font-medium">解約方法</dt>
              <dd className="mt-1 text-muted-foreground">
                設定のCustomer Portalからいつでも期間末解約できます
              </dd>
            </div>
            <div>
              <dt className="font-medium">提供開始</dt>
              <dd className="mt-1 text-muted-foreground">
                Checkout完了後、契約反映が確認でき次第すぐに開始します
              </dd>
            </div>
          </dl>
          <p className="mt-5 text-sm text-muted-foreground">
            詳細は
            <Link
              className="mx-1 font-medium text-foreground underline underline-offset-4"
              href="/legal/commercial-transactions"
              target="_blank"
            >
              特定商取引法に基づく表記
            </Link>
            をご確認ください。
          </p>
        </section>

        <section
          aria-label="料金プラン"
          className="grid items-stretch gap-5 lg:grid-cols-3"
        >
          {PLAN_IDS.map((planId) => {
            const plan = PLANS[planId];
            const copy = PLAN_COPY[planId];
            const featured = planId === "premium";
            return (
              <article
                className={`relative flex flex-col rounded-2xl border bg-card p-6 shadow-sm ${featured ? "border-foreground shadow-md" : ""}`}
                key={planId}
              >
                {featured ? (
                  <span className="absolute -top-3 right-5 rounded-full bg-foreground px-3 py-1 text-xs font-semibold text-background">
                    APIキー不要
                  </span>
                ) : null}
                <div className="space-y-3">
                  <div>
                    <h2 className="text-xl font-bold">{plan.displayName}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {copy.description}
                    </p>
                  </div>
                  <p>
                    <span className="text-4xl font-bold tracking-tight">
                      ¥{yen(plan.monthlyPriceJpy)}
                    </span>
                    <span className="ml-1 text-sm text-muted-foreground">／月（税込）</span>
                  </p>
                  <p
                    className={`rounded-lg p-3 text-sm ${featured ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-950"}`}
                  >
                    {copy.keyLabel}
                  </p>
                </div>
                <ul className="my-6 flex-1 space-y-3 text-sm">
                  {copy.features.map((feature) => (
                    <li className="flex items-start gap-2" key={feature}>
                      <Check aria-hidden="true" className="mt-0.5 size-4" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                {!featured ? (
                  <p className="mb-4 text-xs leading-5 text-muted-foreground">
                    X API・生成AI APIの利用料は、各提供元から別途請求されます。
                  </p>
                ) : (
                  <p className="mb-4 text-xs leading-5 text-muted-foreground">
                    月間利用枠を超えた場合は翌月の更新まで生成・投稿を停止します。
                  </p>
                )}
                <CheckoutButton plan={planId} planName={plan.displayName} />
              </article>
            );
          })}
        </section>

        <p className="text-center text-xs leading-5 text-muted-foreground">
          Standard／MDはご自身のAPI契約を利用するため、Space AIの月額料金とは別にX・生成AI各社の利用料がかかります。
        </p>
      </div>
      </main>
      <LegalFooter />
    </div>
  );
}
