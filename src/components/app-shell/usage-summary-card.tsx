import type { UsageSlot, UsageSummary } from "@/lib/usage/usage-summary";
import { Card, CardTitle } from "@/components/ui/card";
import { yen } from "@/lib/format";

/**
 * 運営キー系プランの利用枠（契約期間ごと・T-M8-258）の残量カード（要件03 §8・要件06 §10, T-M6-12/T-M8-168）。
 * SC-05ホーム・SC-11設定に置く。used/limit/remaining を表示し、上限到達（remaining=0）の枠は
 * 「{nextResetLabel}にリセット」の到達エラー表示を出す。表示専用のため server component（JS不要）。
 * BYOK（standard）は呼び出し側で summary=null にして本カードを描画しない。
 *
 * `summary.concealed`（エキスパート）は**数値を一切出さず**「無制限」とだけ表示する。
 * 到達中なら停止の文言（usage_paused と同文）を出す。内部ガード値を残量バーで悟らせない。
 */

// 並びは AIクレジット → 通常投稿 → URL付き投稿（T-M8-109・運営者の指示）。
const SLOT_LABELS: ["ai_credits" | "normal_posts" | "url_posts", string][] = [
  ["ai_credits", "AIクレジット"],
  ["normal_posts", "通常投稿クレジット"],
  ["url_posts", "URL付き投稿クレジット"],
];

function SlotRow({ label, slot, resetLabel }: { label: string; slot: UsageSlot; resetLabel: string }) {
  const atLimit = slot.remaining <= 0;
  const pct = slot.limit > 0 ? Math.min(100, Math.round((slot.used / slot.limit) * 100)) : 0;
  return (
    <li className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm text-muted-foreground">
          残り {yen(slot.remaining)} / {yen(slot.limit)}
        </span>
      </div>
      <div
        aria-hidden
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className={atLimit ? "h-full bg-danger-fg" : "h-full bg-brand"}
          style={{ width: `${pct}%` }}
        />
      </div>
      {atLimit ? (
        <p className="text-xs font-medium text-destructive" role="status">
          上限に達しました。{resetLabel}にリセットされます。
        </p>
      ) : null}
    </li>
  );
}

export function UsageSummaryCard({
  summary,
  nextResetLabel,
}: {
  summary: UsageSummary;
  /** 枠がリセットされる日＝契約の次回更新日（JST）表記。例「2026年9月15日」。未同期なら「次回の更新日」。 */
  nextResetLabel: string;
}) {
  if (summary.concealed) {
    // エキスパート（T-M8-168）: 数値・枠名・リセット日を出さない。表示は「無制限」のみ。
    // concealed の summary は数値がゼロ埋めされているため、停止判定は paused だけを見る。
    const paused = summary.paused;
    return (
      <Card as="section" aria-labelledby="usage-summary-heading" className="px-5 py-4">
        <div className="flex items-baseline justify-between gap-2">
          <CardTitle id="usage-summary-heading">利用枠</CardTitle>
          <span className="text-sm font-bold text-brand">無制限</span>
        </div>
        {paused ? (
          <p className="mt-3 text-sm font-medium text-destructive" role="status">
            連続的な使用が検知されたため一時的に停止しております。お待ちください。
          </p>
        ) : null}
      </Card>
    );
  }
  return (
    <Card as="section" aria-labelledby="usage-summary-heading" className="px-5 py-4">
      <div className="flex items-baseline justify-between gap-2">
        <CardTitle id="usage-summary-heading">
          利用枠
        </CardTitle>
        <span className="text-xs text-muted-foreground">{nextResetLabel}にリセット</span>
      </div>
      <ul className="mt-4 space-y-4">
        {SLOT_LABELS.map(([key, label]) => (
          <SlotRow key={key} label={label} resetLabel={nextResetLabel} slot={summary[key]} />
        ))}
      </ul>
    </Card>
  );
}
