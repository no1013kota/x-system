"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { primaryLinkClassName } from "@/components/ui/link-button";
import { useToast } from "@/components/ui/toast";
import type { PortalIntent } from "@/lib/stripe/portal";
import { startCustomerPortal } from "@/lib/stripe/portal-browser";

/**
 * プラン管理の導線（T-M8-31）。
 *
 * **やりたいことを先に選ばせる。** 以前は「プランを管理」1つだけで、押した先で何ができるのかが
 * 分からなかった。プラン変更と解約は行き先が違うので、ここで選んで Stripe の該当画面へ
 * 直接入る（`flow_data`）。決済情報の更新・請求書はPortal内から辿れる。
 *
 * **Stripeの顧客がまだ無いときは押せないボタンを出さない**（T-M8-29）。押しても何も起きない
 * ボタンは「壊れている」と読める。契約前の行き先は料金プランなので、そこへのリンクにする。
 */
export function PortalButton({ enabled }: { enabled: boolean }) {
  const [pending, setPending] = useState<PortalIntent | null>(null);
  const toast = useToast();

  function open(intent: PortalIntent) {
    return async () => {
      setPending(intent);
      try {
        await startCustomerPortal(intent);
      } catch (cause) {
        toast.show({
          tone: "error",
          title: "プラン管理画面を開けませんでした",
          description: cause instanceof Error ? cause.message : "時間をおいてもう一度お試しください。",
        });
        setPending(null);
      }
    };
  }

  if (!enabled) {
    // Stripeの顧客が無いあいだは Portal を作れないので、行き先は `/plans` にする。
    //
    // **説明文は足さない**（T-M8-54）。同期の遅延はカード直下の
    // 「変更内容はStripeからの通知を受けてこの画面へ反映されます（数十秒かかることがあります）」
    // が既に伝えている。同じことを2か所で言うと、常時出る注意書きとして読み飛ばされる。
    // 跳ね返り（`/plans` が契約者を `/app` へ送り返す）は `/plans` 側で直した。
    return (
      <Link className={primaryLinkClassName} href="/plans">
        プランを選ぶ
      </Link>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button
          aria-busy={pending === "update"}
          className="h-9"
          disabled={pending !== null}
          onClick={open("update")}
          size="lg"
          type="button"
          variant="brand"
        >
          {pending === "update" ? "開いています…" : "プランを変更"}
        </Button>
        <Button
          aria-busy={pending === "cancel"}
          className="h-9"
          disabled={pending !== null}
          onClick={open("cancel")}
          size="lg"
          type="button"
          variant="outline"
        >
          {pending === "cancel" ? "開いています…" : "解約する"}
        </Button>
      </div>
      <p className="text-xs leading-5 text-ink-3">
        どちらもStripeの安全な画面へ移動します。解約は期間末で、支払い済みの期間は続けて使えます。お支払い方法の変更と請求書は「プランを変更」の先から辿れます。
      </p>
    </div>
  );
}
