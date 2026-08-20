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
import { PlanComparisonTable } from "@/components/billing/plan-comparison-table";
import { PLAN_IDS, PLANS } from "@/lib/plans";
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
        .select("plan, subscription_status, stripe_customer_id")
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
            <div className="space-y-2">
              <p className="text-sm font-semibold text-muted-foreground">
                すべてのプランを7日間無料でお試し
              </p>
              <h1 className="text-[26px] font-bold tracking-tight text-ink sm:text-[30px]">
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
            申込前の重要事項（T-M8-125で縮めた）。特商法の法定事項の全文は
            `/legal/commercial-transactions` が担う。**リンクは残す**——申込ボタンの前に
            重要事項へ辿れる状態を無くさないため（要件06 §1.1・要件03 §54の趣旨）。
            定義リストは比較表と重複していたので落とした（運営者の指示・2026-08-18）。
          */}
          <p className="mx-auto max-w-3xl text-center text-caption text-ink-3">
            全プラン初回のみ7日間無料（開始時にカード登録が必要です）。無料期間の終了後、選択したプランを
            月単位で自動更新します。解約はいつでも設定画面から行え、期間末で終了します。
            <Link
              className="mx-1 font-medium text-ink underline underline-offset-4"
              href="/legal/commercial-transactions"
              target="_blank"
            >
              特定商取引法に基づく表記
            </Link>
          </p>

          {/*
            プラン比較表（T-M8-125）。**機能を行見出しにして各プランに ✓ / − を付ける**
            （運営者の指示・2026-08-18）。以前はプランごとの箇条書きカードで、
            「mdプランの全機能」という入れ子の言い方だったため、上位プランに何が積まれるのかが
            読み取れなかった。行と可否は `lib/plan-comparison.ts` が持つ（画面に書き写さない）。
            表示はLPと共通の部品を使う。
          */}
          <section aria-label="料金プラン">
            <PlanComparisonTable />
            <div className="mt-5 grid gap-2.5 sm:grid-cols-3">
              {PLAN_IDS.map((planId) => (
                <CheckoutButton key={planId} plan={planId} planName={PLANS[planId].displayName} />
              ))}
            </div>
          </section>

          {/* BYOKの追加費用は申込前に必ず読ませる（要件03 §54）。折りたたまない。 */}
          <section
            aria-label="BYOKプランのご注意"
            className="flex items-start gap-2.5 rounded-card bg-warn-bg px-4 py-3"
          >
            <Icon className="mt-0.5 shrink-0 text-warn-fg" name="error" size={18} />
            {/* 申込前のBYOK追加費用の明示（要件03）は1文で満たす。トライアル解約時の扱いは確認dlにある（T-M8-66）。 */}
            <p className="text-xs leading-[1.65] text-ink-2">
              <strong className="font-bold">通常・mdプランのご注意：</strong>
              X APIと生成AI APIの利用料が別途発生します（プレミアムプランは追加負担なし）。
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
