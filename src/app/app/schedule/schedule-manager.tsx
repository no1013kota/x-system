"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  createScheduleSlotAction,
  deleteScheduleSlotAction,
  disableScheduleSlotAction,
  disableXAutomationAction,
  enableScheduleSlotAction,
  recordXAutomationConsentAction,
  updateScheduleSlotAction,
} from "@/app/actions/schedule";
import { EmptyNotice } from "@/components/app-shell/page-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { useToast } from "@/components/ui/toast";
import { CURRENT_AUTOMATION_CONSENT_VERSION, consentVersionLabel } from "@/lib/legal";
import { nextScheduleRun, type NextRun } from "@/lib/schedule/next-run";
import type { ScheduleSlotView } from "@/lib/schedule-slots";
import { PatternRadioGroup } from "@/components/post/pattern-radio-group";
import {
  NEW_PATTERN_PROMPT_TEMPLATE,
  type PatternOption,
  type PatternPromptView,
} from "@/lib/post/post-patterns-store";
import {
  PatternFields,
  actionReason,
  emptyPatternDraft,
  patternReasonMessage,
  toPatternPayload,
  type PatternDraft,
} from "@/components/post/pattern-fields";
import { PromptBlock } from "@/components/post/prompt-block";
import {
  createPatternAction,
  updatePatternPromptAction,
} from "@/app/actions/post-patterns";

/** プロンプトの上限（投稿作成・AI設定と同値・T-M8-92）。 */
const PROMPT_MAX_CHARS = 8000;
import { selectablePostThemeOptions, postThemeLabel } from "@/lib/post/post-theme";
import { CardTitle, cardClassName, cardTitleClassName } from "@/components/ui/card";
import { validateSlotForm } from "@/lib/schedule/slot-form";
import {
  patternLabel,
  slotDescription,
  slotScheduleLabel,
  WEEKDAY_LABELS,
} from "@/lib/schedule/slot-labels";
import {
  alertDialogBackdropClassName,
  alertDialogPopupClassName,
} from "@/components/ui/alert-dialog-classes";

/**
 * SC-08 スケジュール管理UI（要件06 §2, T-M4-04）。週間プレビュー＋スロットCRUD。Server Action経由で
 * 反映（作成/編集/停止/削除）。編集競合（job_conflict）は最新値の再読込を促す。P-5はスケジュール
 * 対象外のためパターン選択肢に出さない。mode=autoの同意modalは別タスク（本タスクはサーバー拒否の表示まで）。
 */

// 選択肢はサーバーが `post_patterns` から引いて渡す（T-M8-129 U3。引用URLが必須の
// パターンは予約に使えないので、その時点で除いてある）。**この画面はラベルを持たない**——
// 以前は短縮版を別に持っていて、投稿作成側と表記が違っていた（T-M8-29）。

/**
 * 週間プレビューのセルの見た目（T-M8-24）。
 *
 * **凡例と本体が同じ関数を使う**ようにする。以前は同じクラス文字列を2か所に書いていて、
 * 配色をまとめて直したとき凡例だけ取り残され、3種類が同じ見た目＝凡例が意味を失っていた。
 * 色だけに頼らないため、停止中は取り消し線も併せて付ける（要件06 §2 SC-08）。
 *
 * セルに出すのは**パターン名**（T-M8-28）。当初は `P1` のようなIDを出していたが、
 * 利用者から「P1・P3・P6 とはどういう意味か」と聞かれた。**画面の中に答えが無い表記は使わない。**
 * T-M8-129 以降は利用者が作ったパターンにIDが無いため、名前が唯一の表記になった。
 */
function slotCellClassName(slot: { enabled: boolean; mode: string }): string {
  // 名前は最大30字取れるので幅を抑えて省略する。全文は `title` と `aria-label` で読める
  // （7列の表が横に伸びて崩れないようにする・T-M8-129 U3b）。
  const base =
    "inline-block max-w-[6.5rem] truncate rounded-chip px-1.5 py-0.5 text-caption font-bold leading-4 align-middle";
  if (!slot.enabled) return `${base} bg-black/[0.04] text-ink-3 line-through`;
  return slot.mode === "auto"
    ? `${base} bg-brand text-white`
    : `${base} bg-brand-subtle text-brand`;
}

// 括弧の説明は付けない。「確認なしでXへ」はステータス行・同意モーダルでも言っており、
// 同じ説明の3〜4回目の繰り返しになっていた（T-M8-66）。
const SLOT_CELL_LEGEND = [
  { enabled: true, mode: "auto", label: "自動投稿" },
  { enabled: true, mode: "draft", label: "下書きのみ" },
  { enabled: false, mode: "draft", label: "停止中" },
];

const TIME_OPTIONS: string[] = (() => {
  const out: string[] = [];
  for (let h = 9; h <= 22; h++) {
    out.push(`${String(h).padStart(2, "0")}:00`);
    if (h < 22) out.push(`${String(h).padStart(2, "0")}:30`);
  }
  return out;
})();

interface SlotFormValues {
  /** `post_patterns.id`（uuid）。**内部IDでは持たない**（T-M8-129 U3）。 */
  pattern_id: string;
  weekdays: number[];
  time_jst: string;
  mode: "draft" | "auto";
  /** 分野（発信テーマ）。空文字は「指定なし」＝AIが発信テーマから選ぶ（T-M8-28）。 */
  theme: string;
  instructions: string;
  image_enabled: boolean;
  /** この枠の参考URL（T-M8-135）。投稿作成の「参考にするURL」と同じもの。 */
  source_url: string;
  /** プレースホルダー名 → 値（T-M8-135）。 */
  placeholder_values: Record<string, string>;
  /** この枠だけのプロンプト。null = パターンのものをそのまま使う（T-M8-135）。 */
  prompt_override: string | null;
}

function toFormValues(slot: ScheduleSlotView): SlotFormValues {
  return {
    pattern_id: slot.pattern_id ?? "",
    weekdays: [...slot.weekdays].sort((a, b) => a - b),
    time_jst: slot.time_jst.slice(0, 5),
    mode: slot.mode === "auto" ? "auto" : "draft",
    theme: slot.theme ?? "",
    instructions: slot.instructions ?? "",
    image_enabled: slot.image_enabled,
    source_url: slot.source_url ?? "",
    placeholder_values: { ...slot.placeholder_values },
    prompt_override: slot.prompt_override,
  };
}

export function ScheduleManager({
  slots,
  patterns,
  patternPrompts,
  imageProviders,
  automationConsented,
  xAccountId,
  accountHandle,
}: {
  slots: ScheduleSlotView[];
  /** 予約に使えるパターン（引用URLが必須のものは含まない・T-M8-129 U3）。 */
  patterns: PatternOption[];
  /**
   * 生成に使うプロンプト（パターンID → 本文）。**null = standard**（mdプラン以上の機能）。
   * null のときはセクションごと出さない（編集できない欄を見せない・T-M8-135）。
   */
  patternPrompts: Record<string, PatternPromptView> | null;
  imageProviders: string[];
  automationConsented: boolean;
  xAccountId: string;
  /** 同意modalで対象を明示するためのアカウント名（@なし）。 */
  accountHandle: string | null;
}) {
  const [creating, setCreating] = useState(false);
  const hasAutoSlots = slots.some((s) => s.mode === "auto" && s.enabled);
  const activeSlots = slots.filter((s) => s.enabled);
  // 有効スロットのうち最も近い次回実行（「次にいつ何が投稿されるか」を先頭に出す）。
  const upcoming = activeSlots
    .map((slot) => ({ slot, run: nextScheduleRun(slot) }))
    .filter((entry): entry is { slot: ScheduleSlotView; run: NextRun } => entry.run !== null)
    .sort((a, b) => a.run.at.getTime() - b.run.at.getTime())[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 text-sm">
          {/* 同意状態を基準に「いま自動投稿が有効か」を常時示す（要件06 §3.5）。 */}
          <p className="font-medium">
            自動投稿:{" "}
            {automationConsented
              ? hasAutoSlots
                ? "有効 — 指定時刻に確認なしでXへ投稿されます"
                : "同意済み（自動投稿のスケジュールはありません）"
              : "未設定（下書き作成のみ）"}
          </p>
          {upcoming ? (
            // 「確認なしで」等の説明は上のステータス行が担う。ここは事実だけ（T-M8-66）。
            <p className="text-muted-foreground">
              次回の実行: {upcoming.run.label} —「
              {patternLabel(upcoming.slot.pattern_name)}」
              {upcoming.slot.mode === "auto" ? "を自動投稿します" : "の下書きを作成します"}
            </p>
          ) : (
            <p className="text-muted-foreground">有効なスケジュールはありません。</p>
          )}
        </div>
        {automationConsented ? <StopAllAutomationButton xAccountId={xAccountId} /> : null}
      </div>

      <WeekPreview slots={slots} />

      <div className="flex justify-end">
        {!creating ? (
          <Button className="h-9 px-4 text-body" onClick={() => setCreating(true)} type="button" variant="brand">
            スケジュールを追加
          </Button>
        ) : null}
      </div>

      {creating ? (
        <div className={`${cardClassName} p-4`}>
          <CardTitle>新しいスケジュール</CardTitle>
          <SlotFields
            accountHandle={accountHandle}
            automationConsented={automationConsented}
            imageProviders={imageProviders}
            onCancel={() => setCreating(false)}
            onSubmitDone={() => setCreating(false)}
            patternPrompts={patternPrompts}
            patterns={patterns}
            submitLabel="作成"
            target={{ kind: "create" }}
            xAccountId={xAccountId}
          />
        </div>
      ) : null}

      <SlotList
        accountHandle={accountHandle}
        automationConsented={automationConsented}
        imageProviders={imageProviders}
        patternPrompts={patternPrompts}
        patterns={patterns}
        slots={slots}
        xAccountId={xAccountId}
      />
    </div>
  );
}

/** SC-08/SC-11 共通の「自動投稿をすべて停止」（要件06 §3.5・§7）。opt-out即時反映＋無効化件数表示。 */
export function StopAllAutomationButton({ xAccountId }: { xAccountId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  function stopAll() {
    startTransition(async () => {
      const res = await disableXAutomationAction({ x_account_id: xAccountId });
      if (res.status === "success") {
        toast.show({
          tone: "success",
          title: "自動投稿を停止しました",
          description: `${res.result?.disabledSlots ?? 0}件のスケジュールを無効にしました。`,
        });
        router.refresh();
      } else {
        // **失敗も緑色の `role="status"` で出ていた**（T-M8-17）。同じstateに成功と失敗を
        // 入れていたため色と読み上げが成功のままだった。トーストは種別を分けて持つ。
        toast.show({ tone: "error", title: "自動投稿を停止できませんでした", description: res.message });
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <AlertDialog.Root>
        <AlertDialog.Trigger
          render={<Button disabled={pending} size="sm" type="button" variant="outline" />}
        >
          自動投稿をすべて停止
        </AlertDialog.Trigger>
        <AlertDialog.Portal>
          <AlertDialog.Backdrop className={alertDialogBackdropClassName} />
          <AlertDialog.Popup className={alertDialogPopupClassName()}>
            <AlertDialog.Title className={cardTitleClassName}>
              自動投稿をすべて停止しますか？
            </AlertDialog.Title>
            {/* 「スロット」「ジョブ」は内部用語。画面には出さない（T-M8-66・要件06 §8と同方針）。 */}
            <AlertDialog.Description className="mt-3 text-sm leading-6 text-muted-foreground">
              このアカウントの自動投稿をすべて停止します。下書きの作成と手動での投稿はそのまま使えます。
            </AlertDialog.Description>
            <div className="mt-6 flex justify-end gap-2">
              <AlertDialog.Close render={<Button size="lg" type="button" variant="outline" />}>
                キャンセル
              </AlertDialog.Close>
              <AlertDialog.Close onClick={stopAll} render={<Button size="lg" type="button" />}>
                すべて停止
              </AlertDialog.Close>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
  );
}

/** スケジュール削除の確認（要件06 §1 SC-08）。停止との違いを説明し、誤操作で設定を失わせない。 */
function DeleteSlotButton({
  description,
  disabled,
  onConfirm,
}: {
  description: string;
  disabled: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger
        render={<Button disabled={disabled} size="sm" type="button" variant="destructive" />}
      >
        削除
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className={alertDialogBackdropClassName} />
        <AlertDialog.Popup className={alertDialogPopupClassName()}>
          <AlertDialog.Title className={cardTitleClassName}>
            このスケジュールを削除しますか？
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-3 text-sm leading-6 text-muted-foreground">
            {description}
          </AlertDialog.Description>
          <div className="mt-6 flex justify-end gap-2">
            <AlertDialog.Close render={<Button size="lg" type="button" variant="outline" />}>
              キャンセル
            </AlertDialog.Close>
            <AlertDialog.Close
              onClick={onConfirm}
              render={<Button size="lg" type="button" variant="danger" />}
            >
              削除する
            </AlertDialog.Close>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

function WeekPreview({ slots }: { slots: ScheduleSlotView[] }) {
  const times = [...new Set(slots.map((s) => s.time_jst.slice(0, 5)))].sort();
  if (slots.length === 0) {
    return (
      <EmptyNotice>
        スケジュールはまだありません。「スケジュールを追加」から作成してください。
      </EmptyNotice>
    );
  }
  return (
    <div className={`${cardClassName} overflow-x-auto p-4`}>
      <table className="w-full min-w-[760px] border-collapse text-center text-xs">
        <thead>
          <tr>
            <th className="p-2 text-muted-foreground">時刻</th>
            {WEEKDAY_LABELS.map((w) => (
              <th className="p-2 font-medium" key={w}>
                {w}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {times.map((t) => (
            <tr className="border-t" key={t}>
              <td className="p-2 text-muted-foreground">{t}</td>
              {WEEKDAY_LABELS.map((_, day) => {
                const cell = slots.filter(
                  (s) => s.time_jst.slice(0, 5) === t && s.weekdays.includes(day),
                );
                return (
                  <td className="p-1" key={day}>
                    {cell.map((s) => (
                      <span
                        className={`m-0.5 ${slotCellClassName(s)}`}
                        aria-label={slotDescription(s)}
                        data-slot-cell=""
                        key={s.id}
                        title={slotDescription(s)}
                      >
                        {patternLabel(s.pattern_name)}
                      </span>
                    ))}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {/*
        色だけで意味を伝えないための凡例（要件06 §2 SC-08）。
        **見本のクラスはセルと同じ関数から取る。** 別々に書いていたため、配色をまとめて直したとき
        凡例だけ取り残されて3種類が同じ見た目になり、凡例が意味を失っていた（T-M8-24）。
      */}
      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {SLOT_CELL_LEGEND.map((item) => (
          <span key={item.label}>
            <span className={`mr-1 inline-block ${slotCellClassName(item)}`}>例</span>
            {item.label}
          </span>
        ))}
      </p>
    </div>
  );
}

function SlotList({
  slots,
  patterns,
  patternPrompts,
  imageProviders,
  automationConsented,
  xAccountId,
  accountHandle,
}: {
  slots: ScheduleSlotView[];
  patterns: PatternOption[];
  /**
   * 生成に使うプロンプト（パターンID → 本文）。**null = standard**（mdプラン以上の機能）。
   * null のときはセクションごと出さない（編集できない欄を見せない・T-M8-135）。
   */
  patternPrompts: Record<string, PatternPromptView> | null;
  imageProviders: string[];
  automationConsented: boolean;
  xAccountId: string;
  accountHandle: string | null;
}) {
  if (slots.length === 0) return null;
  return (
    <ul className="space-y-3">
      {slots.map((slot) => (
      <SlotRow
          accountHandle={accountHandle}
          automationConsented={automationConsented}
          imageProviders={imageProviders}
          key={slot.id}
          patternPrompts={patternPrompts}
          patterns={patterns}
          slot={slot}
          xAccountId={xAccountId}
        />
      ))}
    </ul>
  );
}

function SlotRow({
  slot,
  patterns,
  patternPrompts,
  imageProviders,
  automationConsented,
  xAccountId,
  accountHandle,
}: {
  slot: ScheduleSlotView;
  patterns: PatternOption[];
  /**
   * 生成に使うプロンプト（パターンID → 本文）。**null = standard**（mdプラン以上の機能）。
   * null のときはセクションごと出さない（編集できない欄を見せない・T-M8-135）。
   */
  patternPrompts: Record<string, PatternPromptView> | null;
  imageProviders: string[];
  automationConsented: boolean;
  xAccountId: string;
  accountHandle: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const toast = useToast();
  const nextRun = nextScheduleRun(slot);

  function run(
    action: () => Promise<{ status: string; code?: string; message: string }>,
    successTitle: string,
  ) {
    startTransition(async () => {
      const res = await action();
      if (res.status === "success") {
        // これまで成功は無言で、トグルの見た目以外に手応えが無かった（T-M8-17）。
        toast.show({ tone: "success", title: successTitle });
        router.refresh();
        return;
      }
      toast.show({
        tone: "error",
        title: "スケジュールを更新できませんでした",
        description:
          res.code === "job_conflict"
            ? "他の場所で更新されました。画面を再読み込みしてください。"
            : res.message,
      });
    });
  }

  return (
    <li className={`${cardClassName} p-4`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold">{patternLabel(slot.pattern_name)}</span>
          <Badge tone="neutral">{slot.mode === "auto" ? "自動投稿" : "下書き"}</Badge>
          {/* テーマを行に出す（T-M8-28）。編集画面を開かないと分からない状態にしない。 */}
          {slot.theme && slot.theme !== "other" ? (
            <Badge tone="brand">{postThemeLabel(slot.theme)}</Badge>
          ) : null}
          <span className="text-xs text-muted-foreground">
            {slotScheduleLabel(slot.weekdays, slot.time_jst)}
          </span>
          {!slot.enabled ? (
            <Badge tone="warn">停止中（実行されません）</Badge>
          ) : null}
          {/* 「次にいつ動くか」を行ごとに出す（要件06 §2 SC-08）。 */}
          <span className="text-xs text-muted-foreground">
            {slot.enabled
              ? nextRun
                ? `次回 ${nextRun.label}`
                : "次回の予定を計算できません"
              : "停止中のため次回はありません"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!editing ? (
            <Button disabled={pending} onClick={() => setEditing(true)} size="sm" type="button" variant="outline">
              編集
            </Button>
          ) : null}
          {slot.enabled ? (
            <Button
              disabled={pending}
              onClick={() =>
                run(
                  () =>
                    disableScheduleSlotAction({ slot_id: slot.id, expected_updated_at: slot.updated_at }),
                  "スケジュールを停止しました",
                )
              }
              size="sm"
              type="button"
              variant="outline"
            >
              停止
            </Button>
          ) : (
            // 停止したまま削除しか残らない行き止まりを避ける（autoは中核側で同意を再確認）。
            <Button
              disabled={pending}
              onClick={() =>
                run(
                  () =>
                    enableScheduleSlotAction({ slot_id: slot.id, expected_updated_at: slot.updated_at }),
                  "スケジュールを再開しました",
                )
              }
              size="sm"
              type="button"
            >
              再開
            </Button>
          )}
          <DeleteSlotButton
            description={`${slotScheduleLabel(slot.weekdays, slot.time_jst)} の「${patternLabel(slot.pattern_name)}」を削除します。一時的に止めたいだけなら「停止」を使ってください。`}
            disabled={pending}
            onConfirm={() =>
              run(
                () =>
                  deleteScheduleSlotAction({ slot_id: slot.id, expected_updated_at: slot.updated_at }),
                "スケジュールを削除しました",
              )
            }
          />
        </div>
      </div>

      {editing ? (
        <div className="mt-4 border-t pt-4">
          <SlotFields
            accountHandle={accountHandle}
            automationConsented={automationConsented}
            imageProviders={imageProviders}
            initial={toFormValues(slot)}
            patternPrompts={patternPrompts}
            patterns={patterns}
            onCancel={() => setEditing(false)}
            onSubmitDone={() => setEditing(false)}
            submitLabel="保存"
            target={{ kind: "edit", slotId: slot.id, expectedUpdatedAt: slot.updated_at }}
            xAccountId={xAccountId}
          />
        </div>
      ) : null}
    </li>
  );
}

type SlotTarget = { kind: "create" } | { kind: "edit"; slotId: string; expectedUpdatedAt: string };

function SlotFields({
  target,
  initial,
  patternPrompts,
  imageProviders,
  automationConsented,
  xAccountId,
  accountHandle,
  patterns,
  submitLabel,
  onSubmitDone,
  onCancel,
}: {
  target: SlotTarget;
  initial?: SlotFormValues;
  patterns: PatternOption[];
  /**
   * 生成に使うプロンプト（パターンID → 本文）。**null = standard**（mdプラン以上の機能）。
   * null のときはセクションごと出さない（編集できない欄を見せない・T-M8-135）。
   */
  patternPrompts: Record<string, PatternPromptView> | null;
  imageProviders: string[];
  automationConsented: boolean;
  xAccountId: string;
  accountHandle: string | null;
  submitLabel: string;
  onSubmitDone: () => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [v, setV] = useState<SlotFormValues>(
  initial ?? {
      // 既定は一覧の先頭（並び順の1件目）。既定パターンはトリガで必ず投入されている。
      pattern_id: patterns[0]?.id ?? "",
      weekdays: [],
      time_jst: "09:00",
      mode: "draft",
      theme: "",
      instructions: "",
      image_enabled: false,
      source_url: "",
      placeholder_values: {},
      prompt_override: null,
    },
  );
  // 入力検証はその場に残し、操作の結果だけをトーストへ出す（T-M8-17）。
  // 同じstateに混ぜると、検証エラーまで5秒で消えて何を直せばよいか分からなくなる。
  const [validationError, setValidationError] = useState<string | null>(null);
  const toast = useToast();
  const slotFieldPrefix = `slot-${target.kind === "edit" ? target.slotId : "new"}`;
  const themeFieldId = `${slotFieldPrefix}-theme`;
  // 同意済み（サーバー判定）＋本フォームで同意した分。auto保存の前提。
  const [consented, setConsented] = useState(automationConsented);
  const [showConsent, setShowConsent] = useState(false);

  /*
    パターンの追加と生成プロンプトの編集（T-M8-135・運営者の指示 2026-08-18）。
    投稿作成画面と同じ操作をここでもできるようにする——予約を組むときに
    「この型が無い」「この指示を直したい」と気付くのはこの画面なので、
    設定画面へ往復させると目的（予約を作る）が中断する。
  */
  const [options, setOptions] = useState(patterns);
  const [prompts, setPrompts] = useState(patternPrompts);
  const [newPattern, setNewPattern] = useState<PatternDraft | null>(null);
  const [newPatternError, setNewPatternError] = useState<string | null>(null);
  /** 編集中のプロンプト本文（null = 未編集）。パターンを切り替えたら破棄する。 */
  const [promptDraft, setPromptDraft] = useState<string | null>(null);
  /** once = この予約にだけ保存 ／ save = パターン自体を書き換える。 */
  const [promptApply, setPromptApply] = useState<"once" | "save">("once");

  const selectedPattern = options.find((o) => o.id === v.pattern_id) ?? null;
  const patternPrompt = prompts?.[v.pattern_id] ?? null;
  /**
   * 表示する本文の優先順位: 編集中 → この枠の保存済み上書き → パターンの本文。
   * **枠の上書きを先に見せる**。ここでパターン本体を見せると、
   * 保存済みの上書きに気付かないまま上書きを消してしまう。
   */
  const promptValue = promptDraft ?? v.prompt_override ?? patternPrompt?.content ?? "";
  const promptBase = v.prompt_override ?? patternPrompt?.content ?? "";
  const promptEdited = promptDraft !== null && promptDraft !== promptBase;

  /** パターンを切り替えたら、前のパターン向けの編集と入力値を持ち越さない。 */
  function selectPattern(id: string) {
    setV((cur) => ({ ...cur, pattern_id: id, placeholder_values: {}, prompt_override: null }));
    setPromptDraft(null);
    setPromptApply("once");
  }

  function addPattern() {
    if (!newPattern) return;
    setNewPatternError(null);
    startTransition(async () => {
      const res = await createPatternAction({
        x_account_id: xAccountId,
        ...toPatternPayload(newPattern, null),
      });
      if (res.status !== "success" || !res.pattern) {
        setNewPatternError(patternReasonMessage(actionReason(res), res.message));
        return;
      }
      const created = res.pattern;
      setOptions((cur) => [...cur, created]);
      // 追加直後から編集できるよう、本文も手元へ入れる（一覧を取り直さない・T-M8-68）。
      setPrompts((cur) =>
        cur === null
          ? cur
          : {
              ...cur,
              // **`updatedAt` は作成時の実値を使う**（T-M8-135）。null にすると
              // 直後の「パターンに保存」が `prompt is null` 条件に当たって必ず衝突する。
              [created.id]: {
                content: newPattern.prompt,
                isOverride: true,
                updatedAt: created.promptUpdatedAt,
              },
            },
      );
      setNewPattern(null);
      selectPattern(created.id);
      toast.show({ tone: "success", title: "パターンを追加しました" });
    });
  }

  const toggleWeekday = (d: number) =>
    setV((cur) => ({
      ...cur,
      weekdays: cur.weekdays.includes(d)
        ? cur.weekdays.filter((x) => x !== d)
        : [...cur.weekdays, d].sort((a, b) => a - b),
    }));

  function doSubmit() {
    startTransition(async () => {
      /*
        プロンプトを編集していたら、先に行き先を決める（T-M8-135）。
        「パターンに保存」はここで書き戻し、枠の上書きは外す——両方に残すと
        次に開いたとき**どちらが効いているのか画面から分からなくなる**。
      */
      let promptOverride = v.prompt_override;
      if (promptEdited && promptDraft !== null) {
        if (promptApply === "save") {
          // キー名は `content`（`updatePromptSchema`）。Actionの引数は `unknown` なので
          // 名前を間違えても型検査では気付けない——検証エラーで必ず失敗する。
          const res = await updatePatternPromptAction({
            pattern_id: v.pattern_id,
            content: promptDraft,
            expected_updated_at: patternPrompt?.updatedAt ?? null,
          });
          if (res.status !== "success") {
            toast.show({
              tone: "error",
              title: "プロンプトを保存できませんでした",
              description: patternReasonMessage(actionReason(res), res.message),
            });
            return;
          }
          setPrompts((cur) =>
            cur === null
              ? cur
              : { ...cur, [v.pattern_id]: res.prompt ?? { content: promptDraft, isOverride: true, updatedAt: null } },
          );
          promptOverride = null;
        } else {
          promptOverride = promptDraft;
        }
      }
    const payload = {
        pattern_id: v.pattern_id,
        weekdays: v.weekdays,
        time_jst: v.time_jst,
        mode: v.mode,
        theme: v.theme,
        instructions: v.instructions.trim() || undefined,
        image_enabled: v.image_enabled,
        source_url: v.source_url.trim() || null,
        placeholder_values: v.placeholder_values,
        prompt_override: promptOverride,
      };
      const res =
        target.kind === "create"
          ? await createScheduleSlotAction(payload)
          : await updateScheduleSlotAction({
              ...payload,
              slot_id: target.slotId,
              expected_updated_at: target.expectedUpdatedAt,
            });
      if (res.status === "success") {
        toast.show({
          tone: "success",
          title: target.kind === "create" ? "スケジュールを追加しました" : "スケジュールを保存しました",
        });
        router.refresh();
        onSubmitDone();
        return;
      }
      toast.show({
        tone: "error",
        title: "スケジュールを保存できませんでした",
        description:
          res.code === "job_conflict"
            ? "他の場所で更新されました。画面を再読み込みしてください。"
            : res.code === "automation_consent_required"
              ? "自動投稿を有効にするには、現在の説明への同意が必要です。"
              : res.message,
      });
    });
  }

  function submit() {
    // 判定は純関数（`lib/schedule/slot-form.ts`）。画面の状態更新だけここに残す（R38）。
    const verdict = validateSlotForm(v, { consented });
    setValidationError(verdict.error);
    if (verdict.error) return;
    if (verdict.needsConsent) {
      setShowConsent(true);
      return;
    }
    doSubmit();
  }

  // 同意modalの「同意して続行」→ 同意記録に成功したらそのまま保存する。
  function confirmConsentAndSubmit() {
    startTransition(async () => {
      const res = await recordXAutomationConsentAction({
        x_account_id: xAccountId,
        consent_version: CURRENT_AUTOMATION_CONSENT_VERSION,
        confirmed: true,
      });
      if (res.status !== "success") {
        toast.show({ tone: "error", title: "同意を記録できませんでした", description: res.message });
        return;
      }
      setConsented(true);
      setShowConsent(false);
      doSubmit();
    });
  }

  return (
    <div className="space-y-4 text-sm">
      {/*
        並び順は運営者の指示（2026-08-18）: テーマ → パターン → パターンを追加 →
        生成に使うプロンプト → 参考URL → プレースホルダー → 追加指示 → 曜日 → 時刻 → モード。
        **「何を作るか」を上から順に決めてから、「いつ出すか」を決める**流れにする。
      */}
      <div className="max-w-xs">
        <label className="block font-medium" htmlFor={themeFieldId}>
          テーマ
        </label>
        <select
          aria-describedby={`${themeFieldId}-help`}
          className="mt-1 h-9 w-full rounded-card border border-hairline bg-surface px-2 text-body"
          id={themeFieldId}
          onChange={(e) => setV((cur) => ({ ...cur, theme: e.target.value }))}
          required
          value={v.theme}
        >
          <option value="">選択してください</option>
          {/* 選択肢は最新ニュース画面と同じ運用テーマ＋その他（T-M8-100）。既存枠の旧値は保全される。 */}
          {selectablePostThemeOptions(v.theme).map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-muted-foreground" id={`${themeFieldId}-help`}>
          テーマを決めずにAIに任せるときは「その他」を選んでください。
        </p>
      </div>


      {/* 投稿作成と同じ部品（T-M8-29）。削除は出さない（編集中の枠の足元が崩れる・T-M8-134）。 */}
      <PatternRadioGroup
        name={`pattern-${target.kind === "edit" ? target.slotId : "new"}`}
        onChange={selectPattern}
        options={options}
        value={v.pattern_id}
      />

      {/* パターンの追加（T-M8-135）。投稿作成と同じ入力欄を使う。 */}
      {prompts ? (
        newPattern ? (
          <div className={`${cardClassName} p-4`}>
            <CardTitle>新しいパターン</CardTitle>
            {newPatternError ? <Notice tone="danger">{newPatternError}</Notice> : null}
            <PatternFields
              draft={newPattern}
              idPrefix={`slot-new-pattern-${target.kind === "edit" ? target.slotId : "new"}`}
              onChange={(next) => setNewPattern((cur) => (cur ? { ...cur, ...next } : cur))}
              promptRequired
            />
            <div className="mt-3 flex gap-2">
              <Button disabled={pending} onClick={addPattern} size="sm" type="button">
                {pending ? "追加中…" : "追加"}
              </Button>
              <Button
                disabled={pending}
                onClick={() => {
                  setNewPattern(null);
                  setNewPatternError(null);
                }}
                size="sm"
                type="button"
                variant="ghost"
              >
                キャンセル
              </Button>
            </div>
          </div>
        ) : (
          <Button
            onClick={() => setNewPattern(emptyPatternDraft(NEW_PATTERN_PROMPT_TEMPLATE))}
            size="sm"
            type="button"
            variant="ghost"
          >
            パターンを追加
          </Button>
        )
      ) : null}

      {/*
        生成に使うプロンプト（T-M8-135）。**mdプラン以上**（投稿作成・AI設定と同じ境界）。
        予約は繰り返し実行されるので「この生成にだけ」ではなく**この予約にだけ**が既定。
      */}
      {prompts ? (
        <details className="rounded-card border border-hairline bg-page">
          <summary className="cursor-pointer select-none px-4 py-3 text-body font-medium text-ink">
            生成に使うプロンプト
            {promptEdited ? <span className="ml-2 text-caption text-brand">編集中</span> : null}
            {v.prompt_override ? (
              <span className="ml-2 text-caption text-ink-3">（この予約用に変更済み）</span>
            ) : null}
          </summary>
          <div className="space-y-3 px-4 pb-4">
            <p className="text-xs text-muted-foreground">
              この予約の生成に使われる指示です。直して、この予約にだけ使うか、パターン自体に
              保存して他でも使うかを選べます。
            </p>
            <PromptBlock
              edited={promptEdited}
              // 同一ページに新規＋各スロットの編集フォームが並ぶので、枠ごとに別のグループにする。
              groupName={`${slotFieldPrefix}-prompt-apply`}
              label={`選択中の型（${selectedPattern?.name ?? "未選択"}）の生成プロンプト`}
              limit={PROMPT_MAX_CHARS}
              mode={promptApply}
              onceLabel="この予約にだけ使う"
              onChange={setPromptDraft}
              onMode={setPromptApply}
              onReset={() => {
                setPromptDraft(null);
                setPromptApply("once");
              }}
              saveLabel="パターンに保存して他でも使う"
              value={promptValue}
            />
            {v.prompt_override ? (
              <button
                className="text-body text-info-fg hover:underline"
                onClick={() => {
                  setV((cur) => ({ ...cur, prompt_override: null }));
                  setPromptDraft(null);
                  setPromptApply("once");
                }}
                type="button"
              >
                この予約用の変更をやめてパターンの内容に戻す
              </button>
            ) : null}
          </div>
        </details>
      ) : null}

      {/* 参考URL（T-M8-135）。投稿作成の「参考にするURL」と同じ扱い。 */}
      <div>
        <label className="block font-medium" htmlFor={`${slotFieldPrefix}-source-url`}>
          参考URL（任意）
        </label>
        <input
          className="mt-1 h-9 w-full max-w-xl rounded-card border border-hairline bg-surface px-2 text-body"
          id={`${slotFieldPrefix}-source-url`}
          inputMode="url"
          onChange={(e) => setV((cur) => ({ ...cur, source_url: e.target.value }))}
          placeholder="https://..."
          value={v.source_url}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          毎回このURLをAIが読んで題材にします。空欄ならAIが自分で題材を探します。
        </p>
      </div>

      {/*
        プレースホルダー（T-M8-132／T-M8-135）。選んだパターンが持つ `{名前}` の分だけ出す。
        予約は繰り返すので、ここで入れた値が毎回同じように差し込まれる。
      */}
      {selectedPattern && selectedPattern.placeholders.length > 0 ? (
        <div className="space-y-2">
          {selectedPattern.placeholders.map((ph) => (
            <div key={ph.name}>
              <label
                className="block font-medium"
                htmlFor={`${slotFieldPrefix}-ph-${ph.name}`}
              >
                {ph.name}（任意）
              </label>
              <textarea
                className="mt-1 w-full rounded-card border border-hairline bg-surface px-3 py-2 text-body transition-colors duration-150 focus:border-brand focus:outline-none"
                id={`${slotFieldPrefix}-ph-${ph.name}`}
                maxLength={2000}
                onChange={(e) =>
                  setV((cur) => ({
                    ...cur,
                    placeholder_values: { ...cur.placeholder_values, [ph.name]: e.target.value },
                  }))
                }
                rows={2}
                value={v.placeholder_values[ph.name] ?? ""}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                プロンプトの <code>{`{${ph.name}}`}</code> に入ります。
              </p>
            </div>
          ))}
        </div>
      ) : null}

      <label className="flex flex-col gap-1">
        <span className="font-medium">追加指示（任意）</span>
        <textarea
          className="w-full rounded-card border border-hairline bg-surface px-3 py-2 text-body transition-colors duration-150 focus:border-brand focus:outline-none"
          maxLength={2000}
          onChange={(e) => setV((cur) => ({ ...cur, instructions: e.target.value }))}
          rows={2}
          value={v.instructions}
        />
      </label>

      <fieldset>
        <legend className="mb-1 font-medium">曜日</legend>
        <div className="flex flex-wrap gap-2">
          {WEEKDAY_LABELS.map((w, d) => (
            <label className="flex min-h-9 cursor-pointer items-center gap-1.5 pr-1" key={w}>
              <input checked={v.weekdays.includes(d)} className="size-4" onChange={() => toggleWeekday(d)} type="checkbox" />
              {w}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap gap-4">
        <label className="flex flex-col gap-1">
          <span className="font-medium">時刻</span>
          <select
            className="h-9 rounded-card border border-hairline bg-surface px-2 text-body"
            onChange={(e) => setV((cur) => ({ ...cur, time_jst: e.target.value }))}
            value={v.time_jst}
          >
            {TIME_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend className="mb-1 font-medium">モード</legend>
          <div className="flex gap-3">
            {(["draft", "auto"] as const).map((m) => (
              <label className="flex min-h-9 cursor-pointer items-center gap-1.5 pr-1" key={m}>
                <input
                  checked={v.mode === m}
                  className="size-4"
                  name={`mode-${target.kind === "edit" ? target.slotId : "new"}`}
                  onChange={() => setV((cur) => ({ ...cur, mode: m }))}
                  type="radio"
                />
                {m === "auto" ? "自動投稿" : "下書きのみ"}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      {/*
        未同意の予告Noticeは置かない（T-M8-66）。mode=autoで未同意のまま保存すると
        submit() が同意モーダルを自動で開くため、「拒否されます」という予告が示す状況は
        通常フローでは起きない。サーバーが拒否したときのトースト表示は残る。
      */}

      <label className="flex min-h-9 cursor-pointer items-center gap-2">
        <input
          checked={v.image_enabled}
          className="size-4"
          onChange={(e) => setV((cur) => ({ ...cur, image_enabled: e.target.checked }))}
          type="checkbox"
        />
        画像を生成して添付する
      </label>
      {v.image_enabled && imageProviders.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          画像を生成するAIが未設定です。設定の「AIモデル設定」で画像AIを選ぶまでは画像なしで作成されます。
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button disabled={pending} onClick={submit} size="sm" type="button">
          {pending ? "保存中…" : submitLabel}
        </Button>
        <Button disabled={pending} onClick={onCancel} size="sm" type="button" variant="ghost">
          キャンセル
        </Button>
      </div>
      {validationError ? (
        <p className="text-xs text-destructive" role="alert">
          {validationError}
        </p>
      ) : null}

      <AutomationConsentModal
        accountHandle={accountHandle}
        firstRunLabel={nextScheduleRun({ weekdays: v.weekdays, time_jst: v.time_jst })?.label ?? null}
        onConfirm={confirmConsentAndSubmit}
        onOpenChange={setShowConsent}
        open={showConsent}
        pending={pending}
        settingSummary={`毎週 ${v.weekdays
          .slice()
          .sort((a, b) => a - b)
          .map((d) => WEEKDAY_LABELS[d])
          .join("・")} ${v.time_jst} に「${patternLabel(patterns.find((o) => o.id === v.pattern_id)?.name ?? null)}」を生成し、確認なしでXへ投稿します。`}
      />
    </div>
  );
}

/** 自動投稿の説明＋説明文version付き明示checkbox（要件06 §3.5）。同意までauto slotは保存できない。 */
function AutomationConsentModal({
  open,
  onOpenChange,
  onConfirm,
  pending,
  accountHandle,
  settingSummary,
  firstRunLabel,
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
              同意して保存
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
