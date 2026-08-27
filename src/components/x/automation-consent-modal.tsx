"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";
import { useState } from "react";

import { alertDialogBackdropClassName, alertDialogPopupClassName } from "@/components/ui/alert-dialog-classes";
import { Button } from "@/components/ui/button";
import { cardTitleClassName } from "@/components/ui/card";
import { CURRENT_AUTOMATION_CONSENT_VERSION, consentVersionLabel } from "@/lib/legal";

/*
  自動投稿の同意モーダル（要件06 §3.5）。**スケジュール画面と投稿作成画面で同じものを使う**
  （T-M8-331）。説明文と説明文versionは同意の記録内容そのものなので、画面ごとに書くと
  「どの説明に同意したか」が食い違う。
*/

/** 自動投稿の説明＋説明文version付き明示checkbox（要件06 §3.5）。同意までauto slotは保存できない。 */
export function AutomationConsentModal({
  open,
  onOpenChange,
  onConfirm,
  pending,
  accountHandle,
  settingSummary,
  firstRunLabel,
  confirmLabel = "同意して保存",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  pending: boolean;
  /** 対象アカウント（@handle）。どのアカウントの話かを明示するため。 */
  accountHandle: string | null;
  /** 「毎週 月・水 9:00 に「ニュース解説」を生成し…」の要約。 */
  settingSummary: string;
  /** 初回実行の日時表示。算出できないときは null。 */
  firstRunLabel: string | null;
  /** 決定ボタンの文言。既定は「同意して保存」（スケジュール保存）。 */
  confirmLabel?: string;
}) {
  const [agreed, setAgreed] = useState(false);
  return (
    <AlertDialog.Root onOpenChange={onOpenChange} open={open}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className={alertDialogBackdropClassName} />
        <AlertDialog.Popup className={alertDialogPopupClassName("lg")}>
          <AlertDialog.Title className={cardTitleClassName}>
            {accountHandle ? `@${accountHandle} の自動投稿を有効にします` : "自動投稿を有効にします"}
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-3 text-sm leading-6 text-muted-foreground">
            この設定: {settingSummary}
            {firstRunLabel ? `　最初の実行は ${firstRunLabel} です。` : ""}
          </AlertDialog.Description>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            この同意は
            {accountHandle ? `@${accountHandle}` : "このアカウント"}
            の自動投稿すべて（今後追加するスケジュールを含む）に適用されます。
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-6 text-muted-foreground">
            <li>生成された内容が、指定時刻に<span className="font-medium text-foreground">確認なしでXへ投稿</span>されます。</li>
            <li>スレッド途中で失敗した場合、作成済みのポストを自動削除します。<span className="font-medium text-foreground">削除したポストはX上で復元できません。</span></li>
            <li>投稿内容の責任は利用者本人が負います。</li>
            <li>停止は「自動投稿をすべて停止」またはスロットの停止でいつでも行えます。</li>
          </ul>
          <label className="mt-4 flex items-start gap-2 text-sm">
            <input
              checked={agreed}
              className="mt-0.5"
              onChange={(e) => setAgreed(e.target.checked)}
              type="checkbox"
            />
            <span>
              上記の説明（{consentVersionLabel(CURRENT_AUTOMATION_CONSENT_VERSION)}）を理解し、自動投稿に同意します。
            </span>
          </label>
          <div className="mt-6 flex justify-end gap-2">
            <AlertDialog.Close render={<Button size="lg" type="button" variant="outline" />}>
              キャンセル
            </AlertDialog.Close>
            <Button disabled={!agreed || pending} onClick={onConfirm} size="lg" type="button">
              {confirmLabel}
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
