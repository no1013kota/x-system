import { Card } from "@/components/ui/card";
import type { KpiValue } from "@/lib/home/kpi";

/**
 * ホームのKPIカード（T-M8-05・デザイン §画面一覧 1.ホーム）。
 *
 * 数値は Inter 700 の23px・等幅数字。**記録が無いこと（`null`）と0を書き分ける** ——
 * 「0」と出すと「測ったうえで0だった」に読めてしまう（CLAUDE.md 原則1）。
 */
export function KpiCard({ kpi, label }: { kpi: KpiValue; label: string }) {
  const toneClass =
    kpi.delta?.tone === "up"
      ? "text-success-fg"
      : kpi.delta?.tone === "down"
        ? "text-danger-fg"
        : "text-ink-3";

  return (
    <Card className="px-4 py-3.5">
      <p className="text-caption font-medium text-ink-2">{label}</p>
      <p className="mt-1 flex items-baseline gap-1">
        {kpi.value === null ? (
          <span className="text-[15px] font-medium text-ink-3">記録なし</span>
        ) : (
          <>
            <span className="text-[23px] font-bold tabular-nums text-ink">
              {kpi.value.toLocaleString()}
            </span>
            {kpi.unit ? <span className="text-caption text-ink-2">{kpi.unit}</span> : null}
          </>
        )}
      </p>
      {kpi.delta ? <p className={`mt-0.5 text-caption font-medium ${toneClass}`}>{kpi.delta.text}</p> : null}
      {kpi.note ? <p className="mt-0.5 text-caption text-ink-3">{kpi.note}</p> : null}
    </Card>
  );
}

/**
 * 「次回の自動実行」だけは数値ではなく時刻なので専用にする。
 * 予定が無いときに空欄にせず、理由（スロット未設定など）を出す。
 */
export function NextRunCard({ label, note }: { label: string | null; note: string | null }) {
  return (
    <Card className="px-4 py-3.5">
      <p className="text-caption font-medium text-ink-2">次回の自動実行</p>
      <p className="mt-1">
        {label ? (
          <span className="text-[23px] font-bold tabular-nums text-ink">{label}</span>
        ) : (
          <span className="text-[15px] font-medium text-ink-3">予定なし</span>
        )}
      </p>
      {note ? <p className="mt-0.5 text-caption text-ink-3">{note}</p> : null}
    </Card>
  );
}
