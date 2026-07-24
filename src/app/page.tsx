import type { Metadata } from "next";
import Link from "next/link";

import { LegalFooter } from "@/components/legal-footer";
import { buttonVariants } from "@/components/ui/button";
import { APP_DESCRIPTION, APP_NAME } from "@/lib/app-config";
import { PLAN_IDS, PLANS } from "@/lib/plans";

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
    body: "関心分野の重要ニュースを自動で収集し、投稿ネタとして活用できます。",
  },
  {
    title: "あなたらしい文章をAIが生成",
    body: "発信スタイルを学習したAIが、複数パターンの下書きを作成します。",
  },
  {
    title: "予定時刻に自動投稿",
    body: "同意した内容だけを指定時刻に自動投稿。thread途中失敗時は自動で取り消します。",
  },
  {
    title: "実績を分析して改善",
    body: "投稿ごとの反応を集計し、次に活かす改善提案を提示します。",
  },
];

const PLAN_TAGLINE: Record<string, string> = {
  standard: "まずは1アカウントを着実に",
  md: "複数アカウントを細かく管理",
  premium: "APIキー不要でおまかせ運用",
};

function yen(value: number): string {
  return new Intl.NumberFormat("ja-JP").format(value);
}

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
              className="inline-flex h-11 items-center rounded-md border px-6 text-sm font-medium"
              href="/plans"
            >
              プランを見る
            </Link>
          </div>
        </section>

        {/* 提供価値 */}
        <section className="mx-auto w-full max-w-6xl px-4 py-8">
          <h2 className="text-center text-2xl font-bold tracking-tight">できること</h2>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {VALUE_PROPS.map((v) => (
              <li className="rounded-2xl border bg-card p-6 shadow-sm" key={v.title}>
                <h3 className="font-semibold">{v.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{v.body}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* 3プラン */}
        <section className="mx-auto w-full max-w-6xl px-4 py-12">
          <h2 className="text-center text-2xl font-bold tracking-tight">料金プラン</h2>
          <p className="mt-3 text-center text-sm text-muted-foreground">
            表示価格はすべて税込月額です。初回に限り7日間の無料トライアルをご利用いただけます。
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {PLAN_IDS.map((planId) => {
              const plan = PLANS[planId];
              const byok = planId !== "premium";
              return (
                <article className="flex flex-col rounded-2xl border bg-card p-6 shadow-sm" key={planId}>
                  <h3 className="text-lg font-semibold">{plan.displayName}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{PLAN_TAGLINE[planId]}</p>
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
                      byok ? "bg-amber-50 text-amber-950" : "bg-emerald-50 text-emerald-950"
                    }`}
                  >
                    {byok
                      ? "X API・生成AI APIの利用料は、Space AIの月額とは別に各提供元から請求されます（ユーザー負担）。"
                      : "生成・投稿にかかるX API・生成AI APIの費用は追加負担なし（月間利用枠あり）。"}
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
              className="inline-flex h-11 items-center rounded-md border px-6 text-sm font-medium"
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
