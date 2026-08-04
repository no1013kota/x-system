import type { Metadata } from "next";
import { yen } from "@/lib/format";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/session";
import { subscriptionAccessFor } from "@/lib/auth/subscription-access";
import { LegalFooter } from "@/components/legal-footer";
import { APP_NAME } from "@/lib/app-config";
import { PLAN_IDS, PLANS, type PlanId } from "@/lib/plans";
import { env } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

import { SignOutButton } from "@/components/app-shell/sign-out-button";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";

import { CheckoutButton } from "./checkout-button";
import { CheckoutPending } from "./checkout-pending";
import { CardTitle, cardClassName } from "@/components/ui/card";

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

/**
 * カードに並べる特長（デザイン §料金プラン）。
 *
 * **件数・上限は `PLANS` から引く**。ここへ数字を書き写すと、プラン定義を変えたときに
 * この画面だけ古い数字を出し続ける（利用者から見れば「書いてある内容と違う」）。
 */
function planFeatures(planId: PlanId): string[] {
  const plan = PLANS[planId];
  const accounts = `連携Xアカウント ${plan.xAccountLimit}`;
  if (planId === "standard") {
    return [
      "基本機能すべて（生成・自動運用・分析）",
      "X APIキー・生成AIキーはご自身で用意（BYOK）",
      accounts,
      "月間利用上限なし（ご自身のAPI課金の範囲）",
    ];
  }
  if (planId === "md") {
    return [
      "通常プランの全機能",
      "ベースmd・プロンプトの直接編集",
      "編集履歴とロールバック",
      accounts,
    ];
  }
  const limits = plan.usageLimits;
  return [
    "mdプランの全機能",
    "APIキー登録が一切不要（運営キーで動作）",
    limits
      ? `月間上限：通常投稿${limits.normalPosts}／URL付き${limits.urlPosts}／文章生成${limits.generations}／画像${limits.images}`
      : "月間上限なし",
    `${accounts}（利用上限は合算）`,
  ];
}

/** カード左上のタグ。プレミアムだけキーのグラデーション（デザイン §料金プラン）。 */
const PLAN_TAG: Partial<Record<PlanId, { label: string; className: string }>> = {
  md: { label: "人気", className: "bg-brand" },
  premium: { label: "キー登録不要", className: "[background-image:var(--brand-gradient)]" },
};

const SIGNUP_FLOW: { step: string; title: string; description: string }[] = [
  { step: "1", title: "アカウント作成", description: "メールアドレス＋パスワードで登録し、確認メールで本人認証" },
  { step: "2", title: "カード登録", description: "Stripe Checkoutで安全に登録。7日間無料トライアルが開始" },
  { step: "3", title: "初期設定", description: "設定画面から任意の順で。不足はホームのガイドでご案内" },
  { step: "4", title: "運用開始", description: "1日数分の確認だけで、自分らしい発信が継続できます" },
];

const BYOK_SETUP = [
  "X APIキー登録（取得手順ガイド付き）",
  "X連携 — ご自身のDeveloper App経由でOAuth認可",
  "生成AI APIキー登録（Claude／OpenAI／Gemini から1つ以上）",
  "ペルソナ・テーマ・トンマナ・NG設定（ベースmd自動生成）",
  "学習（任意）— 参考アカウント・過去投稿の取り込み",
];

const PREMIUM_SETUP = [
  "X連携 — 運営のDeveloper App経由でOAuth認可",
  "ペルソナ・テーマ・トンマナ・NG設定（ベースmd自動生成）",
  "学習（任意）— 参考アカウント・過去投稿の取り込み",
];

const CONFIRMATION_ITEMS: { term: string; description: string }[] = [
  { term: "料金", description: "税込月額500円〜2,980円" },
  { term: "無料期間", description: "初回のみ7日間。開始時にカード登録が必要です" },
  { term: "自動更新", description: "無料期間終了後、選択プランを月単位で自動更新します" },
  { term: "支払時期", description: "初回は無料期間終了時、以後は毎月の更新日に請求します" },
  { term: "解約方法", description: "設定のCustomer Portalからいつでも期間末解約できます" },
  { term: "提供開始", description: "Checkout完了後、契約反映が確認でき次第すぐに開始します" },
];

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
              <h1 className="text-[26px] font-bold tracking-tight text-ink sm:text-[30px]">
                あなたの運用に合うプランを選択
              </h1>
              <p className="text-sm leading-6 text-muted-foreground sm:text-base">
                表示価格はすべて税込です。初回のお申し込みに限り、7日間の無料トライアルをご利用いただけます。
              </p>
            </div>
          </header>

          {params.checkout === "canceled" ? (
            <p className="mx-auto max-w-3xl rounded-card border bg-card p-4 text-sm" role="status">
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
            className="mx-auto max-w-3xl rounded-card border bg-card p-5 text-xs leading-5 text-muted-foreground"
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

          {/*
           * プランカード（SC-04: 3プラン比較・デザイン §料金プラン）。
           *
           * 以前は横スクロールする比較表だった。表のセルは `sr-only` ラベル（`position:absolute`）を
           * 持つため、位置指定された祖先が無いとスクロール容器にクリップされず**ページ自体を
           * 横に伸ばす**という罠があった（T-M7-26）。カードは縦に積むだけなのでその制約が消える。
           */}
          <section aria-label="料金プラン" className="grid items-stretch gap-3.5 sm:grid-cols-3">
            {PLAN_IDS.map((planId) => {
              const plan = PLANS[planId];
              const tag = PLAN_TAG[planId];
              return (
                <div
                  className={`relative flex flex-col gap-3 rounded-card bg-surface p-[22px] shadow-[var(--shadow-card)] ${
                    planId === "premium" ? "border-[1.5px] border-brand" : "border border-hairline"
                  }`}
                  key={planId}
                >
                  {tag ? (
                    <span
                      className={`absolute -top-2.5 left-[18px] rounded-chip px-2.5 py-0.5 text-[10.5px] font-bold text-white ${tag.className}`}
                    >
                      {tag.label}
                    </span>
                  ) : null}
                  <div>
                    <h2 className="text-sm font-bold text-ink">{plan.displayName}</h2>
                    <p className="text-[11.5px] text-ink-3">{PLAN_TAGLINE[planId]}</p>
                  </div>
                  <p className="flex items-baseline gap-0.5">
                    <span className="font-sans text-[30px] font-extrabold leading-none tabular-nums text-ink">
                      ¥{yen(plan.monthlyPriceJpy)}
                    </span>
                    <span className="whitespace-nowrap text-xs text-ink-3">／月（税込）</span>
                  </p>
                  <ul className="flex flex-1 flex-col gap-[7px]">
                    {planFeatures(planId).map((feature) => (
                      <li className="flex items-start gap-[7px] text-xs leading-[1.55] text-ink-2" key={feature}>
                        <Icon name="check" className="mt-0.5 shrink-0 text-brand" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                  <CheckoutButton plan={planId} planName={plan.displayName} />
                </div>
              );
            })}
          </section>

          {/* BYOKの追加費用は申込前に必ず読ませる（要件03 §54）。折りたたまない。 */}
          <section
            aria-label="BYOKプランのご注意"
            className="flex items-start gap-2.5 rounded-card bg-warn-bg px-4 py-3"
          >
            <Icon className="mt-0.5 shrink-0 text-warn-fg" name="error" size={18} />
            <p className="text-xs leading-[1.65] text-ink-2">
              <strong className="font-bold">BYOKプラン（通常・md）のご注意：</strong>
              X APIの利用料（従量課金）と生成AI APIの従量課金が別途発生します。プレミアムプランではAPI費用の追加負担はありません。トライアル期間中に解約された場合、課金は発生しません。
            </p>
          </section>

          <section
            aria-labelledby="signup-flow-heading"
            className={`${cardClassName} p-[22px]`}
          >
            <CardTitle id="signup-flow-heading">
              ご登録の流れ
            </CardTitle>
            <ol className="mt-4 grid gap-3 sm:grid-cols-4">
              {SIGNUP_FLOW.map((item) => (
                <li className="flex flex-col gap-[7px]" key={item.step}>
                  <div className="flex items-center gap-2">
                    <span className="grid size-6 shrink-0 place-items-center rounded-pill bg-brand font-sans text-xs font-bold text-white">
                      {item.step}
                    </span>
                    <span className="text-[13px] font-bold text-ink">{item.title}</span>
                  </div>
                  <p className="pl-8 text-[11.5px] leading-[1.6] text-ink-3">{item.description}</p>
                </li>
              ))}
            </ol>
            <div className="mt-[18px] grid gap-3 sm:grid-cols-2">
              <div className="rounded-card border border-hairline px-4 py-3.5">
                <div className="mb-2 flex items-center gap-2">
                  <h3 className="text-[12.5px] font-bold text-ink">初期設定（BYOK：通常・mdプラン）</h3>
                  <Badge tone="info">キーはご自身で用意</Badge>
                </div>
                <ul className="flex flex-col gap-1.5">
                  {BYOK_SETUP.map((step) => (
                    <li className="flex items-center gap-[7px] text-[11.5px] text-ink-2" key={step}>
                      <span aria-hidden="true" className="size-[5px] shrink-0 rounded-pill bg-info-fg" />
                      {step}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-card border border-hairline px-4 py-3.5">
                <div className="mb-2 flex items-center gap-2">
                  <h3 className="text-[12.5px] font-bold text-ink">初期設定（プレミアムプラン）</h3>
                  <Badge tone="brand">キー登録は一切不要</Badge>
                </div>
                <ul className="flex flex-col gap-1.5">
                  {PREMIUM_SETUP.map((step) => (
                    <li className="flex items-center gap-[7px] text-[11.5px] text-ink-2" key={step}>
                      <span aria-hidden="true" className="size-[5px] shrink-0 rounded-pill bg-brand" />
                      {step}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <p className="mt-3.5 text-[11px] leading-5 text-ink-3">
              決済はStripeホスト型Checkoutで安全に行われます。プラン変更・解約・カード更新はStripeカスタマーポータルから。専用のオンボーディング画面はなく、設定が不足している場合はホームの初期設定ガイドとエラー表示でご案内します。
            </p>
          </section>

            </>
          )}
        </div>
      </main>
      <LegalFooter />
    </div>
  );
}
