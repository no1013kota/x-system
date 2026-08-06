import type { Metadata } from "next";
import { yen } from "@/lib/format";
import Link from "next/link";

import { LegalFooter } from "@/components/legal-footer";
import { buttonVariants } from "@/components/ui/button";
import { APP_DESCRIPTION, APP_NAME } from "@/lib/app-config";
import { PLAN_IDS, PLANS } from "@/lib/plans";
import { cardClassName } from "@/components/ui/card";

export const metadata: Metadata = {
  title: `${APP_NAME} — AIで学習・生成・投稿・分析まで自動化するX運用アプリ`,
  description: APP_DESCRIPTION,
};

// nonceベースCSP（T-M6-17）はper-requestのnonceを要するため動的レンダリングにする
// （静的prerenderだとNext.jsのscriptにnonceが付かずCSPで実行が阻害される）。
export const dynamic = "force-dynamic";

const VALUE_PROPS: { title: string; body: string }[] = [
  {
    title: "情報収集を自動化",
    body: "関心テーマの重要ニュースを自動で収集し、投稿ネタとして活用できます。",
  },
  {
    title: "あなたらしい文章をAIが生成",
    body: "発信スタイルを学習したAIが、複数パターンの下書きを作成します。",
  },
  {
    title: "予定時刻に自動投稿",
    body: "同意した内容だけを、指定した時刻に自動で投稿します。",
  },
  {
    title: "実績を分析して改善",
    body: "投稿ごとの反応を集計し、次に活かす改善提案を提示します。",
  },
];


export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4">
        <span className="text-lg font-bold tracking-tight">{APP_NAME}</span>
        <Link className="text-sm font-medium underline-offset-4 hover:underline" href="/login">
          ログイン
        </Link>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto w-full max-w-6xl px-4 py-14 text-center sm:py-20">
          <h1 className="mx-auto max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-5xl">
            AIが学習・生成・投稿・分析まで、
            <br className="hidden sm:block" />
            あなたのX運用を自動化
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
            {APP_DESCRIPTION}。すべてのプランを7日間無料でお試しいただけます。
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link className={buttonVariants({ className: "h-11 px-6" })} href="/signup">
              無料で始める
            </Link>
            <Link
              className={buttonVariants({ variant: "outline", className: "h-11 px-6" })}
              href="/plans"
            >
              プランを見る
            </Link>
          </div>
          {/* 決済直前で期待とズレないよう、CTA直下でカード登録が必要なことを明示する（要件06 §1.1）。 */}
          <p className="mt-4 text-xs leading-5 text-muted-foreground">
            開始にはカード登録が必要です（7日間は無料。期間中の解約で料金はかかりません）。
          </p>
        </section>

        {/* 提供価値 */}
        <section className="mx-auto w-full max-w-6xl px-4 py-8">
          <h2 className="text-center text-2xl font-bold tracking-tight">できること</h2>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {VALUE_PROPS.map((v) => (
              <li className={`${cardClassName} p-6`} key={v.title}>
                <h3 className="font-semibold">{v.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{v.body}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* 3プラン */}
        <section className="mx-auto w-full max-w-6xl px-4 py-12">
          <h2 className="text-center text-2xl font-bold tracking-tight">料金プラン</h2>
          {/* トライアルはヒーロー直下とカード登録注記に記載済み（T-M8-66）。 */}
          <p className="mt-3 text-center text-sm text-muted-foreground">
            表示価格はすべて税込月額です。
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {PLAN_IDS.map((planId) => {
              const plan = PLANS[planId];
              const byok = planId !== "premium";
              return (
                <article className={`${cardClassName} flex flex-col p-6`} key={planId}>
                  <h3 className="text-lg font-semibold">{plan.displayName}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{plan.tagline}</p>
                  <p className="mt-4">
                    <span className="text-3xl font-bold">{yen(plan.monthlyPriceJpy)}</span>
                    <span className="ml-1 text-sm text-muted-foreground">円／月（税込）</span>
                  </p>
                  <p className="mt-4 text-sm leading-6 text-muted-foreground">
                    Xアカウント {plan.xAccountLimit} 件・
                    {byok
                      ? "ご自身のX API・生成AI APIキーを登録して利用"
                      : "APIキーの登録は不要（運営が用意）"}
                  </p>
                  <p
                    className={`mt-3 rounded-lg p-3 text-xs leading-5 ${
                      byok ? "bg-warn-bg text-warn-fg" : "bg-success-bg text-success-fg"
                    }`}
                  >
                    {byok
                      ? "X API・生成AI APIの利用料は別途ユーザー負担です。"
                      : "API費用の追加負担なし（月間利用枠あり）。"}
                  </p>
                </article>
              );
            })}
          </div>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link className={buttonVariants({ className: "h-11 px-6" })} href="/signup">
              無料で始める
            </Link>
            <Link
              className={buttonVariants({ variant: "outline", className: "h-11 px-6" })}
              href="/plans"
            >
              プランの詳細
            </Link>
          </div>
        </section>
      </main>

      <LegalFooter />
    </div>
  );
}
