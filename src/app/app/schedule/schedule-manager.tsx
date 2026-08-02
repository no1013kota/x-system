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
import { Button } from "@/components/ui/button";
import { CURRENT_AUTOMATION_CONSENT_VERSION, consentVersionLabel } from "@/lib/legal";
import { nextScheduleRun, type NextRun } from "@/lib/schedule/next-run";
import type { ScheduleSlotView } from "@/lib/schedule-slots";

/**
 * SC-08 スケジュール管理UI（要件06 §2, T-M4-04）。週間プレビュー＋スロットCRUD。Server Action経由で
 * 反映（作成/編集/停止/削除）。編集競合（job_conflict）は最新値の再読込を促す。P-5はスケジュール
 * 対象外のためパターン選択肢に出さない。mode=autoの同意modalは別タスク（本タスクはサーバー拒否の表示まで）。
 */

// P-5（引用ポスト）はスケジュール対象外（要件04 §12）。
const PATTERN_OPTIONS: { id: string; label: string }[] = [
  { id: "p1", label: "ニュース解説" },
  { id: "p2", label: "自分の考え" },
  { id: "p3", label: "ノウハウ" },
  { id: "p4", label: "トレンド便乗" },
  { id: "p6", label: "週次まとめ" },
];
const PATTERN_LABEL: Record<string, string> = Object.fromEntries(
  PATTERN_OPTIONS.map((p) => [p.id, p.label]),
);
const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

const TIME_OPTIONS: string[] = (() => {
  const out: string[] = [];
  for (let h = 9; h <= 22; h++) {
    out.push(`${String(h).padStart(2, "0")}:00`);
    if (h < 22) out.push(`${String(h).padStart(2, "0")}:30`);
  }
  return out;
})();

interface SlotFormValues {
  pattern: string;
  weekdays: number[];
  time_jst: string;
  mode: "draft" | "auto";
  instructions: string;
  image_enabled: boolean;
}

function toFormValues(slot: ScheduleSlotView): SlotFormValues {
  return {
    pattern: slot.pattern,
    weekdays: [...slot.weekdays].sort((a, b) => a - b),
    time_jst: slot.time_jst.slice(0, 5),
    mode: slot.mode === "auto" ? "auto" : "draft",
    instructions: slot.instructions ?? "",
    image_enabled: slot.image_enabled,
  };
}

export function ScheduleManager({
  slots,
  imageProviders,
  automationConsented,
  xAccountId,
  accountHandle,
}: {
  slots: ScheduleSlotView[];
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
                : "同意済み（有効な自動スロットなし）"
              : "未設定 — 現在は下書きの作成までです"}
          </p>
          {upcoming ? (
            <p className="text-muted-foreground">
              次回の実行: {upcoming.run.label} —「
              {PATTERN_LABEL[upcoming.slot.pattern] ?? upcoming.slot.pattern}」を
              {upcoming.slot.mode === "auto"
                ? "生成し、確認なしでXへ投稿します"
                : "下書きとして作成します（投稿はしません）"}
            </p>
          ) : (
            <p className="text-muted-foreground">
              有効なスケジュールがないため、自動での生成・投稿は行われません。
            </p>
          )}
        </div>
        {automationConsented ? <StopAllAutomationButton xAccountId={xAccountId} /> : null}
      </div>

      <WeekPreview slots={slots} />

      <div className="flex justify-end">
        {!creating ? (
          <Button className="h-9 px-4 text-[13px]" onClick={() => setCreating(true)} type="button" variant="brand">
            スケジュールを追加
          </Button>
        ) : null}
      </div>

      {creating ? (
        <div className="rounded-2xl border bg-card p-5 shadow-sm">
          <h2 className="text-sm font-semibold">新しいスケジュール</h2>
          <SlotFields
            accountHandle={accountHandle}
            automationConsented={automationConsented}
            imageProviders={imageProviders}
            onCancel={() => setCreating(false)}
            onSubmitDone={() => setCreating(false)}
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
  const [notice, setNotice] = useState<string | null>(null);

  function stopAll() {
    setNotice(null);
    startTransition(async () => {
      const res = await disableXAutomationAction({ x_account_id: xAccountId });
      if (res.status === "success") {
        setNotice(`自動投稿を停止しました（${res.result?.disabledSlots ?? 0}件のスロットを無効化）。`);
        router.refresh();
      } else {
        setNotice(res.message);
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
          <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-black/40" />
          <AlertDialog.Popup className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-background p-6 shadow-lg outline-none">
            <AlertDialog.Title className="text-[15px] font-bold text-ink">
              自動投稿をすべて停止しますか？
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-3 text-sm leading-6 text-muted-foreground">
              このXアカウントの自動投稿スロットを無効化し、未投稿の自動ジョブを停止します。下書き作成のみのスロットと手動投稿は継続できます。
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
      {notice ? (
        <p className="text-xs text-emerald-700" role="status">
          {notice}
        </p>
      ) : null}
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
        <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-black/40" />
        <AlertDialog.Popup className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-background p-6 shadow-lg outline-none">
          <AlertDialog.Title className="text-[15px] font-bold text-ink">
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
              render={<Button size="lg" type="button" variant="destructive" />}
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
        スケジュールはまだありません。曜日と時刻を決めて追加すると、ここに週間プレビューが表示されます。
      </EmptyNotice>
    );
  }
  return (
    <div className="overflow-x-auto rounded-2xl border bg-card p-4 shadow-sm">
      <table className="w-full min-w-[520px] border-collapse text-center text-xs">
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
                        className={`m-0.5 inline-block rounded px-1.5 py-0.5 ${
                          s.enabled
                            ? s.mode === "auto"
                              ? "bg-brand text-white"
                              : "bg-muted text-foreground"
                            : "bg-muted/40 text-muted-foreground line-through"
                        }`}
                        aria-label={`${PATTERN_LABEL[s.pattern] ?? s.pattern}・${s.mode === "auto" ? "自動投稿" : "下書きのみ"}${s.enabled ? "" : "・停止中"}`}
                        key={s.id}
                        title={`${PATTERN_LABEL[s.pattern] ?? s.pattern}・${s.mode === "auto" ? "自動投稿（確認なしでXへ）" : "下書きのみ（自分で投稿）"}${s.enabled ? "" : "・停止中"}`}
                      >
                        {PATTERN_LABEL[s.pattern]?.slice(0, 2) ?? s.pattern}
                      </span>
                    ))}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {/* 色だけで意味を伝えないための凡例（要件06 §2 SC-08）。 */}
      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          <span className="mr-1 inline-block rounded bg-foreground px-1.5 py-0.5 text-background">例</span>
          自動投稿（確認なしでXへ）
        </span>
        <span>
          <span className="mr-1 inline-block rounded bg-muted px-1.5 py-0.5 text-foreground">例</span>
          下書きのみ（確認してから自分で投稿）
        </span>
        <span>
          <span className="mr-1 inline-block rounded bg-muted/40 px-1.5 py-0.5 text-muted-foreground line-through">例</span>
          停止中
        </span>
      </p>
    </div>
  );
}

function SlotList({
  slots,
  imageProviders,
  automationConsented,
  xAccountId,
  accountHandle,
}: {
  slots: ScheduleSlotView[];
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
          slot={slot}
          xAccountId={xAccountId}
        />
      ))}
    </ul>
  );
}

function SlotRow({
  slot,
  imageProviders,
  automationConsented,
  xAccountId,
  accountHandle,
}: {
  slot: ScheduleSlotView;
  imageProviders: string[];
  automationConsented: boolean;
  xAccountId: string;
  accountHandle: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const nextRun = nextScheduleRun(slot);

  function run(action: () => Promise<{ status: string; code?: string; message: string }>) {
    setNotice(null);
    startTransition(async () => {
      const res = await action();
      if (res.status === "success") {
        router.refresh();
        return;
      }
      setNotice(
        res.code === "job_conflict"
          ? "他の場所で更新されました。最新の状態を再読み込みしてください。"
          : res.message,
      );
    });
  }

  return (
    <li className="rounded-2xl border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold">{PATTERN_LABEL[slot.pattern] ?? slot.pattern}</span>
          <span className="rounded-full border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {slot.mode === "auto" ? "自動投稿" : "下書き"}
          </span>
          <span className="text-xs text-muted-foreground">
            {slot.weekdays.map((d) => WEEKDAY_LABELS[d]).join("・")} {slot.time_jst.slice(0, 5)}
          </span>
          {!slot.enabled ? (
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-900">
              停止中（実行されません）
            </span>
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
                run(() =>
                  disableScheduleSlotAction({ slot_id: slot.id, expected_updated_at: slot.updated_at }),
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
                run(() =>
                  enableScheduleSlotAction({ slot_id: slot.id, expected_updated_at: slot.updated_at }),
                )
              }
              size="sm"
              type="button"
            >
              再開
            </Button>
          )}
          <DeleteSlotButton
            description={`${slot.weekdays.map((d) => WEEKDAY_LABELS[d]).join("・")} ${slot.time_jst.slice(0, 5)} の「${PATTERN_LABEL[slot.pattern] ?? slot.pattern}」（${slot.mode === "auto" ? "自動投稿" : "下書き"}）を削除します。曜日・時刻・追加指示の設定は復元できません。一時的に止めたいだけなら「停止」を使ってください。`}
            disabled={pending}
            onConfirm={() =>
              run(() =>
                deleteScheduleSlotAction({ slot_id: slot.id, expected_updated_at: slot.updated_at }),
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
            onCancel={() => setEditing(false)}
            onSubmitDone={() => setEditing(false)}
            submitLabel="保存"
            target={{ kind: "edit", slotId: slot.id, expectedUpdatedAt: slot.updated_at }}
            xAccountId={xAccountId}
          />
        </div>
      ) : null}

      {notice ? (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {notice}
        </p>
      ) : null}
    </li>
  );
}

type SlotTarget = { kind: "create" } | { kind: "edit"; slotId: string; expectedUpdatedAt: string };

function SlotFields({
  target,
  initial,
  imageProviders,
  automationConsented,
  xAccountId,
  accountHandle,
  submitLabel,
  onSubmitDone,
  onCancel,
}: {
  target: SlotTarget;
  initial?: SlotFormValues;
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
      pattern: "p1",
      weekdays: [],
      time_jst: "09:00",
      mode: "draft",
      instructions: "",
      image_enabled: false,
    },
  );
  const [notice, setNotice] = useState<string | null>(null);
  // 同意済み（サーバー判定）＋本フォームで同意した分。auto保存の前提。
  const [consented, setConsented] = useState(automationConsented);
  const [showConsent, setShowConsent] = useState(false);

  const toggleWeekday = (d: number) =>
    setV((cur) => ({
      ...cur,
      weekdays: cur.weekdays.includes(d)
        ? cur.weekdays.filter((x) => x !== d)
        : [...cur.weekdays, d].sort((a, b) => a - b),
    }));

  function doSubmit() {
    startTransition(async () => {
      const payload = {
        pattern: v.pattern,
        weekdays: v.weekdays,
        time_jst: v.time_jst,
        mode: v.mode,
        instructions: v.instructions.trim() || undefined,
        image_enabled: v.image_enabled,
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
        router.refresh();
        onSubmitDone();
        return;
      }
      setNotice(
        res.code === "job_conflict"
          ? "他の場所で更新されました。最新の状態を再読み込みしてください。"
          : res.code === "automation_consent_required"
            ? "自動投稿を有効にするには、現在の説明への同意が必要です。"
            : res.message,
      );
    });
  }

  function submit() {
    setNotice(null);
    if (v.weekdays.length === 0) {
      setNotice("曜日を1つ以上選択してください。");
      return;
    }
    // mode=auto かつ未同意なら、保存前に同意modalを表示する（要件06 §3.5）。
    if (v.mode === "auto" && !consented) {
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
        setNotice(res.message);
        return;
      }
      setConsented(true);
      setShowConsent(false);
      doSubmit();
    });
  }

  return (
    <div className="space-y-4 text-sm">
      <fieldset>
        <legend className="mb-1 font-medium">パターン</legend>
        <div className="flex flex-wrap gap-2">
          {PATTERN_OPTIONS.map((p) => (
            <label className="flex items-center gap-1" key={p.id}>
              <input
                checked={v.pattern === p.id}
                name={`pattern-${target.kind === "edit" ? target.slotId : "new"}`}
                onChange={() => setV((cur) => ({ ...cur, pattern: p.id }))}
                type="radio"
              />
              {p.label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-1 font-medium">曜日</legend>
        <div className="flex flex-wrap gap-2">
          {WEEKDAY_LABELS.map((w, d) => (
            <label className="flex items-center gap-1" key={w}>
              <input checked={v.weekdays.includes(d)} onChange={() => toggleWeekday(d)} type="checkbox" />
              {w}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap gap-4">
        <label className="flex flex-col gap-1">
          <span className="font-medium">時刻</span>
          <select
            className="rounded-md border px-3 py-2"
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
              <label className="flex items-center gap-1" key={m}>
                <input
                  checked={v.mode === m}
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

      {v.mode === "auto" && !automationConsented ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          自動投稿には現在の説明への同意が必要です。同意していない場合、保存は拒否されます。
        </p>
      ) : null}

      <label className="flex items-center gap-2">
        <input
          checked={v.image_enabled}
          onChange={(e) => setV((cur) => ({ ...cur, image_enabled: e.target.checked }))}
          type="checkbox"
        />
        画像を生成して添付する
      </label>
      {v.image_enabled && imageProviders.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          画像を生成するAIが未設定です。AI設定の「AI用途」で画像AIを選ぶまでは画像なしで作成されます。
        </p>
      ) : null}

      <label className="flex flex-col gap-1">
        <span className="font-medium">追加指示（任意）</span>
        <textarea
          className="w-full rounded-md border px-3 py-2"
          maxLength={2000}
          onChange={(e) => setV((cur) => ({ ...cur, instructions: e.target.value }))}
          rows={2}
          value={v.instructions}
        />
      </label>

      <div className="flex gap-2">
        <Button disabled={pending} onClick={submit} size="sm" type="button">
          {pending ? "保存中…" : submitLabel}
        </Button>
        <Button disabled={pending} onClick={onCancel} size="sm" type="button" variant="ghost">
          キャンセル
        </Button>
      </div>
      {notice ? (
        <p className="text-xs text-destructive" role="alert">
          {notice}
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
          .join("・")} ${v.time_jst} に「${PATTERN_LABEL[v.pattern] ?? v.pattern}」を生成し、確認なしでXへ投稿します。`}
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
        <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-black/40" />
        <AlertDialog.Popup className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-background p-6 shadow-lg outline-none">
          <AlertDialog.Title className="text-[15px] font-bold text-ink">
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
