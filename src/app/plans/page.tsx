import type { Metadata } from "next";
import { recordPageView } from "@/lib/ops/page-view-server";
import { parseTrafficSource } from "@/lib/ops/traffic-source";
import Link from "next/link";
import { redirect } from "next/navigation";

import { signOut } from "@/app/actions/auth";
import { getCurrentUser } from "@/lib/auth/session";
import { readSingleRow } from "@/lib/supabase/single-row";
import { ensureUserProfile } from "@/lib/auth/profile";
import { subscriptionAccessFor } from "@/lib/auth/subscription-access";
import { LegalFooter } from "@/components/legal-footer";
import { APP_NAME } from "@/lib/app-config";
import {
  PlanPickerRecommendFirst,
} from "@/components/billing/plan-picker-recommend-first";
import { RECOMMENDED_PLAN } from "@/components/billing/plan-pricing-cards";
import { LEGAL_ENTITY } from "@/lib/legal-entity";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

import { SignOutButton } from "@/components/app-shell/sign-out-button";
import { Icon } from "@/components/ui/icon";

import { CheckoutButton } from "./checkout-button";
import { CheckoutPending } from "./checkout-pending";
import { cardClassName } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PLANS, type PlanId } from "@/lib/plans";
import {
  remainingTrialHeadline,
  remainingTrialLabel,
} from "@/lib/billing/remaining-trial";
import { serverNowMs } from "@/lib/time/server-now";

export const metadata: Metadata = {
  title: `プラン選択 | ${APP_NAME}`,
};

interface PlansPageProps {
  searchParams: Promise<{ checkout?: string; confirmed?: string; signup?: string; src?: string }>;
}

export default async function PlansPage({ searchParams }: PlansPageProps) {
  // 入口ファネル（T-M8-378）。応答後に書くので表示は遅くならない。
  await recordPageView("/plans", { source: parseTrafficSource((await searchParams).src) });

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
  // 解約済み（データ保持中）の再開案内に使う（T-M8-266）。
  let canceledPlanLabel: string | null = null;
  /** 解約後に残っている無料トライアルの期限（「2026年8月31日」）。無ければ null。 */
  let trialLabel: string | null = null;
  if (user) {
    const admin = createSupabaseAdminClient();
    const readProfile = () =>
      admin
        .from("profiles")
        .select("plan, subscription_status, stripe_customer_id, trial_used_at, trial_ends_at")
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
    /*
      **解約後に残っている無料トライアル**（T-M8-298・運営者の指示 2026-08-25）。
      期限内なら**どのプランでも**その日まで無料で始められる。`trial_used_at` があるからと
      「トライアルなし」の顔をすると、無料のはずの人が満額を請求される（実際に起きた）。
    */
    trialLabel = remainingTrialLabel(profile?.trial_ends_at ?? null, await serverNowMs());
    if (
      profile?.plan &&
      profile.stripe_customer_id &&
      subscriptionAccessFor(profile.subscription_status)?.canExecute
    ) {
      redirect("/app");
    }
    if (
      profile?.subscription_status === "canceled" &&
      profile.plan &&
      profile.stripe_customer_id
    ) {
      canceledPlanLabel = PLANS[profile.plan as PlanId]?.displayName ?? null;
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <main className="flex-1 px-4 py-10 sm:py-14">
        {/* SPは見出し→キャップ行の余白を詰める（LPの `mt-[clamp(16px,3vw,40px)]` に近づける・T-M8-424 のレビュー）。 */}
        <div className="mx-auto max-w-5xl space-y-6 sm:space-y-10">
          {/* ロゴ／ログアウトは全幅（キャップ行・カード・帯と左右の縁を揃える。以前は max-w-3xl の中で128px内側から始まっていた）。 */}
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
          <header className="mx-auto max-w-3xl space-y-3 text-center">
            {/* 参考ページの「Special offer」ピルに相当（T-M8-169）。 */}
            {trialLabel ? (
              // 残りのトライアルがある人には「何日まで・どのプランでも無料」を出す（T-M8-298）。
              <p className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-3.5 py-1.5 text-caption font-bold text-ink-2">
                <Icon aria-hidden="true" className="text-brand" name="star_shine" size={14} />
                {trialLabel}まで、どのプランでも無料
              </p>
            ) : trialAvailable ? (
              <p className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-3.5 py-1.5 text-caption font-bold text-ink-2">
                <Icon aria-hidden="true" className="text-brand" name="star_shine" size={14} />
                すべてのプランを7日間無料でお試し
              </p>
            ) : null}
            {/*
              見出しはLPの料金セクションと同じ「業界最安価の価格設定」（運営者の指示 2026-09-04・D-56）。
              選び方の1文とカード登録の条件はLPと同じく置かない。無料の条件（カード登録が必要・期間中解約無料）は
              カード下の CampaignCallout（trialAvailable で出し分け）と特商法ページが担う。
            */}
            <h1 className="text-[28px] font-bold tracking-tight text-balance text-ink sm:text-[34px]">
              業界最安価の価格設定
            </h1>
            {/* 税込は各カードの価格表記に、トライアルは上のアイキャッチとカード下のプロモ帯にある（T-M8-66）。 */}
          </header>

          {/*
            解約済みの着地（T-M8-266）。解約後は機能画面を開けないため、この画面が入口になる。
            **データが消えていないこと**と、カード入力なしで戻れる道（設定＞課金の「プランを再開」）を
            先に示す。別プランにしたい場合は下のカードから通常のCheckoutへ。
          */}
          {canceledPlanLabel ? (
            <Notice className="mx-auto max-w-3xl" role="status" tone="warn">
              ご契約は終了しています。データは保持されており、再開するとそのまま使えます。
              {trialLabel ? (
                <>
                  {/*
                    **無料トライアルが残っていることを最初に言う**（T-M8-298・運営者の指示
                    2026-08-25）。ここが「再開してください」だけだと、料金が発生すると読めて
                    しまい、無料で戻れる人が戻らない。
                  */}
                  <strong className="mx-1">
                    {remainingTrialHeadline(trialLabel)}
                  </strong>
                  {canceledPlanLabel}のまま再開する場合は
                  <Link className="mx-1 underline" href="/app/settings?tab=billing">
                    設定の課金・プラン（無料トライアルを再開）
                  </Link>
                  から、別のプランにする場合は下から選べます（どちらも料金は発生しません）。
                </>
              ) : (
                <>
                  {canceledPlanLabel}を同じ条件で再開する場合は
                  <Link className="mx-1 underline" href="/app/settings?tab=billing">
                    設定の課金・プラン（プランを再開）
                  </Link>
                  から、別のプランにする場合は下から選べます。
                </>
              )}
            </Notice>
          ) : null}

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
          ) : params.signup === "1" ? (
            // メール確認を省略した登録の着地（T-M8-202）。成功を必ず言う（原則1）。
            <Notice className="mx-auto max-w-3xl" role="status" tone="success">
              登録が完了しました。プランを選ぶと7日間の無料トライアルを開始できます。
            </Notice>
          ) : null}

          {/* 反映待ちの間はプラン比較表とCTAを描画せず、待機カードだけを出す（二重申込の防止）。 */}
          {awaitingCheckout ? (
            /*
              問い合わせ先は**法務ページと同じ値**を使う（T-M8-343）。以前は
              `env.SUPPORT_EMAIL` を出していたため、法務ページ（`LEGAL_ENTITY.email`）と
              別のアドレスになりうる二重管理だった。`SUPPORT_EMAIL` は
              **運営者向けアラートの宛先**として残す（利用者には出さない）。
            */
            <CheckoutPending supportEmail={LEGAL_ENTITY.email} />
          ) : (
            <>
          {/*
            料金はLP `#pricing` と同じ「推奨先行」の組み立て（`PlanPickerRecommendFirst`・T-M8-424・
            運営者の依頼 2026-09-04「ホームページの料金に /plans も合わせる」）: 上に「約N円／日」の
            キャップ行（推奨だけ brand 帯「まずはこれ」。カード内の「おすすめ」バッジは帯が代わる）、
            プランカード3枚（T-M8-169。行・価格・可否は `lib/plan-comparison.ts`／`PLANS` から導き、
            画面に書き写さない）、その下にプロモ帯（CampaignCallout）。
            申込前の定型文は帯へ畳んである（T-M8-171・運営者の決定 2026-08-21）。「カード登録が必要」の
            開示は帯の中と、上の選び方の1文の末尾（CTAより上）に残る。**「初回限り」は2026-08-26に帯から
            外した**（運営者の最終レビュー）ので、この画面の本文には出ない——開示はフッタの特定商取引法
            ページ・利用規約が担う。自動更新・解約の法定事項も同じ。トライアル消化済みの利用者には帯の
            トライアル文を出さない（`trialAvailable`・有利誤認の回避）。
            CTAは各カードの中（CheckoutButton）。推奨（プレミアム）だけ brand で強調する。
            背景はLPの `#pricing` と同じ brand の radial glow（両隣の「ガラス」が平坦な面だと白い枠にしか
            見えない——レビュー）。装飾なので読み上げ・E2E には影響しない。
          */}
          <section aria-label="料金プラン" className="relative isolate">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
            >
              <div className="absolute left-1/2 top-1/2 size-[720px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(125,31,117,0.10),transparent_70%)] blur-3xl" />
            </div>
            <PlanPickerRecommendFirst
              cta={(planId, planName) => (
                <CheckoutButton
                  plan={planId}
                  remainingTrialLabel={trialLabel}
                  planName={planName}
                  trialAvailable={trialAvailable}
                  variant={planId === RECOMMENDED_PLAN ? "brand" : "subtle"}
                />
              )}
              trialAvailable={trialAvailable}
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
