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
 *
 * ## トグルとパネルを分ける（T-M8-226）
 *
 * 以前はボタンとパネルを1コンポーネントで返し、パネル（w-full）がカード右側の
 * ボタン群コンテナの内側で開いていた。そのためコンテナごと全幅へ膨らみ、
 * **「予約を変更」を押すとタイトル行とボタン行が折り返して崩れた**。開閉状態は
 * カード側が持ち、ボタンはボタン群の中・パネルはヘッダー行の下に**別の行**として置く。
 */

/**
 * `datetime-local` の値（秒なし）へ**日本時間で**変換する（T-M8-229）。
 * 入力の解釈も保存もJST基準（`checkDraftSchedule`）なので、表示だけを閲覧環境のTZに
 * するとブラウザのTZ次第で「入れた時刻と違う時刻」が見える。
 */
function toJstInputValue(iso: string | null): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const at = new Date(t + 9 * 3_600_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}T${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}`;
}

/**
 * 開いたときの初期値: 現在時刻＋5分（運営者の指示 2026-08-22。空欄から選ばせない）。
 * ちょうど今にすると「1分以上先」の判定（MIN_SCHEDULE_LEAD_MS）に触れて開いた瞬間から
 * エラーになるため、少し先へ丸める。
 */
function defaultScheduleValue(): string {
  return toJstInputValue(new Date(Date.now() + 5 * 60_000).toISOString());
}

/** 予約パネルの開閉ボタン。ラベルは「日時を指定して予約」→「予約を変更」→「閉じる」。 */
export function ScheduleDraftToggle({
  disabled,
  open,
  scheduledAt,
  onToggle,
}: {
  disabled: boolean;
  open: boolean;
  scheduledAt: string | null;
  onToggle: () => void;
}) {
  return (
    <Button disabled={disabled} onClick={onToggle} size="sm" type="button" variant="outline">
      {open ? "閉じる" : scheduledAt ? "予約を変更" : "日時を指定して予約"}
    </Button>
  );
}

/**
 * 予約日時の入力パネル。カードのヘッダー行の**下**に独立した行として置く。
 * 枠は内容に合わせた幅（w-fit）にする——全幅にすると右側に不釣り合いな空白が残り、
 * 入力欄を引き伸ばすと「投稿日時」に対して長すぎる（運営者の指示 2026-08-22）。
 */
export function ScheduleDraftPanel({
  disabled,
  draftId,
  scheduledAt,
  updatedAt,
  xAccountActive,
  onClose,
}: {
  disabled: boolean;
  draftId: string;
  scheduledAt: string | null;
  updatedAt: string;
  xAccountActive: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(() =>
    scheduledAt ? toJstInputValue(scheduledAt) : defaultScheduleValue(),
  );
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
        onClose();
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
        onClose();
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

  return (
    <div className="w-fit max-w-full rounded-card border border-hairline bg-page p-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="shrink-0">投稿日時（日本時間）</span>
          {/* 幅は入力内容（日時）なり。引き伸ばさない（運営者の指示 2026-08-22）。 */}
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
  );
}

/** 予約済みであることと日時を一覧で示すバッジ用の文言。 */
export function scheduledLabel(scheduledAt: string): string {
  return `予約 ${formatJst(scheduledAt)}`;
}
