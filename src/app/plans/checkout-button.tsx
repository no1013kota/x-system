"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
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
  const [error, setError] = useState<string | null>(null);

  async function handleCheckout() {
    setPending(true);
    setError(null);
    try {
      await startCheckout(plan);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "決済画面を開けませんでした。",
      );
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <Button
        aria-busy={pending}
        className="h-11 w-full"
        disabled={pending}
        onClick={handleCheckout}
        type="button"
        variant={plan === "premium" ? "default" : "outline"}
      >
        {pending ? "決済画面を開いています…" : `${planName}を選ぶ`}
      </Button>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
