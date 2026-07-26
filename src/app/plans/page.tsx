import type { Metadata } from "next";
import { yen } from "@/lib/format";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Check, Minus } from "lucide-react";

import { getCurrentUser } from "@/lib/auth/session";
import { subscriptionAccessFor } from "@/lib/auth/subscription-access";
import { LegalFooter } from "@/components/legal-footer";
import { APP_NAME } from "@/lib/app-config";
import { PLAN_IDS, PLANS, type PlanId } from "@/lib/plans";
import { env } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

import { SignOutButton } from "@/components/app-shell/sign-out-button";

import { CheckoutButton } from "./checkout-button";
import { CheckoutPending } from "./checkout-pending";

export const metadata: Metadata = {
  title: `プラン選択 | ${APP_NAME}`,
};

interface PlansPageProps {
  searchParams: Promise<{ checkout?: string }>;
}

const PLAN_TAGLINE: Record<PlanId, string> = {
  standard: "まずは1つのXアカウントを着実に運用",
  md: "複数アカウントと発信設計を細かく管理",
  premium: "APIキーなしで、運用をまとめておまかせ",
};

type Cell = boolean | string;

interface FeatureRow {
  label: string;
  value: (planId: PlanId) => Cell;
}

/** Comparison rows are derived from PLANS so the table never drifts from spec. */
const FEATURE_ROWS: FeatureRow[] = [
  { label: "Xアカウント", value: (id) => `${PLANS[id].xAccountLimit}件` },
  {
    label: "X・生成AIのAPIキー",
    value: (id) => (PLANS[id].usageLimits ? "不要（運営が用意）" : "必要（ご自身で用意）"),
  },
  { label: "AI投稿生成・スケジュール", value: () => true },
  { label: "投稿分析・改善提案", value: () => true },
  { label: "ベースmd・プロンプト編集", value: (id) => PLANS[id].canEditMdAndPrompts },
  {
    label: "文章生成（運営枠）",
    value: (id) => {
      const u = PLANS[id].usageLimits;
      return u ? `${u.generations}回／月` : "ご自身のAPI枠";
    },
  },
  {
    label: "画像生成（運営枠）",
    value: (id) => {
      const u = PLANS[id].usageLimits;
      return u ? `${u.images}枚／月` : "ご自身のAPI枠";
    },
  },
  {
    label: "通常投稿",
    value: (id) => {
      const u = PLANS[id].usageLimits;
      return u ? `${u.normalPosts}件／月` : "従量（ご自身のAPI）";
    },
  },
  {
    label: "URL付き投稿",
    value: (id) => {
      const u = PLANS[id].usageLimits;
      return u ? `${u.urlPosts}件／月` : "従量（ご自身のAPI）";
    },
  },
];

const CONFIRMATION_ITEMS: { term: string; description: string }[] = [
  { term: "料金", description: "税込月額500円〜2,980円" },
  { term: "無料期間", description: "初回のみ7日間。開始時にカード登録が必要です" },
  { term: "自動更新", description: "無料期間終了後、選択プランを月単位で自動更新します" },
  { term: "支払時期", description: "初回は無料期間終了時、以後は毎月の更新日に請求します" },
  { term: "解約方法", description: "設定のCustomer Portalからいつでも期間末解約できます" },
  { term: "提供開始", description: "Checkout完了後、契約反映が確認でき次第すぐに開始します" },
];

/** Boolean cells render an icon; string cells render text. */
function FeatureCell({ value }: { value: Cell }) {
  if (typeof value === "boolean") {
    return value ? (
      <>
        <Check aria-hidden="true" className="mx-auto size-4 text-emerald-600" />
        <span className="sr-only">対応</span>
      </>
    ) : (
      <>
        <Minus aria-hidden="true" className="mx-auto size-4 text-muted-foreground/60" />
        <span className="sr-only">非対応</span>
      </>
    );
  }
  return <span>{value}</span>;
}

export default async function PlansPage({ searchParams }: PlansPageProps) {
  const params = await searchParams;
  // Checkout直後の反映待ち。反映が済むと下の判定で /app へリダイレクトされる。
  const awaitingCheckout = params.checkout === "success";

  // 契約が有効（trialing/active）で本編を使えるユーザーが /plans に来たら /app へ送り、
  // 決済成功後にこの画面で行き止まりになるのを防ぐ。incomplete・canceled 等はプラン選択／
  // 再申込のため /plans に留める（canExecute は trialing/active のみ true）。
  const user = await getCurrentUser();
  if (user) {
    const admin = createSupabaseAdminClient();
    const { data: profile } = await admin
      .from("profiles")
      .select("plan, subscription_status")
      .eq("id", user.id)
      .maybeSingle();
    if (
      profile?.plan &&
      subscriptionAccessFor(profile.subscription_status)?.canExecute
    ) {
      redirect("/app");
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <main className="flex-1 px-4 py-10 sm:py-14">
        <div className="mx-auto max-w-5xl space-y-10">
          <header className="mx-auto max-w-3xl space-y-4 text-center">
            <div className="flex items-center justify-between gap-3">
              <Link className="text-sm font-semibold tracking-wide" href="/">
                {APP_NAME}
              </Link>
              {/* 未契約の利用者はこの画面に留められ App Shell のヘッダへ到達できないため、
                  ログアウトの導線をここにも置く（PRD A-2・要件03 §1）。 */}
              {user ? <SignOutButton label={false} /> : null}
            </div>
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
            <p className="mx-auto max-w-3xl rounded-xl border bg-card p-4 text-sm" role="status">
              決済手続きは完了していません。プランを確認して、もう一度お試しください。
            </p>
          ) : null}

          {/* 反映待ちの間はプラン比較表とCTAを描画せず、待機カードだけを出す（二重申込の防止）。 */}
          {awaitingCheckout ? (
            <CheckoutPending supportEmail={env.SUPPORT_EMAIL ?? null} />
          ) : (
            <>
          {/* お申し込み前の確認：要件06 §1.1・要件03 §54 により、申込ボタン（比較表内のCTA）
              より前に税込月額・初回のみ7日trial・カード登録・自動更新・支払時期・解約方法・
              提供開始を再掲する。折りたたみで隠さない。 */}
          <section
            aria-labelledby="pre-application-heading"
            className="mx-auto max-w-3xl rounded-2xl border bg-card p-5 text-xs leading-5 text-muted-foreground"
          >
            <h2 id="pre-application-heading" className="text-sm font-medium text-foreground">
              お申し込み前の確認
            </h2>
            <p className="mt-2 text-foreground/80">
              7日間無料でお試しいただけます。開始にはカード登録（Stripe）が必要で、無料期間中に解約すれば料金はかかりません。
            </p>
            <dl className="mt-3 grid gap-x-8 gap-y-2 sm:grid-cols-2">
              {CONFIRMATION_ITEMS.map((item) => (
                <div className="sm:flex sm:gap-2" key={item.term}>
                  <dt className="shrink-0 font-medium text-foreground/80">{item.term}</dt>
                  <dd>{item.description}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3">
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

          {/* プラン比較表（SC-04: 3プラン比較） */}
          <section aria-label="料金プラン比較" className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-separate border-spacing-0 text-sm">
              <caption className="sr-only">Space AI 料金プラン比較</caption>
              <colgroup>
                <col className="w-[26%]" />
                <col className="w-[24%]" />
                <col className="w-[24%]" />
                <col className="w-[26%]" />
              </colgroup>
              <thead>
                <tr className="align-bottom">
                  <th className="p-3 text-left" scope="col">
                    <span className="sr-only">機能</span>
                  </th>
                  {PLAN_IDS.map((planId) => {
                    const plan = PLANS[planId];
                    const featured = planId === "premium";
                    return (
                      <th
                        className={`rounded-t-2xl border-t border-x p-4 text-center align-top ${
                          featured ? "border-foreground bg-card shadow-sm" : "border-transparent"
                        }`}
                        key={planId}
                        scope="col"
                      >
                        {featured ? (
                          <span className="mb-2 inline-block rounded-full bg-foreground px-3 py-0.5 text-xs font-semibold text-background">
                            おすすめ
                          </span>
                        ) : null}
                        <span className="block text-lg font-bold">{plan.displayName}</span>
                        <span className="mt-1 block text-xs font-normal leading-5 text-muted-foreground">
                          {PLAN_TAGLINE[planId]}
                        </span>
                        <span className="mt-3 block">
                          <span className="text-3xl font-bold tracking-tight">
                            ¥{yen(plan.monthlyPriceJpy)}
                          </span>
                          <span className="ml-1 text-xs font-normal text-muted-foreground">
                            ／月（税込）
                          </span>
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {FEATURE_ROWS.map((row) => (
                  <tr key={row.label}>
                    <th
                      className="border-b p-3 text-left font-medium text-muted-foreground"
                      scope="row"
                    >
                      {row.label}
                    </th>
                    {PLAN_IDS.map((planId) => {
                      const featured = planId === "premium";
                      return (
                        <td
                          className={`border-b p-3 text-center align-middle ${
                            featured ? "border-x border-foreground bg-card" : ""
                          }`}
                          key={planId}
                        >
                          <FeatureCell value={row.value(planId)} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr>
                  <td className="p-3" />
                  {PLAN_IDS.map((planId) => {
                    const plan = PLANS[planId];
                    const featured = planId === "premium";
                    return (
                      <td
                        className={`p-4 align-top ${
                          featured ? "rounded-b-2xl border-x border-b border-foreground bg-card shadow-sm" : ""
                        }`}
                        key={planId}
                      >
                        <CheckoutButton plan={planId} planName={plan.displayName} />
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </section>

          <p className="text-center text-xs leading-5 text-muted-foreground">
            Standard／MDはご自身のAPI契約を利用するため、Space AIの月額料金とは別にX・生成AI各社の利用料がかかります。
          </p>

            </>
          )}
        </div>
      </main>
      <LegalFooter />
    </div>
  );
}
