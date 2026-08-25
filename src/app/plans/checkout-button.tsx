"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { PlanId } from "@/lib/plans";
import { remainingTrialPlanNote } from "@/lib/billing/remaining-trial";
import { startCheckout } from "@/lib/stripe/checkout-browser";
import { startPlanResume } from "@/lib/stripe/resume-browser";
import { usePageshowReset } from "@/lib/ui/use-pageshow-reset";

export function CheckoutButton({
  plan,
  planName,
  trialAvailable = true,
  remainingTrialLabel = null,
  variant = "brand",
}: {
  plan: PlanId;
  planName: string;
  /** 無料トライアルは初回のみ。消化済みの利用者へ「7日間無料」と書かない（有利誤認の回避）。 */
  trialAvailable?: boolean;
  /**
   * 解約後に残っている無料トライアルの期限（T-M8-298）。**元のプランに限らず、どのプランでも**
   * その日まで無料。7日間の新規トライアルとは別物なので文言を分ける
   * （「7日間無料」と書くと期間を配り直すように読める）。
   */
  remainingTrialLabel?: string | null;
  /** 推奨プランだけ brand で強調し、他は subtle にする（T-M8-169）。 */
  variant?: "brand" | "subtle";
}) {
  const [pending, setPending] = useState(false);
  // Stripeから「戻る」で復帰したとき押せる状態へ戻す（T-M8-212）。
  usePageshowReset(() => setPending(false));
  const router = useRouter();
  const toast = useToast();

  async function handleCheckout() {
    setPending(true);
    try {
      /*
        **トライアルが残っているなら、Stripeの画面を挟まずその場で始める**
        （T-M8-298・運営者の指示 2026-08-25）。カードは解約前に登録済みなので、
        無料の期間を使うのに入力し直させる理由がない。
        **カードが保存されていなければ 402 が返る**ので、そのときだけCheckout（カード入力つき）へ。
        それ以外の失敗はCheckoutへ倒さない——倒すと「無料のはず」が有料の申し込みに化ける。
      */
      if (remainingTrialLabel) {
        const resumed = await startPlanResume(plan);
        if (resumed.ok) {
          toast.show({
            tone: "success",
            title: `${planName}を開始しました`,
            description: `${remainingTrialLabel}までは料金が発生しません。`,
          });
          router.push("/app");
          return;
        }
        if (resumed.status !== 402) {
          toast.show({
            tone: "error",
            title: "プランを開始できませんでした",
            description:
              ("error" in resumed && resumed.error?.message) ||
              "時間をおいてもう一度お試しください。",
          });
          return;
        }
        // 402 = 保存済みのカードが無い。カード入力のあるCheckoutへ進む（無料期間は引き継がれる）。
      }
      await startCheckout(plan);
    } catch (cause) {
      toast.show({
        tone: "error",
        title: "決済画面を開けませんでした",
        description: cause instanceof Error ? cause.message : "時間をおいてもう一度お試しください。",
      });
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <Button
        aria-busy={pending}
        aria-label={
          remainingTrialLabel
            ? `${planName}を${remainingTrialLabel}まで無料で利用`
            : trialAvailable
              ? `${planName}を7日間無料で利用`
              : `${planName}で始める`
        }
        className="h-11 w-full"
        disabled={pending}
        onClick={handleCheckout}
        type="button"
        variant={variant}
      >
        {pending
          ? "決済画面を開いています…"
          : remainingTrialLabel
            ? `${remainingTrialLabel}まで無料で利用`
            : trialAvailable
              ? "7日間無料で利用"
              : "このプランで始める"}
      </Button>
      {remainingTrialLabel ? (
        // 押す前に「いつまで無料で、その後いくらか」を読めるようにする（黙って請求を始めない）。
        <p className="text-caption text-ink-3">{remainingTrialPlanNote(plan, remainingTrialLabel)}</p>
      ) : null}
    </div>
  );
}
