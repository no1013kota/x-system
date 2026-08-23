"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";
import { useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import { cancelTrialNowAction, recordCancellationSurveyAction } from "@/app/actions/billing";
import { Button } from "@/components/ui/button";
import { cardTitleClassName } from "@/components/ui/card";
import {
  alertDialogBackdropClassName,
  alertDialogPopupClassName,
} from "@/components/ui/alert-dialog-classes";
import { useToast } from "@/components/ui/toast";
import { CANCELLATION_REASONS, type cancellationEffects } from "@/lib/billing/cancellation-reasons";
import { startCustomerPortal } from "@/lib/stripe/portal-browser";

/**
 * 解約の導線（T-M8-277・運営者の指示 2026-08-23）。**押したら即Stripeへ、にしない**。
 *
 * 1. 何が止まって何が残るのかを確認してもらう（煽らず事実だけ。引き止めのクーポン提示はStripe側）
 * 2. 解約理由を聞く（選択必須・自由記述は任意）——理由が分からないと何を直すべきか判断できない
 * 3. Stripeの解約画面へ送る（実際の解約はStripeが行う。そこで引き止めクーポンが出る）
 *
 * **アンケートで解約を止めない**。保存に失敗しても3へ進む（記録できないことより手続きを優先）。
 */
export function CancelSubscriptionButton({
  effects,
  trialing = false,
}: {
  effects: ReturnType<typeof cancellationEffects>;
  /**
   * 無料トライアル中か（T-M8-278）。トライアルは**その場で終了**させる（払っていない期間を
   * 「終了日まで使える」とするのは説明しにくい）。有料契約はStripeの期間末解約へ送る。
   */
  trialing?: boolean;
}) {
  const [step, setStep] = useState<"confirm" | "survey">("confirm");
  const [reason, setReason] = useState<string>("");
  const [detail, setDetail] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  function close() {
    // 次に開いたときは最初から（前回の入力を残さない）。
    setStep("confirm");
    setReason("");
    setDetail("");
  }

  function proceed() {
    startTransition(async () => {
      // 記録は待つが、失敗しても解約手続きは止めない（原則: 利用者の操作を人の都合で妨げない）。
      const saved = await recordCancellationSurveyAction({ reason, detail, proceeded: true });
      if (saved.status === "error") {
        toast.show({
          tone: "error",
          title: "ご意見を保存できませんでした",
          description: "解約の手続きはこのまま進められます。",
        });
      }
      if (trialing) {
        // トライアルはその場で終了させる（Stripeの画面へは送らない・T-M8-278）。
        const result = await cancelTrialNowAction();
        if (result.status === "error") {
          toast.show({ tone: "error", title: "解約できませんでした", description: result.message });
          return;
        }
        toast.show({ tone: "success", title: result.message });
        router.refresh();
        return;
      }
      try {
        await startCustomerPortal("cancel");
      } catch (cause) {
        toast.show({
          tone: "error",
          title: "解約画面を開けませんでした",
          description: cause instanceof Error ? cause.message : "時間をおいてもう一度お試しください。",
        });
      }
    });
  }

  return (
    <AlertDialog.Root onOpenChange={(open) => !open && close()}>
      <AlertDialog.Trigger
        render={<Button className="h-9" size="lg" type="button" variant="outline" />}
      >
        解約する
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className={alertDialogBackdropClassName} />
        <AlertDialog.Popup className={alertDialogPopupClassName("lg")}>
          {step === "confirm" ? (
            <>
              <AlertDialog.Title className={cardTitleClassName}>
                本当に解約しますか？
              </AlertDialog.Title>
              <AlertDialog.Description className="mt-3 text-sm leading-6 text-muted-foreground">
                {effects.title}
              </AlertDialog.Description>
              <div className="mt-4 space-y-4 text-sm leading-6">
                <div>
                  <p className="font-bold text-ink">止まること</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
                    {effects.stops.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="font-bold text-ink">残ること</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
                    {effects.keeps.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="mt-6 flex flex-wrap justify-end gap-2">
                <AlertDialog.Close render={<Button size="lg" type="button" variant="brand" />}>
                  やめておく
                </AlertDialog.Close>
                <Button onClick={() => setStep("survey")} size="lg" type="button" variant="outline">
                  解約に進む
                </Button>
              </div>
            </>
          ) : (
            <>
              <AlertDialog.Title className={cardTitleClassName}>
                差し支えなければ理由を教えてください
              </AlertDialog.Title>
              <AlertDialog.Description className="mt-3 text-sm leading-6 text-muted-foreground">
                今後の改善にのみ使います。回答しても解約の手続きは変わりません。
              </AlertDialog.Description>
              <fieldset className="mt-4">
                <legend className="text-sm font-bold text-ink">解約の理由（1つ選んでください）</legend>
                <div className="mt-2 space-y-1.5">
                  {CANCELLATION_REASONS.map((option) => (
                    <label className="flex items-center gap-2 text-sm leading-6" key={option.value}>
                      <input
                        checked={reason === option.value}
                        className="size-4"
                        name="cancellation-reason"
                        onChange={() => setReason(option.value)}
                        type="radio"
                        value={option.value}
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="mt-4 block text-sm font-bold text-ink">
                もう少し詳しく（任意）
                <textarea
                  className="mt-1.5 block w-full rounded-card border border-hairline bg-page px-3 py-2 text-sm font-normal leading-6 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  maxLength={1000}
                  onChange={(event) => setDetail(event.target.value)}
                  placeholder="どこが期待と違ったか、どうなれば戻ってきたいかなど"
                  rows={3}
                  value={detail}
                />
              </label>
              <div className="mt-6 flex flex-wrap justify-end gap-2">
                <Button onClick={() => setStep("confirm")} size="lg" type="button" variant="outline">
                  戻る
                </Button>
                <Button
                  aria-busy={pending}
                  disabled={!reason || pending}
                  onClick={proceed}
                  size="lg"
                  type="button"
                  variant="danger"
                >
                  {pending ? "処理しています…" : trialing ? "今すぐ解約する" : "解約手続きへ進む"}
                </Button>
              </div>
              {!reason ? (
                <p className="mt-2 text-right text-xs text-muted-foreground">
                  理由を1つ選ぶと次へ進めます
                </p>
              ) : null}
            </>
          )}
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
