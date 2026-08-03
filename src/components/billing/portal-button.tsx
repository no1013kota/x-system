"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { primaryLinkClassName } from "@/components/ui/link-button";
import { useToast } from "@/components/ui/toast";
import { startCustomerPortal } from "@/lib/stripe/portal-browser";

/**
 * プラン管理（Stripe Customer Portal）へ入る（T-M8-29）。
 *
 * **Stripeの顧客がまだ無いときは押せないボタンを出さない。** 以前は無効化したボタンと
 * 「お申し込み後にご利用いただけます」の一文を出していたが、押しても何も起きないボタンは
 * 「壊れている」と読める（実際そう報告された）。契約前は行き先が料金プランなので、
 * そこへのリンクに切り替える（押せば必ずどこかへ着く）。
 */
export function PortalButton({ enabled }: { enabled: boolean }) {
  const [pending, setPending] = useState(false);
  const toast = useToast();

  async function openPortal() {
    setPending(true);
    try {
      await startCustomerPortal();
    } catch (cause) {
      toast.show({
        tone: "error",
        title: "プラン管理画面を開けませんでした",
        description: cause instanceof Error ? cause.message : "時間をおいてもう一度お試しください。",
      });
      setPending(false);
    }
  }

  // 契約前（Stripeの顧客が無い）は Portal を作れない。料金プランへのリンクにする。
  if (!enabled) {
    return (
      <Link className={primaryLinkClassName} href="/plans">
        プランを選ぶ
      </Link>
    );
  }

  return (
    <Button
      aria-busy={pending}
      className="h-9"
      disabled={pending}
      onClick={openPortal}
      size="lg"
      type="button"
      variant="brand"
    >
      {pending ? "プラン管理画面を開いています…" : "プランを管理"}
    </Button>
  );
}
