"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  cancelDraftScheduleAction,
  scheduleDraftAction,
} from "@/app/actions/drafts";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  DRAFT_SCHEDULE_REASONS,
  checkDraftSchedule,
} from "@/lib/draft-schedule";
import { formatJst } from "@/lib/format";

/**
 * 下書きの投稿予約（T-M8-157）。
 *
 * **押す前に理由が分かる形にする**（原則2）。過去日時・直近すぎる日時・遠すぎる日時は
 * 送信前に同じ判定（`checkDraftSchedule`）で弾き、理由を画面へ出す。Server Action側も
 * 受理直前に同じ判定を通すので、画面をすり抜けても投稿されない。
 */

/** `datetime-local` の値（ローカル時刻・秒なし）へ変換する。 */
function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/**
 * 開いたときの初期値: 現在時刻＋5分（運営者の指示 2026-08-22。空欄から選ばせない）。
 * ちょうど今にすると「1分以上先」の判定（MIN_SCHEDULE_LEAD_MS）に触れて開いた瞬間から
 * エラーになるため、少し先へ丸める。
 */
function defaultScheduleValue(): string {
  return toLocalInputValue(new Date(Date.now() + 5 * 60_000).toISOString());
}

export function ScheduleDraftControl({
  disabled,
  draftId,
  scheduledAt,
  updatedAt,
  xAccountActive,
}: {
  disabled: boolean;
  draftId: string;
  scheduledAt: string | null;
  updatedAt: string;
  xAccountActive: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(() => toLocalInputValue(scheduledAt));
  const [reason, setReason] = useState<string | null>(null);
  const busy = pending || disabled;

  /**
   * 入力のたびに判定して理由を出す（送信して初めて分かる形にしない）。
   * **render中に `Date.now()` を読まない**——描画のたびに結果が変わる純粋でない計算になるため
   * （`react-hooks/purity`）。判定は入力イベントの中で行う。
   */
  function updateValue(next: string) {
    setValue(next);
    if (!next) {
      setReason(null);
      return;
    }
    const check = checkDraftSchedule(
      { status: "draft", xAccountActive },
      next,
      Date.now(),
    );
    setReason(check.ok ? null : DRAFT_SCHEDULE_REASONS[check.reason!]);
  }

  function save() {
    startTransition(async () => {
      const res = await scheduleDraftAction({
        draft_id: draftId,
        expected_updated_at: updatedAt,
        scheduled_at: value,
      });
      if (res.status === "success") {
        toast.show({ title: "投稿を予約しました", tone: "success" });
        setOpen(false);
        router.refresh();
      } else {
        toast.show({
          description: res.message,
          title: "予約できませんでした",
          tone: "error",
        });
      }
    });
  }

  function cancel() {
    startTransition(async () => {
      const res = await cancelDraftScheduleAction({
        draft_id: draftId,
        expected_updated_at: updatedAt,
      });
      if (res.status === "success") {
        toast.show({ title: "予約を解除しました", tone: "success" });
        setOpen(false);
        setValue("");
        setReason(null);
        router.refresh();
      } else {
        toast.show({
          description: res.message,
          title: "解除できませんでした",
          tone: "error",
        });
      }
    });
  }

  /*
   * 入力枠は**ボタンの下の独立した行**に出す（運営者の指示 2026-08-22・T-M8-218）。
   * 以前はボタンを置き換えてアクション行の中に展開しており、エラーメッセージの出入りや
   * カレンダー操作のたびにflex-wrapの折り返しが変わって**入力欄の位置が飛ぶ**不具合が
   * 起きていた。w-fullの下段パネルなら他ボタンの並びが崩れず、位置も固定される。
   */
  return (
    <>
      <Button
        disabled={busy}
        onClick={() => {
          if (open) {
            setOpen(false);
            setValue(toLocalInputValue(scheduledAt));
            setReason(null);
          } else {
            setOpen(true);
            // 既存の予約が無ければ現在時刻（＋5分）を初期値にする。
            if (!scheduledAt) updateValue(defaultScheduleValue());
          }
        }}
        size="sm"
        type="button"
        variant="outline"
      >
        {open ? "閉じる" : scheduledAt ? "予約を変更" : "日時を指定して予約"}
      </Button>
      {open ? (
        <div className="order-last w-full rounded-card border border-hairline bg-page p-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>投稿日時</span>
              <input
                aria-label="投稿日時"
                className="min-h-9 rounded-card border border-hairline bg-surface px-2 text-base text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                disabled={busy}
                onChange={(event) => updateValue(event.target.value)}
                type="datetime-local"
                value={value}
              />
            </label>
            <Button
              disabled={busy || !value || Boolean(reason)}
              onClick={save}
              size="sm"
              type="button"
            >
              {pending ? "保存中…" : "予約する"}
            </Button>
            {scheduledAt ? (
              <Button disabled={busy} onClick={cancel} size="sm" type="button" variant="outline">
                予約を解除
              </Button>
            ) : null}
          </div>
          {/* 理由は入力の下の固定行に出す（出入りで他要素の位置を動かさない）。 */}
          {reason ? (
            <p className="mt-1.5 text-xs text-danger-fg" role="alert">
              {reason}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/** 予約済みであることと日時を一覧で示すバッジ用の文言。 */
export function scheduledLabel(scheduledAt: string): string {
  return `予約 ${formatJst(scheduledAt)}`;
}
