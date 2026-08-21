import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { signOut } from "@/app/actions/auth";
import { getCurrentUser } from "@/lib/auth/session";
import { readSingleRow } from "@/lib/supabase/single-row";
import { ensureUserProfile } from "@/lib/auth/profile";
import { subscriptionAccessFor } from "@/lib/auth/subscription-access";
import { LegalFooter } from "@/components/legal-footer";
import { APP_NAME } from "@/lib/app-config";
import { CampaignCallout } from "@/components/billing/campaign-callout";
import { PlanPricingCards, RECOMMENDED_PLAN } from "@/components/billing/plan-pricing-cards";
import { env } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

import { SignOutButton } from "@/components/app-shell/sign-out-button";
import { Icon } from "@/components/ui/icon";

import { CheckoutButton } from "./checkout-button";
import { CheckoutPending } from "./checkout-pending";
import { cardClassName } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";

export const metadata: Metadata = {
  title: `プラン選択 | ${APP_NAME}`,
};

interface PlansPageProps {
  searchParams: Promise<{ checkout?: string; confirmed?: string }>;
}

export default async function PlansPage({ searchParams }: PlansPageProps) {
  const [params, user] = await Promise.all([searchParams, getCurrentUser()]);
  // Checkout直後の反映待ち。反映が済むと下の判定で /app へリダイレクトされる。
  const awaitingCheckout = params.checkout === "success";
  // 無料トライアルは初回のみ。消化済みの利用者へ「7日間無料」を出すと有利誤認になる（レビュー修正）。
  let trialAvailable = true;

  // 契約が有効（trialing/active）で本編を使えるユーザーが /plans に来たら /app へ送り、
  // 決済成功後にこの画面で行き止まりになるのを防ぐ。incomplete・canceled 等はプラン選択／
  // 再申込のため /plans に留める（canExecute は trialing/active のみ true）。
  //
  // **ただし Stripe の顧客が紐づいていない契約者は送り返さない**（T-M8-54）。
  // 送り返すと、設定＞課金の「プランを選ぶ」を押してもホームへ戻るだけで**何もできない**。
  // この状態はwebhookの到着順で一時的に起こり得るうえ、同期が来なければ恒久的に詰まるので、
  // 申し込みをやり直せる場所（この画面）へ入れる。
  if (user) {
    const admin = createSupabaseAdminClient();
    const readProfile = () =>
      admin
        .from("profiles")
        .select("plan, subscription_status, stripe_customer_id, trial_used_at")
        .eq("id", user.id)
        .maybeSingle();
    let profileResult = await readProfile();
    // Signup/sign-in normally creates this row. Repair only legacy/missing rows here instead
    // of adding a profile lookup to every getCurrentUser call (T-M8-154).
    if (!profileResult.error && !profileResult.data) {
      await ensureUserProfile(user);
      profileResult = await readProfile();
    }
    // 最終読み取りの失敗を「未契約」に見せない（T-M8-158）。潰すと契約中の利用者が
    // 理由の分からないまま `/plans` に留まる。
    const profile = readSingleRow(profileResult, "plans profile");
    if (profile?.trial_used_at) trialAvailable = false;
    if (
      profile?.plan &&
      profile.stripe_customer_id &&
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
              {user ? (
                <SignOutButton label={false} signOutAction={signOut} />
              ) : null}
            </div>
            <div className="space-y-3">
              {/* 参考ページの「Special offer」ピルに相当（T-M8-169）。 */}
              {trialAvailable ? (
                <p className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-3.5 py-1.5 text-caption font-bold text-ink-2">
                  <Icon aria-hidden="true" className="text-brand" name="star_shine" size={14} />
                  すべてのプランを7日間無料でお試し
                </p>
              ) : null}
              <h1 className="text-[28px] font-bold tracking-tight text-balance text-ink sm:text-[34px]">
                あなたの運用に合うプランを選択
              </h1>
              {/* 税込は各カードの価格表記に、トライアルは上のアイキャッチと「お申し込み前の確認」にある（T-M8-66）。 */}
            </div>
          </header>

          {params.checkout === "canceled" ? (
            <p className={`${cardClassName} mx-auto max-w-3xl p-4 text-sm`} role="status">
              決済手続きは完了していません。プランを確認して、もう一度お試しください。
            </p>
          ) : null}

          {/*
            メール確認からの着地（T-M8-58）。**成功も必ず言う**——失敗時は「リンクを確認
            できませんでした」が出るのに、成功は無言で料金表に変わるだけだった。
            確認メールのリンクを押した人は「確認できたのか」をまずここで知りたい。
          */}
          {params.confirmed === "1" ? (
            <Notice className="mx-auto max-w-3xl" role="status" tone="success">
              メールアドレスの確認が完了しました。プランを選ぶと7日間の無料トライアルを開始できます。
            </Notice>
          ) : null}

          {/* 反映待ちの間はプラン比較表とCTAを描画せず、待機カードだけを出す（二重申込の防止）。 */}
          {awaitingCheckout ? (
            <CheckoutPending supportEmail={env.SUPPORT_EMAIL ?? null} />
          ) : (
            <>
          {/*
            申込前の定型文はプロモ帯（CampaignCallout）へ畳んだ（T-M8-171・運営者の決定 2026-08-21）。
            「初回のみ」「カード登録が必要」の開示は帯の中に残る。自動更新・解約の法定事項は
            フッタの特定商取引法ページ・利用規約が担う。
          */}
          <CampaignCallout className="mx-auto max-w-3xl" trialAvailable={trialAvailable} />

          {/*
            プランのカード型表示（T-M8-169・運営者の指示 2026-08-21。参考: tweethunter.io/pricing）。
            T-M8-125の表を `/plans` では置き換えた（LPの料金セクションは表のまま）。
            行・価格・可否は `lib/plan-comparison.ts`／`PLANS` から導き、画面に書き写さない。
            CTAは各カードの中に置き、推奨（プレミアム）だけ brand で強調する。
          */}
          <section aria-label="料金プラン">
            <PlanPricingCards
              cta={(planId, planName) => (
                <CheckoutButton
                  plan={planId}
                  planName={planName}
                  trialAvailable={trialAvailable}
                  variant={planId === RECOMMENDED_PLAN ? "brand" : "subtle"}
                />
              )}
            />
          </section>

            </>
          )}
        </div>
      </main>
      <LegalFooter />
    </div>
  );
}
