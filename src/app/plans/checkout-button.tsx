"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { PlanId } from "@/lib/plans";
import { startCheckout } from "@/lib/stripe/checkout-browser";

export function CheckoutButton({
  plan,
  planName,
}: {
  plan: PlanId;
  planName: string;
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
        aria-label={`${planName}を7日間無料で利用`}
        className="h-11 w-full"
        disabled={pending}
        onClick={handleCheckout}
        type="button"
        variant={plan === "premium" ? "default" : "outline"}
      >
        {pending ? "決済画面を開いています…" : "7日間無料で利用"}
      </Button>
    </div>
  );
}
