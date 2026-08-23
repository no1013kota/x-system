"use client";

import Link from "next/link";
import { useState } from "react";

import { KeepSubscriptionButton } from "@/components/billing/keep-subscription-button";
import { CancelScheduledPlanChangeButton } from "@/components/billing/scheduled-plan-change-button";
import { Button } from "@/components/ui/button";
import { primaryLinkClassName } from "@/components/ui/link-button";
import { useToast } from "@/components/ui/toast";
import type { PlanChangeEffects } from "@/lib/billing/plan-change-effects";
import type { PortalIntent } from "@/lib/stripe/portal";
import { startCustomerPortal } from "@/lib/stripe/portal-browser";
import { usePageshowReset } from "@/lib/ui/use-pageshow-reset";

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
export function PortalButton({
  cancelAtPeriodEnd = false,
  cancelAtLabel = "",
  effects,
  enabled,
  scheduledChange = null,
}: {
  /**
   * 期間末解約が予約済みか（T-M8-57）。予約済みのとき「解約する」を出し続けると、
   * もう予約されているのに同じ操作を促すことになる。**その場で取り消せるボタン**へ導線を替える
   * （T-M8-271。以前は Stripe の Portal トップを開いていた）。
   */
  cancelAtPeriodEnd?: boolean;
  /** 解約日の表記（確認ダイアログに出す）。例「2026年9月15日」。 */
  cancelAtLabel?: string;
  /** プラン変更・解約で何が起きるか（`planChangeEffects`）。契約前は不要。 */
  effects?: PlanChangeEffects;
  enabled: boolean;
  /**
   * 期間末で切り替わる下位プランの予約が付いているときの説明文（T-M8-260）。
   * Portal は予約付きの契約でも別プランへの変更を受け付ける（その場合は予約が置き換わる。
   * 2026-08-23 テストモードで実測）が、「今のプランのまま続ける」は Portal に無いので、
   * 取り消しボタンをアプリ側で「プランを変更」の隣に出す。
   */
  scheduledChange?: string | null;
}) {
  const [pending, setPending] = useState<PortalIntent | null>(null);
  // Stripeから「戻る」で復帰したとき押せる状態へ戻す（T-M8-212）。
  usePageshowReset(() => setPending(null));
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
        {scheduledChange ? <CancelScheduledPlanChangeButton description={scheduledChange} /> : null}
        <Button
          aria-busy={pending === "update"}
          className="h-9"
          disabled={pending !== null}
          onClick={open("update")}
          size="lg"
          type="button"
          variant={scheduledChange ? "outline" : "brand"}
        >
          {pending === "update" ? "開いています…" : "プランを変更"}
        </Button>
        {cancelAtPeriodEnd ? (
          <KeepSubscriptionButton endsAtLabel={cancelAtLabel} />
        ) : (
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
        )}
      </div>
      {/*
        **押す前に「いつから・いくら」を出す**（T-M8-55）。以前はここが1行で、
        上位プランへ変えると即時に日割り請求が走ることも、下位プランは期間末まで
        切り替わらないことも画面から読めなかった。金額と時期が変わる操作なので、
        Stripeへ移動する前に結果を示す（文言はStripe側の設定と1対1で対応する）。
      */}
      {/* 各項目1行に簡潔化（運営者の指示 2026-08-22・T-M8-207。「いつから・いくら」の要点だけ残す）。 */}
      {effects ? (
        <ul className="grid gap-1.5 rounded-card border border-hairline bg-page px-4 py-3 text-body leading-6" role="list">
          {(
            [
              ["上位プランへ変更", effects.upgrade],
              ["下位プランへ変更", effects.downgrade],
              ["解約", effects.cancel],
              ...(effects.trialNote ? [["トライアル中の変更", effects.trialNote] as const] : []),
            ] as const
          ).map(([label, effect]) => (
            <li key={label}>
              <span className="font-medium text-ink-2">{label}: </span>
              <span className="text-ink">{effect.headline}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
