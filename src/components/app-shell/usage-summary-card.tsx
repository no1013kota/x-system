import type { UsageSlot, UsageSummary } from "@/lib/usage/usage-summary";
import { Card, CardTitle } from "@/components/ui/card";

/**
 * premium 月間利用枠の残量カード（要件03 §8・要件06 §10, T-M6-12）。SC-05ホーム・SC-11設定に置く。
 * 4枠（通常投稿/URL付き投稿/生成/画像）の used/limit/remaining を表示し、上限到達（remaining=0）の枠は
 * 「翌月{nextResetLabel}にリセット」の到達エラー表示を出す。表示専用のため server component（JS不要）。
 * premium 以外は呼び出し側で summary=null にして本カードを描画しない。
 */

// 並びは AIクレジット → 通常投稿 → URL付き投稿（T-M8-109・運営者の指示）。
const SLOT_LABELS: [keyof UsageSummary, string][] = [
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
          残り {slot.remaining} / {slot.limit}
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
          今月の上限に達しました。{resetLabel}にリセットされます。
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
  /** 翌月開始日時（JST）表記。例「2026年8月1日」。 */
  nextResetLabel: string;
}) {
  return (
    <Card as="section" aria-labelledby="usage-summary-heading" className="px-5 py-4">
      <div className="flex items-baseline justify-between gap-2">
        <CardTitle id="usage-summary-heading">
          今月の利用枠
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
