"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { PlanId } from "@/lib/plans";
import { startCheckout } from "@/lib/stripe/checkout-browser";

export function CheckoutButton({
  plan,
  planName,
  trialAvailable = true,
  variant = "brand",
}: {
  plan: PlanId;
  planName: string;
  /** 無料トライアルは初回のみ。消化済みの利用者へ「7日間無料」と書かない（有利誤認の回避）。 */
  trialAvailable?: boolean;
  /** 推奨プランだけ brand で強調し、他は subtle にする（T-M8-169）。 */
  variant?: "brand" | "subtle";
}) {
  const [pending, setPending] = useState(false);
  const toast = useToast();

  async function handleCheckout() {
    setPending(true);
    try {
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
          trialAvailable ? `${planName}を7日間無料で利用` : `${planName}で始める`
        }
        className="h-11 w-full"
        disabled={pending}
        onClick={handleCheckout}
        type="button"
        variant={variant}
      >
        {pending
          ? "決済画面を開いています…"
          : trialAvailable
            ? "7日間無料で利用"
            : "このプランで始める"}
      </Button>
    </div>
  );
}
